"""Only PR CRUD cases, including validation, snapshots, encryption and balances."""
import json
import uuid
from decimal import Decimal
import pytest
from sqlalchemy import select
from pydantic import SecretStr
from app.db.purchase_received_models import PurchaseReceipt, ReceiptHistory, ReceiptRetry
from app.db.purchase_order_models import PurchaseOrder
from app.db.staff_models import StaffProfile
from app.db.vendor_models import Vendor
from app.db.allergen_models import AllergenProduct
from app.db.location_models import StorageLocation
from app.db.models import AuditEvent
from test_sessions import client
from test_purchase_orders import fixture, save as save_po
from test_staff import BODY, seed_designation

BASE = "/api/v1/admin/purchase-received"
PO = "/api/v1/admin/purchase-orders"


def seed(api, db):
    headers, actor, values, product = fixture(api, db)
    values["lines"] = [{**values["lines"][0], "quantity": "10"}, {**values["lines"][0], "quantity": "5"}]
    po, _, _ = save_po(api, headers, values)
    seed_designation(db, actor.id)
    staff_result = api.post("/api/v1/admin/staff", headers=headers, json=BODY)
    assert staff_result.status_code == 201, staff_result.text
    staff = staff_result.json()["record"]
    draft = dict(poId=po["id"], receivedDate="2026-10-16", receiverMode="staff", staffId=staff["id"], otherName=None,
                 lines=[dict(lineId=po["lines"][0]["id"], receivedQty="3.125", acceptedQty="2.125", batchNo="PRIVATE-BATCH", expiryDate="2027-10-16")])
    return headers, actor, po, staff, draft


def get(api, headers, path="", **params):
    result = api.get(BASE + path, headers=headers, params=params)
    assert result.status_code == 200, result.text
    return result.json()


def save(api, headers, draft, receipt=None):
    prefix = f"/{receipt['id']}" if receipt else ""
    review = api.post(BASE + prefix + "/preview", headers=headers, json=draft)
    assert review.status_code == 200, review.text
    body = {**draft, "reviewToken": review.json()["reviewToken"], "idempotencyKey": str(uuid.uuid4())}
    if receipt:
        body["expected_version"] = receipt["version"]
    result = api.post(BASE + (prefix + "/edit" if receipt else ""), headers=headers, json=body)
    assert result.status_code == (200 if receipt else 201), result.text
    return result.json(), body


def test_staff_create_read_list_edit_delete_snapshots_encryption(client):
    api, db, settings = client
    headers, actor, po, staff, draft = seed(api, db)
    choices = get(api, headers, "/references/staff", selected_id=staff["id"])
    assert choices["filtered"] == 1
    assert set(choices["items"][0]) == {"id", "name"}
    assert not any(k in choices["items"][0] for k in ("email", "phone", "phoneNo"))
    receipt, body = save(api, headers, draft)
    assert receipt["staffId"] == staff["id"] and receipt["receiverMode"] == "staff"
    assert receipt["receivedBy"] == BODY["name"]
    assert receipt["poId"] == po["id"] and receipt["poNumber"] == po["number"]
    assert receipt["vendorId"] == po["vendorId"] and receipt["locationId"] == po["locationId"]
    line = receipt["lines"][0]
    assert line["lineId"] == po["lines"][0]["id"] and line["productId"] == po["lines"][0]["productId"]
    assert Decimal(line["balanceAfterQty"]) == Decimal("7.875")
    assert line["rejectedQty"] == "1.000"
    assert get(api, headers, "/" + receipt["id"]) == receipt
    assert get(api, headers, limit=1)["items"][0]["id"] == receipt["id"]
    assert get(api, headers, receiver="staff:" + staff["id"])["filtered"] == 1
    assert get(api, headers, query=BODY["name"])["filtered"] == 1
    assert api.post(BASE, headers=headers, json=body).json() == receipt
    assert get(api, headers, "/requests/" + body["idempotencyKey"])["receipt"] == receipt
    row = db.get(PurchaseReceipt, uuid.UUID(receipt["id"]))
    history = db.scalar(select(ReceiptHistory).where(ReceiptHistory.receipt_id == row.id))
    retry = db.get(ReceiptRetry, uuid.UUID(body["idempotencyKey"]))
    for ciphertext in (row.payload_ciphertext, history.payload_ciphertext, retry.payload_ciphertext):
        assert ciphertext.startswith("v1:primary:")
        for sensitive in (BODY["name"], "PRIVATE-BATCH", po["vendorName"], po["locationName"], po["lines"][0]["productName"]):
            assert sensitive not in ciphertext
    audit = db.get(AuditEvent, history.event_id)
    assert audit.actor_id == actor.id and audit.session_id and audit.resource_id == row.id
    assert audit.details is None if hasattr(audit, "details") else True
    # Missing/wrong keys never expose plaintext or accept an edit.
    old_keys = settings.pr_encryption_keys
    settings.pr_encryption_keys = None
    assert api.get(BASE + "/" + receipt["id"], headers=headers).status_code == 503
    settings.pr_encryption_keys = SecretStr('{"primary":"SEhISEhISEhISEhISEhISEhISEhISEhISEhISEhISEg="}')
    assert api.get(BASE + "/" + receipt["id"], headers=headers).status_code == 503
    settings.pr_encryption_keys = old_keys
    # Source masters can change without changing saved labels.
    db.get(Vendor, uuid.UUID(po["vendorId"])).vendorName = "Renamed supplier"
    db.get(AllergenProduct, uuid.UUID(po["lines"][0]["productId"])).name = "Renamed product"
    db.get(StorageLocation, uuid.UUID(po["locationId"])).name = "Renamed location"
    staff_row = db.get(StaffProfile, uuid.UUID(staff["id"]))
    staff_row.status = "inactive"
    db.commit()
    assert get(api, headers, "/" + receipt["id"]) == receipt
    assert get(api, headers, "/references/staff", selected_id=staff["id"])["items"] == []
    # Active receipt blocks PO changes in the same locked source boundary.
    assert api.post(PO + f"/{po['id']}/delete", headers=headers,
                    json=dict(expected_version=po["version"], idempotencyKey=str(uuid.uuid4()))).status_code == 409
    edited = {**draft, "lines": [{**draft["lines"][0], "batchNo": "CORRECTED-PRIVATE"}]}
    updated, update_body = save(api, headers, edited, receipt)
    assert updated["version"] == 2 and updated["receivedBy"] == receipt["receivedBy"]
    assert updated["vendorName"] == receipt["vendorName"] and updated["lines"][0]["productName"] == line["productName"]
    assert updated["lines"][0]["balanceAfterQty"] == line["balanceAfterQty"]
    assert api.post(BASE + f"/{receipt['id']}/edit", headers=headers, json=update_body).json() == updated
    assert api.post(BASE + f"/{receipt['id']}/edit", headers=headers,
                    json={**update_body, "idempotencyKey": str(uuid.uuid4())}).status_code == 409
    delete_body = dict(expected_version=2, idempotencyKey=str(uuid.uuid4()))
    deleted = api.post(BASE + f"/{receipt['id']}/delete", headers=headers, json=delete_body)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["status"] == "deleted"
    assert api.post(BASE + f"/{receipt['id']}/delete", headers=headers, json=delete_body).json() == deleted.json()
    assert get(api, headers)["filtered"] == 0
    assert get(api, headers, status="deleted")["items"][0]["id"] == receipt["id"]
    source = get(api, headers, "/sources/" + po["id"])
    assert source["fulfillment"] == "Open" and Decimal(source["balances"][line["lineId"]]) == 10
    assert source["receipts"][0]["lines"][0]["batchNo"] == "CORRECTED-PRIVATE"
    assert db.scalar(select(PurchaseOrder).where(PurchaseOrder.id == uuid.UUID(po["id"]))).total == po["total"]


def test_others_partial_receipt_corrections_validation_and_durable_retry(client):
    api, db, settings = client
    headers, actor, po, staff, draft = seed(api, db)
    draft.update(receiverMode="other", staffId=None, otherName="  Private Other Person  ")
    invalid = [
        {**draft, "otherName": "  "}, {**draft, "staffId": staff["id"]},
        {**draft, "receiverMode": "staff", "staffId": staff["id"]},
        {**draft, "receivedDate": "2026-10-14"},
    ]
    for fields in (dict(receivedQty="1.0001"), dict(receivedQty="0"), dict(acceptedQty="4"),
                   dict(batchNo=" "), dict(expiryDate="2026-10-15"), dict(receivedQty="11")):
        invalid.append({**draft, "lines": [{**draft["lines"][0], **fields}]})
    for body in invalid:
        result = api.post(BASE + "/preview", headers=headers, json=body)
        assert result.status_code == 422, result.text
    draft["lines"] = [{**draft["lines"][0], "receivedQty": "10", "acceptedQty": "5"},
                      {**draft["lines"][0], "lineId": po["lines"][1]["id"], "receivedQty": "5", "acceptedQty": "5"}]
    first, first_body = save(api, headers, draft)
    assert first["receivedBy"] == "Private Other Person" and first["staffId"] is None
    assert [l["lineId"] for l in first["lines"]] == [l["id"] for l in po["lines"]]
    assert first["lines"][0]["productId"] == first["lines"][1]["productId"]
    assert get(api, headers, receiver="other")["filtered"] == 1
    second_draft = {**draft, "lines": [{**draft["lines"][0], "receivedQty": "5", "acceptedQty": "5"}]}
    second, _ = save(api, headers, second_draft)
    assert get(api, headers, "/sources/" + po["id"])["fulfillment"] == "Closed"
    corrected, _ = save(api, headers, {**draft, "otherName": "Corrected private person"}, first)
    assert corrected["lines"][0]["balanceAfterQty"] == "5"
    assert get(api, headers, "/" + second["id"])["lines"][0]["balanceAfterQty"] == "0"
    over = {**draft, "lines": [{**draft["lines"][0], "acceptedQty": "6"}]}
    assert api.post(BASE + f"/{first['id']}/preview", headers=headers, json=over).status_code == 422
    # Receiver transition cannot retain a hidden Other name.
    as_staff = {**draft, "receiverMode": "staff", "staffId": staff["id"], "otherName": None}
    changed, _ = save(api, headers, as_staff, corrected)
    assert changed["receiverMode"] == "staff" and changed["receivedBy"] == BODY["name"]
    # Persisted history and retry copies contain no authored name or batch.
    encrypted = [r.payload_ciphertext for r in db.scalars(select(ReceiptHistory)).all()]
    encrypted += [r.payload_ciphertext for r in db.scalars(select(ReceiptRetry)).all()]
    assert all("Private Other Person" not in value and "CORRECTED-PRIVATE" not in value for value in encrypted)
    # Reconciliation closes an absent request so a late original cannot commit.
    review = api.post(BASE + f"/{first['id']}/preview", headers=headers, json=as_staff).json()
    key = str(uuid.uuid4())
    assert get(api, headers, "/requests/" + key)["state"] == "not_committed"
    late = api.post(BASE + f"/{first['id']}/edit", headers=headers,
        json={**as_staff, "reviewToken": review["reviewToken"], "idempotencyKey": key, "expected_version": changed["version"]})
    assert late.status_code == 409, late.text
    deleted = api.post(BASE + f"/{second['id']}/delete", headers=headers,
                      json=dict(expected_version=second["version"], idempotencyKey=str(uuid.uuid4())))
    assert deleted.status_code == 200, deleted.text
    source = get(api, headers, "/sources/" + po["id"])
    assert Decimal(source["balances"][po["lines"][0]["id"]]) == 5
    assert source["fulfillment"] == "Partially Received"
