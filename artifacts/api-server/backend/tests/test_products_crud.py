"""Only stock-product operations on synthetic disposable PostgreSQL."""
import uuid
from decimal import Decimal
import pytest
from sqlalchemy import select, func, text
from sqlalchemy.exc import DBAPIError
from app.db.models import AuditEvent
from app.db.product_models import ComboProduct, ProductRevision, ProductAssembly, ProductRequest
from app.db.inventory_models import InventoryBalance, InventoryLot, InventoryPosting
from app.db.allergen_models import AllergenProduct
from app.services import products, inventory
from app.services.auth import identity_from_token
from test_sessions import client, create_user, login
from test_purchase_orders import fixture, save as save_po
from test_purchase_received_crud import save as save_receipt
from test_allergens import add
from test_inventory_crud import destination, move_draft, create_move
from test_zone_permissions import setup as staff_setup, staff_login, bearer

BASE = "/api/v1/admin/products"
STOCK = "/api/v1/admin/inventory"


def get(api, headers, suffix="", **params):
    response = api.get(BASE + suffix, headers=headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def setup(api, db):
    headers, actor, values, first = fixture(api, db)
    second = add(api, headers, {"id": first["category_id"]},
        {"id": values["locationId"]}, name="Second reagent", selling_price="90")
    values["lines"] = [dict(productId=p["id"], quantity="10") for p in (first, second)]
    po, _, _ = save_po(api, headers, values)
    receipt_draft = dict(poId=po["id"], receivedDate="2026-10-19", receiverMode="other", staffId=None,
        otherName="Synthetic receiver", lines=[
            dict(lineId=line["id"], receivedQty="10", acceptedQty="10",
                 batchNo="SOURCE-" + str(i), expiryDate="2027-10-19")
            for i, line in enumerate(po["lines"])])
    receipt, _ = save_receipt(api, headers, receipt_draft)
    lots = api.get(STOCK + "/references/lots", headers=headers,
                   params={"source_id": values["locationId"], "limit": 100}).json()["items"]
    fields = dict(name="Private two-allergen combo", mrp="100.005", sellingPrice="87.555", status="active",
        members=[dict(allergenId=first["id"], quantity="0.125"), dict(allergenId=second["id"], quantity="0.250")])
    return headers, actor, fields, lots, receipt, receipt_draft


def create(api, headers, fields):
    body = dict(**fields, idempotencyKey=str(uuid.uuid4()))
    response = api.post(BASE, headers=headers, json=body)
    assert response.status_code == 201, response.text
    return response.json(), body


def draft(product, lots, receipt, count=2):
    quantities = {m["allergenId"]: inventory.q(Decimal(m["quantity"]) * count) for m in product["members"]}
    return dict(productId=product["id"], expected_version=product["version"],
        locationId=receipt["locationId"], quantity=count, batchNo="FINISHED-ONLY", expiryDate="2027-01-01",
        allocations=[dict(lotId=l["id"], quantity=quantities[l["productId"]]) for l in lots])


def review(api, headers, values):
    response = api.post(BASE + "/assemblies/preview", headers=headers, json=values)
    assert response.status_code == 200, response.text
    return response.json()


def assemble(api, headers, values):
    preview = review(api, headers, values)
    body = dict(**values, reviewToken=preview["reviewToken"], idempotencyKey=str(uuid.uuid4()))
    response = api.post(BASE + "/assemblies", headers=headers, json=body)
    assert response.status_code == 201, response.text
    return response.json(), body


def test_product_crud_exact_independent_prices_versions_history_and_retry(client):
    api, db, settings = client
    headers, actor, fields, lots, receipt, _ = setup(api, db)
    before = [r.quantity for r in db.scalars(select(InventoryBalance).order_by(InventoryBalance.lot_id))]
    product, body = create(api, headers, fields)
    assert (product["mrp"], product["sellingPrice"]) == ("100.01", "87.56")
    assert product["members"][0]["unit"] == "procurement quantity units"
    assert api.post(BASE, headers=headers, json=body).json() == product
    assert get(api, headers, "/requests/" + body["idempotencyKey"])["result"] == product
    assert [r.quantity for r in db.scalars(select(InventoryBalance).order_by(InventoryBalance.lot_id))] == before
    assert api.post(BASE, headers=headers, json={**body, "idempotencyKey": str(uuid.uuid4()), "name": fields["name"].upper()}).status_code == 409
    edited = api.put(BASE + "/" + product["id"], headers=headers, json={
        **body, "idempotencyKey": str(uuid.uuid4()), "expected_version": 1, "mrp": "100", "sellingPrice": "10"})
    assert edited.status_code == 200, edited.text
    assert edited.json()["version"] == 2
    assert api.put(BASE + "/" + product["id"], headers=headers, json={
        **body, "idempotencyKey": str(uuid.uuid4()), "expected_version": 1}).status_code == 409
    assert get(api, headers, query="two-allergen", limit=1)["summary"]["products"] == 1
    history = get(api, headers, f"/{product['id']}/activity")
    assert history["filtered"] == 2 and history["items"][0]["before"]["sellingPrice"] == "87.56"
    assert history["items"][0]["after"]["sellingPrice"] == "10.00"
    assert get(api, headers, f"/{product['id']}/activity", limit=1, offset=1)["items"][0]["action"] == "create"
    assert db.scalar(select(func.count()).select_from(ProductRevision)) == 2
    assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "product_create")) == 1
    for model in (ComboProduct, ProductRevision, ProductRequest):
        for row in db.scalars(select(model)):
            assert fields["name"] not in row.payload_ciphertext and "87.56" not in row.payload_ciphertext
    deletion = dict(expected_version=2, idempotencyKey=str(uuid.uuid4()))
    deleted = api.request("DELETE", BASE + "/" + product["id"], headers=headers, json=deletion)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deletedAt"]
    assert api.request("DELETE", BASE + "/" + product["id"], headers=headers, json=deletion).json() == deleted.json()
    assert get(api, headers)["total"] == 0
    assert get(api, headers, "/" + product["id"])["deletedAt"]


def test_assembly_atomic_debits_output_history_retries_and_unchanged_snapshots(client):
    api, db, settings = client
    headers, actor, fields, lots, receipt, receipt_draft = setup(api, db)
    product, body = create(api, headers, fields)
    values = draft(product, lots, receipt)
    assembly, request = assemble(api, headers, values)
    assert assembly["outputBefore"] == "0.000" and assembly["outputAfter"] == "2.000"
    assert assembly["actorId"] == str(actor.id)
    assert {c["after"] for c in assembly["components"]} == {"9.750", "9.500"}
    assert {c["batchNo"] for c in assembly["components"]} == {"SOURCE-0", "SOURCE-1"}
    assert all(c["receiptId"] == receipt["id"] for c in assembly["components"])
    assert api.post(BASE + "/assemblies", headers=headers, json=request).json() == assembly
    assert get(api, headers, "/requests/" + request["idempotencyKey"])["result"] == assembly
    assert db.scalar(select(func.count()).select_from(ProductAssembly)) == 1
    assert db.scalar(select(func.count()).select_from(InventoryPosting)) == 5
    stock = api.get(STOCK + "/stock", headers=headers, params={"snapshot": True}).json()
    combo = next(r for r in stock["snapshot"] if r["itemKind"] == "combo")
    assert combo["lots"][0]["comboProductId"] == product["id"]
    assert combo["lots"][0]["assembledQuantity"] == "2"
    assert combo["quantity"] == "2.000" and combo["unit"] == "whole combos" and combo["categoryId"] is None
    assert combo["lots"][0]["receiptId"] is None and combo["lots"][0]["assemblyId"] == assembly["id"]
    assert combo["lots"][0]["sourceComponents"][0]["before"] == "10.000"
    assert combo["lots"][0]["recipe"]["version"] == 1
    assert api.get(STOCK + f"/stock/{product['id']}/history", headers=headers).json()["filtered"] == 1
    assert get(api, headers, f"/{product['id']}/analytics")["remaining"][0]["quantity"] == "2.000"
    # Future price/recipe edits cannot rewrite already assembled lots.
    updated_fields = {**fields, "name": "New combo label", "sellingPrice": "1", "members": [
        {**m, "quantity": "0.500"} for m in fields["members"]]}
    updated = api.put(BASE + "/" + product["id"], headers=headers, json={
        **updated_fields, "expected_version": 1, "idempotencyKey": str(uuid.uuid4())})
    assert updated.status_code == 200, updated.text
    assert get(api, headers, "/assemblies/" + assembly["id"]) == assembly
    assert get(api, headers, f"/{product['id']}/assemblies")["items"][0] == assembly
    lot = db.get(InventoryLot, uuid.UUID(assembly["lotId"]))
    meta = inventory.InventoryCrypto(settings).open(lot.id, "lot", lot.payload_ciphertext)
    assert meta["sellingPrice"] == "87.56" and meta["productName"] == fields["name"]
    # Source correction cannot invent the consumed balance back or rewrite identity.
    changed = {**receipt_draft, "lines": [{**l, "batchNo": "REPLACED"} for l in receipt_draft["lines"]]}
    reviewed = api.post("/api/v1/admin/purchase-received/" + receipt["id"] + "/preview", headers=headers, json=changed)
    assert reviewed.status_code == 200, reviewed.text
    response = api.post("/api/v1/admin/purchase-received/" + receipt["id"] + "/edit", headers=headers,
        json={**changed, "expected_version": receipt["version"], "idempotencyKey": str(uuid.uuid4()),
              "reviewToken": reviewed.json()["reviewToken"]})
    assert response.status_code == 409
    evidence = api.get(STOCK + "/initialization", headers=headers).json()["items"][0]
    assert evidence["state"] == "current" and all(e["matches"] for e in evidence["reconciliation"])
    assert {e["consumedInAssemblies"] for e in evidence["reconciliation"]} == {"0.250", "0.500"}
    # History triggers prohibit altering committed assembly evidence.
    with pytest.raises(DBAPIError):
        with db.begin_nested():
            db.execute(text("UPDATE product_assemblies SET quantity=1"))


def test_assembly_validation_stale_reviews_insufficiency_and_closed_identity(client):
    api, db, settings = client
    headers, actor, fields, lots, receipt, _ = setup(api, db)
    product, _ = create(api, headers, fields)
    values = draft(product, lots, receipt)
    token = review(api, headers, values)["reviewToken"]
    count = db.scalar(select(func.count()).select_from(InventoryPosting))
    for patch in (dict(quantity=1.5), dict(quantity=True), dict(quantity=0), dict(expiryDate="2028-01-01"),
                  dict(locationId=str(destination(db, actor).id)), dict(allocations=[values["allocations"][0]]),
                  dict(allocations=[values["allocations"][0], values["allocations"][0]]),
                  dict(allocations=[{**a, "quantity": "11"} for a in values["allocations"]])):
        response = api.post(BASE + "/assemblies/preview", headers=headers, json={**values, **patch})
        assert response.status_code in (409, 422), response.text
    key = str(uuid.uuid4())
    assert get(api, headers, "/requests/" + key)["state"] == "not_committed"
    assert api.post(BASE + "/assemblies", headers=headers, json={
        **values, "reviewToken": token, "idempotencyKey": key}).status_code == 409
    assemble(api, headers, values)
    assert api.post(BASE + "/assemblies", headers=headers, json={
        **values, "reviewToken": token, "idempotencyKey": str(uuid.uuid4())}).status_code == 409
    assert db.scalar(select(func.count()).select_from(ProductAssembly)) == 1
    member = db.get(AllergenProduct, uuid.UUID(fields["members"][0]["allergenId"]))
    member.status = "inactive"
    db.commit()
    assert api.post(BASE + "/assemblies/preview", headers=headers, json=values).status_code == 409
    member.status = "active"
    db.commit()
    response = api.patch(BASE + "/" + product["id"] + "/status", headers=headers,
        json=dict(expected_version=1, status="inactive", idempotencyKey=str(uuid.uuid4())))
    assert response.status_code == 200, response.text
    assert api.post(BASE + "/assemblies/preview", headers=headers, json=values).status_code == 409
    assert db.scalar(select(func.count()).select_from(InventoryPosting)) == count + 3
    # No quantity or price may come from floats, duplicate members or nested combos.
    for patch in (dict(mrp=-1), dict(mrp="1", sellingPrice="2"), dict(sellingPrice="1e2"),
                  dict(members=[fields["members"][0]] * 2),
                  dict(members=[{**fields["members"][0], "allergenId": product["id"]}, fields["members"][1]]),
                  dict(members=[{**m, "quantity": "0.0001"} for m in fields["members"]])):
        assert api.post(BASE, headers=headers, json={**fields, "name": "Other combo",
            "idempotencyKey": str(uuid.uuid4()), **patch}).status_code in (409, 422)


def test_deleted_combo_stock_remains_transferable_whole_and_retains_assembly(client):
    api, db, settings = client
    headers, actor, fields, lots, receipt, _ = setup(api, db)
    product, _ = create(api, headers, fields)
    assembly, _ = assemble(api, headers, draft(product, lots, receipt))
    response = api.request("DELETE", BASE + "/" + product["id"], headers=headers, json={
        "expected_version": 1, "idempotencyKey": str(uuid.uuid4())})
    assert response.status_code == 200, response.text
    dst = destination(db, actor)
    values = move_draft(receipt, assembly["lotId"], dst)
    assert api.post(STOCK + "/movements/preview", headers=headers, json=values).status_code == 422
    values["lines"][0]["quantity"] = "1"
    movement, _ = create_move(api, headers, values)
    line = movement["lines"][0]
    assert line["itemKind"] == "combo" and line["assemblyId"] == assembly["id"]
    assert line["sourceComponents"][0]["before"] == "10.000"
    assert line["recipe"]["version"] == 1 and line["sellingPrice"] == "87.56"
    stock = api.get(STOCK + "/stock", headers=headers, params={"snapshot": True}).json()["snapshot"]
    combo = next(r for r in stock if r["productId"] == product["id"])
    assert len(combo["lots"]) == 2 and combo["quantity"] == "2.000"
    assert {r["quantity"] for r in stock if r["itemKind"] == "allergen"} == {"9.750", "9.500"}
    assert get(api, headers, f"/{product['id']}/analytics")["assemblies"] == 1
    assert len(get(api, headers, f"/{product['id']}/analytics")["remaining"]) == 2
    assert get(api, headers, "/assemblies/" + assembly["id"]) == assembly
    assert api.delete(BASE + "/assemblies/" + assembly["id"], headers=headers).status_code == 405


def test_products_singleton_only_and_safe_reconciliation(client):
    api, db, settings = client
    headers, actor, fields, lots, receipt, _ = setup(api, db)
    product, body = create(api, headers, fields)
    assert api.get(BASE).status_code == 401
    user = create_user(db, "products-mr@example.com")
    mr = login(api, user.email)
    denied = {"Authorization": "Bearer " + mr.json()["access_token"]}
    assert api.get(BASE, headers=denied).status_code == 403
    assert api.post(BASE, headers=denied, json=body).status_code == 403
    assert api.get(BASE + "/requests/" + body["idempotencyKey"], headers=denied).status_code == 403
    # Actor-bound reconciliation is not granted by Staff workspace/master grants.
    sh, _, role, staff, password = staff_setup(api, db)
    staff_headers = bearer(staff_login(api, staff, password))
    assert api.get(BASE, headers=staff_headers).status_code == 403
    assert api.get(BASE + "/references", headers=staff_headers).status_code == 403


def test_assembly_rollback_stale_recipe_and_full_filter_counts(client, monkeypatch):
    api, db, settings = client
    headers, actor, fields, lots, receipt, _ = setup(api, db)
    first, body = create(api, headers, fields)
    second, _ = create(api, headers, {**fields, "name": "Second combo"})
    values = draft(first, lots, receipt)
    token = review(api, headers, values)["reviewToken"]
    before = {r.lot_id: r.quantity for r in db.scalars(select(InventoryBalance))}
    real_post = inventory.post
    calls = []

    def fail_after_debit(*args, **kwargs):
        result = real_post(*args, **kwargs)
        calls.append(result)
        if len(calls) == 1:
            raise inventory.PRError("Synthetic posting failure", 503, "synthetic_failure")
        return result

    key = str(uuid.uuid4())
    with monkeypatch.context() as patch:
        patch.setattr(inventory, "post", fail_after_debit)
        response = api.post(BASE + "/assemblies", headers=headers, json={
            **values, "reviewToken": token, "idempotencyKey": key})
        assert response.status_code == 503
    assert {r.lot_id: r.quantity for r in db.scalars(select(InventoryBalance))} == before
    assert db.scalar(select(func.count()).select_from(ProductAssembly)) == 0
    assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "product_assembled")) == 0
    assert db.get(ProductRequest, uuid.UUID(key)) is None
    edited = api.put(BASE + "/" + first["id"], headers=headers, json={
        **fields, "sellingPrice": "1", "expected_version": 1, "idempotencyKey": str(uuid.uuid4())})
    assert edited.status_code == 200, edited.text
    assert api.post(BASE + "/assemblies", headers=headers, json={
        **values, "reviewToken": token, "idempotencyKey": str(uuid.uuid4())}).status_code == 409
    assert api.post(BASE + "/assemblies/preview", headers=headers, json=values).status_code == 409
    assemble(api, headers, draft(second, lots, receipt))
    page = get(api, headers, limit=1, offset=0)
    assert len(page["items"]) == 1 and page["summary"]["products"] == 2
    assert page["summary"]["assemblies"] == 1
    assert get(api, headers, query=first["name"])["summary"]["assemblies"] == 0
