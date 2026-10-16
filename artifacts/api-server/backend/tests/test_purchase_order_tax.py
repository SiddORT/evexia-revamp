"""Tax-only arithmetic and real transactions in the existing disposable DB fixture."""
import uuid
from decimal import Decimal
import pytest
from sqlalchemy import select
from app.db.purchase_order_models import PurchaseOrder, PurchaseOrderLine, PurchaseOrderRequest
from app.db.vendor_models import Vendor
from app.services import purchase_orders as service
from app.services.purchase_order_tax import tax_basis, calculate_components, STATES
from test_sessions import client
from test_purchase_orders import fixture, save, get, BASE


@pytest.mark.parametrize("supplier,destination,treatment", [
    ("27", "27", "cgst_sgst"), ("29", "27", "igst"), ("29", "29", "cgst_sgst"),
    ("04", "04", "cgst_utgst"), ("26", "26", "cgst_utgst"), ("31", "31", "cgst_utgst"),
    ("35", "35", "cgst_utgst"), ("38", "38", "cgst_utgst"), ("07", "07", "cgst_sgst"),
    ("34", "34", "cgst_sgst"), ("01", "01", "cgst_sgst"), ("27", "38", "igst"),
])
def test_ordinary_domestic_rules(supplier, destination, treatment):
    basis = tax_basis(supplier + "DDDDD3333D1Z8", destination)
    assert basis["treatment"] == treatment
    line = calculate_components("1", Decimal("100"), Decimal("18"), treatment)
    assert line["gstAmount"] == 1800 and line["total"] == 11800
    expected = {"cgst": 0, "sgst": 0, "utgst": 0, "igst": 0}
    if treatment == "igst":
        expected["igst"] = 1800
    else:
        expected["cgst"] = expected[treatment[5:]] = 900
    assert line["taxComponents"] == expected


@pytest.mark.parametrize("bad", [None, "", "00", "25", "28", "39", "97", "99"])
def test_unsupported_codes_never_choose_regime(bad):
    with pytest.raises(service.POError):
        tax_basis("27DDDDD3333D1Z8", bad)
    if bad:
        with pytest.raises(service.POError):
            tax_basis(bad + "DDDDD3333D1Z8", "27")
    assert len(STATES) == 36


@pytest.mark.parametrize("quantity,price,gst,treatment,subtotal,tax", [
    ("3.125", "123.456789", "18.123456", "cgst_sgst", 38580, 6992),
    ("3.125", "123.456789", "18.123456", "igst", 38580, 6992),
    ("1", "0.005000", "50", "cgst_sgst", 1, 0),
    ("1", "0.005000", "50", "igst", 1, 1),
    ("1", "0.030000", "100", "cgst_utgst", 3, 4),
    ("0.001", "7.000001", "5.500001", "cgst_sgst", 1, 0),
    ("1000000", "0", "0", "igst", 0, 0),
    ("1", "0.000000", "18.123457", "cgst_sgst", 0, 0),
    ("1", "100000000", "0", "igst", 10000000000, 0),
])
def test_exact_rounding(quantity, price, gst, treatment, subtotal, tax):
    line = calculate_components(quantity, Decimal(price), Decimal(gst), treatment)
    assert (line["subtotal"], line["gstAmount"], line["total"]) == (subtotal, tax, subtotal + tax)
    assert sum(line["taxComponents"].values()) == tax


def test_review_save_snapshots_staleness_and_retained_vendor(client):
    api, db, _ = client
    headers, _, values, _ = fixture(api, db, price="100", gst="18")
    values["lines"][0]["quantity"] = "1"
    reviewed = api.post(BASE + "/preview", headers=headers, json=values).json()
    vendor = db.get(Vendor, uuid.UUID(values["vendorId"]))
    vendor.gstNo = "29DDDDD3333D1Z8"
    vendor.version += 1
    db.commit()
    response = api.post(BASE, headers=headers, json={**values, "reviewToken": reviewed["reviewToken"], "idempotencyKey": str(uuid.uuid4())})
    assert response.status_code == 409 and response.json()["error"]["code"] == "po_review_stale"
    order, body, review = save(api, headers, values)
    assert order["taxBasis"]["treatment"] == "igst" and order["taxComponents"]["igst"] == 1800
    assert order["lines"][0]["componentRates"]["igst"] == "18.000000"
    assert order["taxBasis"] == review["order"]["taxBasis"]
    vendor.gstNo = "27DDDDD3333D1Z8"
    vendor.version += 1
    db.commit()
    assert get(api, headers, "/" + order["id"]) == order
    updated, _, _ = save(api, headers, {**values, "placeOfSupplyCode": "29"}, order["id"], 1)
    assert updated["taxBasis"]["supplierStateCode"] == "29"
    assert updated["taxBasis"]["treatment"] == "cgst_sgst"
    assert updated["taxComponents"] == dict(cgst=900, sgst=900, utgst=0, igst=0)
    assert "tax basis / place of supply" in get(api, headers, "/activity")["items"][0]["summary"]
    assert api.post(BASE, headers=headers, json=body).json() == order  # original durable response


def test_legacy_reads_explicit_edit_and_original_retry_identity(client):
    api, db, _ = client
    headers, actor, values, _ = fixture(api, db, price="0.005000", gst="50")
    order, _, _ = save(api, headers, values)
    row = db.get(PurchaseOrder, uuid.UUID(order["id"]))
    row.tax_basis = row.tax_components = None
    row.gst_amount, row.total = 1, 2  # original aggregate half-up result
    for line in db.scalars(select(PurchaseOrderLine).where(PurchaseOrderLine.order_id == row.id)):
        line.snapshot = {k: v for k, v in line.snapshot.items() if k not in ("taxComponents", "componentRates")}
        line.snapshot = {**line.snapshot, "gstAmount": 1, "total": 2}
    db.commit()
    legacy = get(api, headers, "/" + order["id"])
    assert legacy["taxBasis"] is None and legacy["taxComponents"] is None and legacy["total"] == 2
    # Emulate a committed pre-upgrade request with its ORIGINAL omitted-field digest.
    old_input = {k: v for k, v in values.items() if k != "placeOfSupplyCode"}
    old_body = {**old_input, "reviewToken": "a" * 64, "idempotencyKey": str(uuid.uuid4())}
    from app.schemas.purchase_orders import POCreate
    normalized = POCreate(**old_body).model_dump(mode="json")
    normalized.pop("placeOfSupplyCode")
    original_response = {k: v for k, v in legacy.items() if k not in ("taxBasis", "taxComponents")}
    db.add(PurchaseOrderRequest(key=uuid.UUID(old_body["idempotencyKey"]), actor_id=actor.id,
        digest=service.digest(["created", None, normalized]), response=original_response))
    db.commit()
    retried = api.post(BASE, headers=headers, json=old_body)
    assert retried.status_code == 201 and retried.json()["id"] == order["id"] and retried.json()["total"] == 2
    assert api.post(BASE + "/preview", headers=headers, json=old_input).status_code == 422
    # An uncommitted old request is definitively rejected, never upgraded/re-created.
    assert api.post(BASE, headers=headers, json={**old_body, "idempotencyKey": str(uuid.uuid4())}).status_code == 422
    captured, _, _ = save(api, headers, values, order["id"], 1)
    assert captured["taxBasis"]["supplierStateCode"] == "27" and captured["total"] == 1


def test_invalid_basis_and_mixed_rates(client):
    api, db, _ = client
    headers, _, values, product = fixture(api, db, price="100", gst="18")
    from test_allergens import add
    from app.db.allergen_models import AllergenProduct
    p = db.get(AllergenProduct, uuid.UUID(product["id"]))
    zero = add(api, headers, {"id": str(p.category_id)}, {"id": str(p.storage_location_id)}, name="Zero GST product", selling_price="100", gst="0")
    values["lines"] = [dict(productId=product["id"], quantity="1"), dict(productId=zero["id"], quantity="1")]
    result, _, _ = save(api, headers, values)
    assert result["subtotal"] == 20000 and result["gstAmount"] == 1800 and result["total"] == 21800
    choices = get(api, headers, "/references/vendors")["items"][0]
    assert choices["gstin"] == "27DDDDD3333D1Z8" and choices["registrationStateCode"] == "27"
    vendor = db.get(Vendor, uuid.UUID(values["vendorId"]))
    vendor.gstNo = "99DDDDD3333D1Z8"
    db.commit()
    assert get(api, headers, "/references/vendors")["items"][0]["registrationStateCode"] is None
    assert api.post(BASE + "/preview", headers=headers, json=values).status_code == 422


def test_destination_binding_changed_vendor_and_order_limit(client):
    api, db, _ = client
    headers, _, values, _ = fixture(api, db, price="100", gst="18")
    values["lines"][0]["quantity"] = "1"
    first = api.post(BASE + "/preview", headers=headers, json=values).json()
    changed = {**values, "placeOfSupplyCode": "29"}
    assert api.post(BASE, headers=headers, json={**changed, "reviewToken": first["reviewToken"], "idempotencyKey": str(uuid.uuid4())}).status_code == 409
    saved, _, _ = save(api, headers, values)
    from test_vendors import FIELDS
    other = api.post("/api/v1/admin/vendors", headers=headers, json={**FIELDS, "vendorName": "Changed tax supplier", "gstNo": "29EEEEE4444E1Z9"}).json()
    changed = {**values, "vendorId": other["id"]}
    second, _, _ = save(api, headers, changed, saved["id"], 1)
    assert second["taxBasis"]["supplierStateCode"] == "29" and second["taxBasis"]["treatment"] == "igst"
    from app.db.allergen_models import AllergenProduct
    product = db.get(AllergenProduct, uuid.UUID(values["lines"][0]["productId"]))
    product.selling_price = Decimal("50000000")
    product.gst = Decimal("0")
    db.commit()
    # Each line fits; the combined order does not.
    values["lines"] *= 3
    assert api.post(BASE + "/preview", headers=headers, json=values).status_code == 422


def test_additive_migration_preserves_existing_rows_and_retry_payloads(client):
    """Execute the actual forward DDL against populated predecessor storage."""
    api, db, _ = client
    headers, _, values, _ = fixture(api, db)
    order, body, _ = save(api, headers, values)
    from sqlalchemy import text
    before_lines = list(db.execute(text("SELECT id, snapshot FROM purchase_order_lines")).all())
    before_retry = list(db.execute(text("SELECT key, digest, response FROM purchase_order_requests")).all())
    original = db.execute(text("SELECT id, total, gst_amount, version FROM purchase_orders")).one()
    # Transactional DDL stays inside the fixture's savepoint/outer rollback.
    db.execute(text("ALTER TABLE purchase_orders DROP COLUMN tax_basis, DROP COLUMN tax_components"))
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    import importlib.util
    from pathlib import Path
    path = Path(__file__).parents[1] / "alembic/versions/0040_po_tax_basis.py"
    spec = importlib.util.spec_from_file_location("po_tax_additive", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with Operations.context(MigrationContext.configure(db.connection())):
        migration.upgrade()
    assert db.execute(text("SELECT id, total, gst_amount, version FROM purchase_orders")).one() == original
    assert db.execute(text("SELECT tax_basis, tax_components FROM purchase_orders")).one() == (None, None)
    assert list(db.execute(text("SELECT id, snapshot FROM purchase_order_lines")).all()) == before_lines
    assert list(db.execute(text("SELECT key, digest, response FROM purchase_order_requests")).all()) == before_retry
