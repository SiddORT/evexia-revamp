"""Focused inventory/receipt create, read, update, delete contracts only."""
import uuid
from decimal import Decimal
from sqlalchemy import select, func
from app.db.inventory_models import InventoryLot, InventoryBalance, InventoryPosting, InventoryMovement, InventoryRequest, InventoryReceiptState
from app.db.location_models import StorageLocation
from app.db.models import AuditEvent
from app.services import inventory
from app.services.purchase_received_crypto import ReceiptCrypto
from app.services.auth import identity_from_token
from test_sessions import client
from test_purchase_received_crud import seed, save

BASE = "/api/v1/admin/inventory"
PR = "/api/v1/admin/purchase-received"


def get(api, headers, path, **params):
    r = api.get(BASE + path, headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def destination(db, actor):
    row = StorageLocation(id=uuid.uuid4(), name="Private destination", address="Private address",
        pincode="", countryCode="", state="", city="", status="active", version=1,
        created_by=actor.id, updated_by=actor.id)
    db.add(row)
    db.commit()
    return row


def move_draft(receipt, lot, dst):
    return dict(sourceId=receipt["locationId"], destinationId=str(dst.id), date="2026-10-19",
        deliveryMode="other", staffId=None, otherName="Private delivery person",
        lines=[dict(lotId=lot, quantity="1.001")])


def create_move(api, headers, draft):
    review = api.post(BASE + "/movements/preview", headers=headers, json=draft)
    assert review.status_code == 200, review.text
    body = dict(**draft, reviewToken=review.json()["reviewToken"], idempotencyKey=str(uuid.uuid4()))
    response = api.post(BASE + "/movements", headers=headers, json=body)
    assert response.status_code == 201, response.text
    return response.json(), body


def test_inventory_receipt_and_movement_crud_exact_snapshots_and_retries(client):
    api, db, settings = client
    headers, actor, po, staff, draft = seed(api, db)
    before = get(api, headers, "/stock", snapshot=True)
    assert before["coverage"]["complete"] and before["snapshot"][0]["quantity"] == "0.000"
    receipt, receipt_body = save(api, headers, draft)
    stock = get(api, headers, "/stock", snapshot=True)
    product = stock["snapshot"][0]
    assert product["quantity"] == "2.125"
    assert len(product["lots"]) == 1
    lot = product["lots"][0]
    assert lot["receiptId"] == receipt["id"] and lot["lineId"] == draft["lines"][0]["lineId"]
    assert "0.001" in stock["coverage"]["contract"]
    assert get(api, headers, "/stock", product_ids=str(uuid.uuid4()))["items"] == []
    dst = destination(db, actor)
    data, body = create_move(api, headers, move_draft(receipt, lot["lotId"], dst))
    assert data["deliveredBy"] == "Private delivery person" and data["actorId"] == str(actor.id)
    assert data["destination"] == dict(id=str(dst.id), name="Private destination", address="Private address",
        pincode="", countryCode="", state="", city="", version=1)
    assert data["appendOnly"]
    line = data["lines"][0]
    assert (line["sourceBefore"], line["sourceAfter"], line["destinationBefore"], line["destinationAfter"]) == ("2.125", "1.124", "0.000", "1.001")
    assert api.post(BASE + "/movements", headers=headers, json=body).json() == data
    assert get(api, headers, "/requests/" + body["idempotencyKey"])["movement"] == data
    assert db.scalar(select(func.count()).select_from(InventoryMovement)) == 1
    assert db.scalar(select(func.count()).select_from(InventoryPosting)) == 3
    current = get(api, headers, "/stock", snapshot=True)["snapshot"][0]
    assert current["quantity"] == "2.125" and len(current["lots"]) == 2
    assert get(api, headers, "/movements", query="Private destination")["summary"]["movements"] == 1
    assert get(api, headers, "/movements/" + data["id"] + "/analytics")["lots"] == 1
    assert get(api, headers, "/movements/" + data["id"] + "/activity")[0]["actor"] == data["actor"]
    assert get(api, headers, f"/stock/{product['productId']}/history")["filtered"] == 3
    assert get(api, headers, f"/stock/{product['productId']}/history", from_date="2030-01-01T00:00:00Z")["items"] == []
    assert get(api, headers, "/stock")["items"][0]["quantity"] == "2.125"
    dst.name, dst.address, dst.status = "Renamed", "Changed", "inactive"
    db.commit()
    assert get(api, headers, "/movements/" + data["id"]) == data
    ciphertexts = [db.get(InventoryMovement, uuid.UUID(data["id"])).payload_ciphertext,
        db.get(InventoryLot, uuid.UUID(lot["lotId"])).payload_ciphertext,
        db.get(InventoryRequest, uuid.UUID(body["idempotencyKey"])).payload_ciphertext]
    for secret in ("Private address", "Private destination", "Private delivery person", "PRIVATE-BATCH"):
        assert all(secret not in c for c in ciphertexts)
    # Committed moves have no update/delete endpoints.
    assert api.delete(BASE + "/movements/" + data["id"], headers=headers).status_code == 405
    assert api.post(BASE + "/movements/" + data["id"] + "/edit", headers=headers, json={}).status_code == 404
    # A receipt with transferred stock cannot be deleted or have lot identity changed.
    response = api.post(PR + f"/{receipt['id']}/delete", headers=headers,
        json=dict(expected_version=receipt["version"], idempotencyKey=str(uuid.uuid4())))
    assert response.status_code == 409, response.text
    changed = {**draft, "lines": [{**draft["lines"][0], "batchNo": "CHANGED"}]}
    review = api.post(PR + f"/{receipt['id']}/preview", headers=headers, json=changed)
    response = api.post(PR + f"/{receipt['id']}/edit", headers=headers, json=dict(**changed,
        expected_version=receipt["version"], reviewToken=review.json()["reviewToken"], idempotencyKey=str(uuid.uuid4())))
    assert response.status_code == 409, response.text
    reduced = {**draft, "lines": [{**draft["lines"][0], "acceptedQty": "1.001"}]}
    updated, _ = save(api, headers, reduced, receipt)
    assert get(api, headers, "/stock")["items"][0]["quantity"] == "1.001"
    assert get(api, headers, "/stock")["items"][0]["lots"][0]["quantity"] == "1.001"


def test_inventory_create_validation_staff_minimal_choices_and_retry_cancellation(client):
    api, db, settings = client
    headers, actor, po, staff, draft = seed(api, db)
    receipt, _ = save(api, headers, draft)
    lot = get(api, headers, "/stock")["items"][0]["lots"][0]
    dst = destination(db, actor)
    values = move_draft(receipt, lot["lotId"], dst)
    choices = get(api, headers, "/references/staff")
    assert set(choices["items"][0]) == {"id", "name"}
    assert get(api, headers, "/references/lots", source_id=receipt["locationId"])["items"][0]["available"] == "2.125"
    for patch in (dict(destinationId=receipt["locationId"]), dict(otherName=" "),
                  dict(staffId=staff["id"]), dict(lines=[dict(lotId=lot["lotId"], quantity="0")]),
                  dict(lines=[dict(lotId=lot["lotId"], quantity="1.0001")]),
                  dict(lines=[dict(lotId=lot["lotId"], quantity="3")])):
        response = api.post(BASE + "/movements/preview", headers=headers, json={**values, **patch})
        assert response.status_code in (409, 422), response.text
    token = api.post(BASE + "/movements/preview", headers=headers, json=values).json()["reviewToken"]
    key = str(uuid.uuid4())
    assert get(api, headers, "/requests/" + key)["state"] == "not_committed"
    response = api.post(BASE + "/movements", headers=headers, json=dict(**values, reviewToken=token, idempotencyKey=key))
    assert response.status_code == 409
    assert get(api, headers, "/requests/" + key)["state"] == "not_committed"
    staff_values = {**values, "deliveryMode": "staff", "staffId": staff["id"], "otherName": None}
    data, _ = create_move(api, headers, staff_values)
    assert data["deliveryMode"] == "staff" and data["staffId"] == staff["id"]
    # Another create invalidates earlier reviewed balances; no second transfer.
    response = api.post(BASE + "/movements", headers=headers, json=dict(**values, reviewToken=token, idempotencyKey=str(uuid.uuid4())))
    assert response.status_code == 409
    assert api.get(BASE + "/stock").status_code == 401
    assert db.scalar(select(func.count()).select_from(InventoryMovement)) == 1


def test_inventory_distinct_receipt_provenance_edit_and_soft_delete(client):
    api, db, settings = client
    headers, actor, po, staff, draft = seed(api, db)
    first, _ = save(api, headers, draft)
    second, _ = save(api, headers, draft)
    rows = get(api, headers, "/stock")["items"][0]
    assert rows["quantity"] == "4.250" and len(rows["lots"]) == 2
    assert len({l["lotId"] for l in rows["lots"]}) == 2
    assert len({l["batchNo"] for l in rows["lots"]}) == 1
    updated, _ = save(api, headers, {**draft, "lines": [{**draft["lines"][0], "acceptedQty": "1.500"}]}, first)
    assert get(api, headers, "/stock")["items"][0]["quantity"] == "3.625"
    response = api.post(PR + f"/{second['id']}/delete", headers=headers,
        json=dict(expected_version=second["version"], idempotencyKey=str(uuid.uuid4())))
    assert response.status_code == 200, response.text
    assert get(api, headers, "/stock")["items"][0]["quantity"] == "1.500"
    assert get(api, headers, "/initialization")["coverage"]["complete"]


def test_inventory_existing_receipt_initialization_crud_is_explicit_and_exactly_once(client, monkeypatch):
    api, db, settings = client
    headers, user, po, staff, draft = seed(api, db)
    # Synthetic historical receipt: create through real receipt CRUD while the
    # new posting hook alone is temporarily disabled, never on a managed DB.
    with monkeypatch.context() as patch:
        patch.setattr(inventory, "reconcile_receipt", lambda *a, **kw: None)
        receipt, _ = save(api, headers, draft)
    stock = get(api, headers, "/stock", snapshot=True)
    assert not stock["coverage"]["complete"] and stock["coverage"]["pendingReceipts"] == 1
    assert stock["items"] == [] and stock["snapshot"] is None
    report = get(api, headers, "/initialization")["items"][0]
    assert report["state"] == "eligible"
    assert report["reconciliation"][0]["accepted"] == "2.125"
    assert report["reconciliation"][0]["posted"] == "0.000"
    assert not report["reconciliation"][0]["matches"]
    actor = identity_from_token(db, headers["Authorization"].removeprefix("Bearer "), settings)
    initialized = inventory.initialize_one(db, actor, uuid.UUID(receipt["id"]), report["reviewToken"])
    assert initialized["state"] == "initialized"
    assert initialized["reconciliation"][0]["matches"]
    again = inventory.initialize_one(db, actor, uuid.UUID(receipt["id"]), report["reviewToken"])
    assert again["state"] == "already_current"
    assert db.scalar(select(func.count()).select_from(InventoryPosting)) == 1
    assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "inventory_initialized")) == 1
    stock = get(api, headers, "/stock")
    assert stock["coverage"]["complete"] and stock["items"][0]["quantity"] == "2.125"
    report = get(api, headers, "/initialization")["items"][0]
    assert report["state"] == "current" and report["initializedAt"] and report["originalCreatedAt"]
    assert report["historicalLocationGeography"].startswith("unavailable")


def test_inventory_unavailable_initialization_fails_closed(client, monkeypatch):
    api, db, settings = client
    headers, user, po, staff, draft = seed(api, db)
    with monkeypatch.context() as patch:
        patch.setattr(inventory, "reconcile_receipt", lambda *a, **kw: None)
        receipt, _ = save(api, headers, draft)
    from app.db.purchase_received_models import PurchaseReceipt
    row = db.get(PurchaseReceipt, uuid.UUID(receipt["id"]))
    crypto = ReceiptCrypto(settings)
    data = crypto.open(row.id, "receipt", row.payload_ciphertext)
    data["locationId"] = str(uuid.uuid4())
    row.payload_ciphertext = crypto.seal(row.id, "receipt", data)
    db.commit()
    report = get(api, headers, "/initialization")
    assert report["items"][0]["state"] == "unavailable"
    assert not report["coverage"]["complete"]
    assert get(api, headers, "/stock")["items"] == []
    assert db.scalar(select(func.count()).select_from(InventoryPosting)) == 0
