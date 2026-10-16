"""Focused PO functionality in the disposable PostgreSQL harness only."""
import uuid
from decimal import Decimal
import pytest
from sqlalchemy import func, select
from app.db.models import AuditEvent
from app.db.purchase_order_models import PurchaseOrder, PurchaseOrderAudit, PurchaseOrderRequest
from app.db.allergen_models import AllergenProduct
from app.db.vendor_models import Vendor
from app.db.location_models import StorageLocation
from app.services import purchase_orders as service
from test_sessions import client, create_user, login
from test_reporting import admin_headers
from test_allergens import references, add
from test_vendors import FIELDS
from test_zone_permissions import setup as staff_setup, staff_login, bearer

BASE = "/api/v1/admin/purchase-orders"


def fixture(api, db, price="12.345678", gst="18.123456"):
    headers, actor = admin_headers(api, db)
    category, location = references(api, headers)
    vendor = api.post("/api/v1/admin/vendors", headers=headers, json=FIELDS)
    assert vendor.status_code == 201, vendor.text
    product = add(api, headers, category, location, selling_price=price, gst=gst)
    values = dict(poDate="2026-10-15", expectedDate="2026-10-16", vendorId=vendor.json()["id"],
                  locationId=location["id"], placeOfSupplyCode="27", lines=[dict(productId=product["id"], quantity="1.001")])
    return headers, actor, values, product


def save(api, headers, values, path="", version=None, retry=None):
    reviewed = api.post(BASE + (f"/{path}/preview" if path else "/preview"), headers=headers, json=values)
    assert reviewed.status_code == 200, reviewed.text
    body = {**values, "reviewToken": reviewed.json()["reviewToken"], "idempotencyKey": retry or str(uuid.uuid4())}
    if version:
        body["expected_version"] = version
    result = api.post(BASE + (f"/{path}/edit" if path else ""), headers=headers, json=body)
    assert result.status_code == (200 if path else 201), result.text
    return result.json(), body, reviewed.json()


def get(api, headers, suffix="", **params):
    result = api.get(BASE + suffix, headers=headers, params=params)
    assert result.status_code == 200, result.text
    return result.json()


def test_crud_exact_snapshots_versions_activity_and_global_analytics(client):
    api, db, _ = client
    headers, actor, values, product = fixture(api, db)
    order, body, review = save(api, headers, values)
    assert (order["subtotal"], order["gstAmount"], order["total"]) == (1236, 224, 1460)
    assert order["lines"][0]["unitPrice"] == "12.345678"
    assert order["total"] == review["order"]["total"]
    assert order["number"].startswith("PO-20261015-")
    uuid.UUID(order["id"])
    line_id = order["lines"][0]["id"]
    assert get(api, headers, "/" + order["id"]) == order
    assert api.post(BASE, headers=headers, json=body).json() == order
    conflicting = {**body, "expectedDate": "2026-10-17"}
    assert api.post(BASE, headers=headers, json=conflicting).status_code == 409
    product_row = db.get(AllergenProduct, uuid.UUID(product["id"]))
    product_row.name, product_row.selling_price, product_row.status = "Renamed product", Decimal("99"), "inactive"
    db.get(Vendor, uuid.UUID(values["vendorId"])).vendorName = "Renamed vendor"
    db.get(StorageLocation, uuid.UUID(values["locationId"])).status = "inactive"
    db.commit()
    snapshot = get(api, headers, "/" + order["id"])
    assert snapshot == order
    revised = {**values, "expectedDate": "2026-10-20", "lines": [{**values["lines"][0], "quantity": "2"}]}
    updated, update_body, _ = save(api, headers, revised, order["id"], 1)
    assert updated["version"] == 2 and updated["lines"][0]["id"] == line_id
    assert updated["lines"][0]["unitPrice"] == "12.345678"
    assert updated["vendorName"] == order["vendorName"]
    assert api.post(BASE + f"/{order['id']}/edit", headers=headers, json=update_body).json() == updated
    stale = {**update_body, "idempotencyKey": str(uuid.uuid4())}
    assert api.post(BASE + f"/{order['id']}/edit", headers=headers, json=stale).status_code == 409
    overview = get(api, headers, "/overview")
    assert overview == dict(openValue=updated["total"], openCount=1, vendorCount=1, lineCount=1, changes=2)
    analytics = get(api, headers, "/analytics")
    assert analytics["counts"] == dict(created=1, updated=1, deleted=0)
    assert analytics["vendors"][0]["amount"] == overview["openValue"]
    assert analytics["vendors"][0]["name"] == order["vendorName"]
    events = get(api, headers, "/activity")
    assert [e["action"] for e in events["items"]] == ["updated", "created"]
    assert all(e["actor"] == "Super Admin" and e["number"] == order["number"] for e in events["items"])
    for query in (order["number"], "Super Admin", "Updated", "expected delivery"):
        assert get(api, headers, "/activity", query=query)["filtered"] > 0
    assert get(api, headers, "/activity", limit=1, offset=1)["items"][0]["action"] == "created"
    audit = db.scalar(select(AuditEvent).where(AuditEvent.resource_id == uuid.UUID(order["id"])).limit(1))
    assert audit.actor_id == actor.id and audit.session_id and audit.outcome == "success"
    delete_body = dict(expected_version=2, idempotencyKey=str(uuid.uuid4()))
    deleted = api.post(BASE + f"/{order['id']}/delete", headers=headers, json=delete_body)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["status"] == "deleted"
    assert api.post(BASE + f"/{order['id']}/delete", headers=headers, json=delete_body).json() == deleted.json()
    assert get(api, headers)["filtered"] == 0
    assert get(api, headers, status="deleted")["items"][0]["id"] == order["id"]
    assert get(api, headers, "/overview") == dict(openValue=0, openCount=0, vendorCount=0, lineCount=0, changes=3)
    assert get(api, headers, "/analytics") == dict(counts=dict(created=1, updated=1, deleted=1), vendors=[])
    assert get(api, headers, "/activity")["total"] == 3


def test_reference_validation_stale_review_missing_price_and_zero(client):
    api, db, _ = client
    headers, _, values, product = fixture(api, db, price=None)
    assert api.post(BASE + "/preview", headers=headers, json=values).json()["error"]["code"] == "po_price_missing"
    row = db.get(AllergenProduct, uuid.UUID(product["id"]))
    row.selling_price = Decimal("0")
    db.commit()
    preview = api.post(BASE + "/preview", headers=headers, json=values).json()
    assert preview["order"]["total"] == 0
    row.selling_price = Decimal("0.000001")
    row.version += 1
    db.commit()
    body = {**values, "reviewToken": preview["reviewToken"], "idempotencyKey": str(uuid.uuid4())}
    response = api.post(BASE, headers=headers, json=body)
    assert response.status_code == 409 and response.json()["error"]["code"] == "po_review_stale"
    assert get(api, headers, "/overview")["changes"] == 0
    zero, _, _ = save(api, headers, values)
    assert zero["total"] == 0
    assert get(api, headers, "/analytics")["vendors"][0]["amount"] == 0
    row.status = "inactive"
    db.commit()
    assert api.post(BASE + "/preview", headers=headers, json=values).status_code == 409
    assert get(api, headers, "/references/products")["filtered"] == 0
    assert get(api, headers, "/filter-options/products")["items"][0]["name"] == product["name"]


@pytest.mark.parametrize("quantity", ["0", "-1", "1.0001", "1e2", "1000000.001", "NaN"])
def test_quantity_limits(client, quantity):
    api, db, _ = client
    headers, _, values, _ = fixture(api, db)
    values["lines"][0]["quantity"] = quantity
    assert api.post(BASE + "/preview", headers=headers, json=values).status_code == 422
    assert get(api, headers, "/overview")["changes"] == 0


def test_combined_filters_paging_global_cards_reference_hydration_and_empty(client):
    api, db, _ = client
    headers, _, values, product = fixture(api, db)
    assert get(api, headers, "/overview")["openCount"] == 0
    assert get(api, headers, "/analytics")["counts"] == dict(created=0, updated=0, deleted=0)
    first, _, _ = save(api, headers, values)
    second, _, _ = save(api, headers, {**values, "poDate": "2026-10-14"})
    for query in (first["number"], first["vendorName"], first["locationName"], product["name"]):
        assert get(api, headers, query=query)["filtered"] > 0
    result = get(api, headers, vendor_id=values["vendorId"], product_id=product["id"],
                 from_date="2026-10-15", to_date="2026-10-15", query=product["name"], limit=1)
    assert result["filtered"] == 1 and result["total"] == 2 and result["items"][0]["id"] == first["id"]
    assert get(api, headers, limit=1, offset=1)["items"][0]["id"] == second["id"]
    assert get(api, headers, sort="oldest", limit=1)["items"][0]["id"] == second["id"]
    assert get(api, headers, "/overview") == dict(openCount=2, openValue=2920, vendorCount=1, lineCount=2, changes=2)
    assert get(api, headers, "/analytics")["vendors"][0]["count"] == 2
    for kind, selected in (("products", product["id"]), ("vendors", values["vendorId"]), ("locations", values["locationId"])):
        page = get(api, headers, f"/references/{kind}", selected_id=selected)
        assert page["filtered"] == 1 and page["items"][0]["id"] == selected
        assert get(api, headers, f"/references/{kind}", query="absent")["filtered"] == 0
    response = api.get(BASE, headers=headers, params=dict(from_date="2026-10-16", to_date="2026-10-14"))
    assert response.status_code == 422 and response.json()["error"]["code"] == "po_date_range"
    assert get(api, headers, query="_")["filtered"] == 2  # literal location label
    assert get(api, headers, query="%")["filtered"] == 0  # not a wildcard


def test_half_up_limits_dates_and_no_client_price_override(client):
    api, db, _ = client
    headers, _, values, product = fixture(api, db, price="0.005000", gst="50.000000")
    values["lines"][0]["quantity"] = "1"
    order, _, _ = save(api, headers, values)
    # Subtotal rounds first; each 25% component rounds independently, not 50% aggregate.
    assert (order["subtotal"], order["gstAmount"], order["total"]) == (1, 0, 1)
    values["lines"] *= 2
    assert api.post(BASE + "/preview", headers=headers, json=values).json()["order"]["total"] == 2
    assert api.post(BASE + "/preview", headers=headers, json={**values, "expectedDate": "2026-10-14"}).status_code == 422
    assert api.post(BASE + "/preview", headers=headers, json={**values, "lines": values["lines"] * 51}).status_code == 422
    values["lines"][0] = {**values["lines"][0], "unitPrice": "0"}
    assert api.post(BASE + "/preview", headers=headers, json=values).status_code == 422
    row = db.get(AllergenProduct, uuid.UUID(product["id"]))
    row.selling_price = Decimal("999999999999.999999")
    db.commit()
    values["lines"] = [dict(productId=product["id"], quantity="1")]
    assert api.post(BASE + "/preview", headers=headers, json=values).status_code == 422


def test_authorization_and_rollback_are_not_mutations(client, monkeypatch):
    api, db, _ = client
    headers, _, values, _ = fixture(api, db)
    reviewed = api.post(BASE + "/preview", headers=headers, json=values).json()
    def fail(*args):
        raise service.POError("Injected failed transaction")
    with monkeypatch.context() as patch:
        patch.setattr(service, "audit", fail)
        result = api.post(BASE, headers=headers, json={**values, "reviewToken": reviewed["reviewToken"], "idempotencyKey": str(uuid.uuid4())})
        assert result.status_code == 503
    assert db.scalar(select(func.count()).select_from(PurchaseOrder)) == 0
    assert db.scalar(select(func.count()).select_from(PurchaseOrderAudit)) == 0
    assert db.scalar(select(func.count()).select_from(PurchaseOrderRequest)) == 0
    assert get(api, headers, "/overview")["changes"] == 0
    _, _, _, record, password = staff_setup(api, db)
    denied = bearer(staff_login(api, record, password))
    for suffix in ("", "/overview", "/activity", "/analytics", "/references/products", "/filter-options/vendors"):
        assert api.get(BASE + suffix, headers=denied).status_code == 403
        assert api.get(BASE + suffix).status_code == 401
    assert api.post(BASE + "/preview", headers=denied, json=values).status_code == 403


def test_full_dataset_vendor_values_renames_and_historical_filter_options(client):
    api, db, _ = client
    headers, _, values, product = fixture(api, db)
    first, _, _ = save(api, headers, values)
    original_vendor = db.get(Vendor, uuid.UUID(values["vendorId"]))
    original_vendor.vendorName = "Renamed historical supplier"
    original_vendor.version += 1
    db.commit()
    renamed, _, _ = save(api, headers, values)
    other_vendor = api.post("/api/v1/admin/vendors", headers=headers, json={
        **FIELDS, "vendorName": "Other supplier", "gstNo": "29EEEEE4444E1Z9"})
    assert other_vendor.status_code == 201, other_vendor.text
    other, _, _ = save(api, headers, {**values, "vendorId": other_vendor.json()["id"],
                                     "lines": [{**values["lines"][0], "quantity": "3"}]})
    assert get(api, headers, limit=1, query=first["number"])["filtered"] == 1
    overview = get(api, headers, "/overview")
    analytics = get(api, headers, "/analytics")
    assert sum(v["amount"] for v in analytics["vendors"]) == overview["openValue"] == first["total"] + renamed["total"] + other["total"]
    assert overview["vendorCount"] == 2 and overview["openCount"] == 3
    assert analytics["vendors"][0]["amount"] == other["total"]
    assert {v["name"] for v in analytics["vendors"]} == {first["vendorName"], renamed["vendorName"], other["vendorName"]}
    choices = get(api, headers, "/filter-options/vendors", limit=1)
    assert choices["filtered"] == choices["total"] == 2 and len(choices["items"]) == 1
    assert get(api, headers, "/filter-options/vendors", query="Renamed historical")["items"][0]["id"] == values["vendorId"]
    assert get(api, headers, "/filter-options/vendors", query=first["vendorName"])["items"][0]["id"] == values["vendorId"]
    deleted = api.post(BASE + f"/{other['id']}/delete", headers=headers,
                      json=dict(expected_version=1, idempotencyKey=str(uuid.uuid4())))
    assert deleted.status_code == 200
    assert get(api, headers, "/overview")["openValue"] == first["total"] + renamed["total"]
    assert get(api, headers, "/analytics")["counts"] == dict(created=3, updated=0, deleted=1)
    assert get(api, headers, "/filter-options/vendors")["total"] == 2


def test_selected_helpers_paging_stale_references_and_line_replacement(client):
    api, db, _ = client
    headers, _, values, product = fixture(api, db)
    order, _, _ = save(api, headers, {**values, "lines": values["lines"] * 2})
    assert len({l["id"] for l in order["lines"]}) == 2
    product_row = db.get(AllergenProduct, uuid.UUID(product["id"]))
    alternate = add(api, headers, {"id": str(product_row.category_id)}, {"id": str(product_row.storage_location_id)},
                    name="Alternate PO product", selling_price="0", gst="0")
    refs = get(api, headers, "/references/products", limit=1)
    assert refs["filtered"] == 2 and len(refs["items"]) == 1
    assert get(api, headers, "/references/products", limit=1, offset=1)["items"][0]["id"] != refs["items"][0]["id"]
    revised, _, _ = save(api, headers, {**values, "lines": [{"productId": alternate["id"], "quantity": "2"}]}, order["id"], 1)
    assert len(revised["lines"]) == 1 and revised["total"] == 0
    assert revised["lines"][0]["id"] not in {l["id"] for l in order["lines"]}
    assert get(api, headers, "/overview")["lineCount"] == 1
    vendor = db.get(Vendor, uuid.UUID(values["vendorId"]))
    from app.core.security import utcnow
    vendor.deleted_at, vendor.deleted_by = utcnow(), vendor.created_by
    db.commit()
    assert api.post(BASE + "/preview", headers=headers, json=values).status_code == 409
    assert get(api, headers, "/references/vendors", selected_id=values["vendorId"])["filtered"] == 0
    assert get(api, headers, f"/{order['id']}")["vendorName"] == order["vendorName"]
