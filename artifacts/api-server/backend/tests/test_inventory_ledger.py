"""Focused synthetic ledger/adjustment checks. Never uses shared stock."""
import json
import os
import uuid
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import select, func, text
from sqlalchemy.exc import DBAPIError

from app.db.inventory_models import (
    InventoryAdjustment, InventoryAdjustmentRequest, InventoryLot, InventoryPosting, InventoryBalance,
)
from app.db.models import AuditEvent
from app.services import inventory, inventory_adjustments
from app.services.auth import identity_from_token
from app.services.purchase_received_crypto import PRError
from app.schemas.inventory_ledger import AdjustmentCreate
from app.schemas.inventory import MoveCreate
from test_products_crud import setup as product_setup, create as create_product, draft as assembly_draft, assemble
from test_sessions import client, create_user, login
from test_purchase_orders import fixture, save as save_po
from test_purchase_received_crud import save as save_pr
from test_inventory_crud import create_move, move_draft, destination
from test_opening_stock_operations import draft as opening_draft, save as save_opening
from test_opening_stock_concurrency import committed_openings, race

BASE = "/api/v1/admin/inventory"


def get(api, headers, path, **params):
    response = api.get(BASE + path, headers=headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def adjustment(pid, location, **extra):
    return dict(productId=pid, locationId=location, direction="add",
                quantity="1.125", reason="Synthetic counted discrepancy", **extra)


def reviewed(api, headers, body):
    response = api.post(BASE + "/adjustments/preview", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return dict(**body, reviewToken=response.json()["reviewToken"], idempotencyKey=str(uuid.uuid4()))


def save(api, headers, body):
    command = reviewed(api, headers, body)
    response = api.post(BASE + "/adjustments", headers=headers, json=command)
    assert response.status_code == 201, response.text
    return response.json(), command


def test_zero_stock_add_exact_reduce_compensation_encrypted_append_only_retry(client):
    api, db, _ = client
    headers, actor, fields, item = fixture(api, db)
    body = adjustment(item["id"], fields["locationId"])
    before = get(api, headers, f"/stock/{item['id']}/ledger")
    assert before["summary"]["current"] == "0.000"
    added, command = save(api, headers, body)
    assert added["before"] == "0.000" and added["after"] == "1.125"
    assert api.post(BASE + "/adjustments", headers=headers, json=command).json() == added
    assert get(api, headers, "/adjustment-requests/" + command["idempotencyKey"])["adjustment"] == added
    assert get(api, headers, "/adjustments/" + added["id"]) == added
    stock = get(api, headers, "/stock", product_ids=item["id"])["items"][0]
    lot = stock["lots"][0]
    assert lot["source"] == "adjustment" and lot["adjustmentId"] == added["id"]
    assert lot["receiptId"] is None and lot["openingId"] is None
    assert lot["batchNo"] is None and lot["expiryDate"] is None
    reduced, _ = save(api, headers, dict(productId=item["id"], locationId=fields["locationId"],
        lotId=lot["lotId"], direction="reduce", quantity="1.125", reason="Compensates synthetic count",
        correctionOf=added["id"]))
    assert reduced["after"] == "0.000" and reduced["delta"] == "-1.125"
    ledger = get(api, headers, f"/stock/{item['id']}/ledger")
    assert ledger["summary"]["closing"] == ledger["summary"]["current"] == "0.000"
    assert ledger["summary"]["additions"] == ledger["summary"]["reductions"] == "1.125"
    assert [r["balance"] for r in ledger["items"]] == ["1.125", "0.000"]
    assert "correction of" in ledger["items"][1]["reference"]
    assert db.scalar(select(func.count()).select_from(InventoryAdjustment)) == 2
    for row in db.scalars(select(InventoryAdjustment)):
        assert "Synthetic counted" not in row.payload_ciphertext
        assert row.payload_ciphertext.startswith("v1:")
    for row in db.scalars(select(InventoryAdjustmentRequest)):
        assert "Synthetic counted" not in row.payload_ciphertext
    for sql in ("DELETE FROM inventory_adjustments", "UPDATE inventory_adjustments SET quantity=9",
                "UPDATE inventory_adjustments SET payload_ciphertext='changed'",
                "DELETE FROM inventory_adjustment_requests", "UPDATE inventory_lots SET accepted=0",
                "TRUNCATE inventory_adjustments"):
        with pytest.raises(DBAPIError):
            with db.begin_nested():
                db.execute(text(sql))
    assert api.delete(BASE + "/adjustments/" + added["id"], headers=headers).status_code == 405


@pytest.mark.parametrize("change", [
    {"quantity": "0"}, {"quantity": "-1"}, {"quantity": "1.0001"}, {"quantity": "1000000.001"},
    {"quantity": "NaN"}, {"quantity": 1}, {"reason": " "}, {"reason": ""},
    {"locationId": None}, {"locationId": str(uuid.uuid4())}, {"productId": str(uuid.uuid4())},
    {"lotId": str(uuid.uuid4())}, {"correctionOf": str(uuid.uuid4())},
])
def test_adjustment_rejects_invalid_input_without_stock(client, change):
    api, db, _ = client
    headers, actor, fields, item = fixture(api, db)
    body = {**adjustment(item["id"], fields["locationId"]), **change}
    response = api.post(BASE + "/adjustments/preview", headers=headers, json=body)
    assert response.status_code in (404, 409, 422), response.text
    assert db.scalar(select(func.count()).select_from(InventoryAdjustment)) == 0
    assert db.scalar(select(func.count()).select_from(InventoryPosting)) == 0


def test_opening_allocation_transfer_net_zero_location_filters_and_carry_forward(client):
    api, db, _ = client
    headers, actor, fields, item = fixture(api, db)
    opened, _ = save_opening(api, headers, opening_draft(item, quantity="3.125"))
    opening = opened["records"][0]
    dst = destination(db, actor)
    move, _ = create_move(api, headers, dict(sourceId=None, destinationId=fields["locationId"],
        date="2026-10-19", deliveryMode="other", staffId=None, otherName="Synthetic allocation",
        lines=[dict(lotId=opening["lotId"], quantity="2.125")]))
    transfer, _ = create_move(api, headers, dict(sourceId=fields["locationId"], destinationId=str(dst.id),
        date="2026-10-19", deliveryMode="other", staffId=None, otherName="Synthetic transfer",
        lines=[dict(lotId=opening["lotId"], quantity="1.001")]))
    data = get(api, headers, f"/stock/{item['id']}/ledger")
    assert data["filtered"] == 3
    assert data["summary"]["current"] == data["summary"]["closing"] == "3.125"
    assert data["summary"]["additions"] == "3.125" and data["summary"]["reductions"] == "0.000"
    assert [r["balance"] for r in data["items"]] == ["3.125"] * 3
    assert len(data["items"][1]["legs"]) == 2
    scoped = get(api, headers, f"/stock/{item['id']}/ledger", location_id=fields["locationId"])
    assert scoped["summary"]["additions"] == "2.125" and scoped["summary"]["reductions"] == "1.001"
    assert scoped["summary"]["current"] == scoped["summary"]["closing"] == "1.124"
    filtered = get(api, headers, f"/stock/{item['id']}/ledger", transaction_type="transfer", limit=1)
    assert filtered["items"][0]["balance"] == "3.125" and filtered["summary"] == data["summary"]
    second = get(api, headers, f"/stock/{item['id']}/ledger", offset=1, limit=1)
    assert second["items"][0]["balance"] == "3.125" and second["filtered"] == 3
    empty = get(api, headers, f"/stock/{item['id']}/ledger", from_date="2100-01-01T00:00:00Z")
    assert empty["items"] == [] and empty["summary"]["opening"] == "3.125"
    assert empty["summary"]["closing"] == "3.125"
    # Existing real NULL-location openings can be reduced, never newly invented.
    result, _ = save(api, headers, dict(productId=item["id"], direction="reduce", lotId=opening["lotId"],
        locationId=None, quantity="1.000", reason="Synthetic unallocated reconciliation"))
    assert result["after"] == "0.000"
    assert get(api, headers, f"/stock/{item['id']}/ledger", location_id="unallocated")["summary"]["closing"] == "0.000"


def test_receipt_accepted_rejected_correction_deletion_and_procurement_context(client):
    api, db, _ = client
    headers, actor, fields, item = fixture(api, db)
    po, _, _ = save_po(api, headers, {**fields, "lines": [{**fields["lines"][0], "quantity": "10"}]})
    body = dict(poId=po["id"], receivedDate="2026-10-16", receiverMode="other", staffId=None,
        otherName="Synthetic receiver", lines=[dict(lineId=po["lines"][0]["id"],
            receivedQty="3.125", acceptedQty="2.125", batchNo="SYNTHETIC-BATCH", expiryDate="2027-10-16")])
    receipt, _ = save_pr(api, headers, body)
    pid = item["id"]
    initial = get(api, headers, f"/stock/{pid}/ledger")
    assert initial["summary"]["closing"] == "2.125"  # rejected 1.000 never credits stock
    assert len(initial["procurement"]["items"]) == 2
    assert initial["procurement"]["items"][0]["stockEffect"].startswith("None")
    assert initial["procurement"]["items"][1]["rejected"] == "1.000"
    corrected = {**body, "lines": [{**body["lines"][0], "acceptedQty": "1.125"}]}
    receipt, _ = save_pr(api, headers, corrected, receipt)
    data = get(api, headers, f"/stock/{pid}/ledger", transaction_type="receipt_correction")
    assert data["summary"]["closing"] == "1.125" and data["items"][0]["balance"] == "1.125"
    deleted = api.post("/api/v1/admin/purchase-received/" + receipt["id"] + "/delete", headers=headers,
        json=dict(expected_version=receipt["version"], idempotencyKey=str(uuid.uuid4())))
    assert deleted.status_code == 200, deleted.text
    final = get(api, headers, f"/stock/{pid}/ledger")
    assert final["summary"]["closing"] == final["summary"]["current"] == "0.000"
    assert final["items"][0]["sourceAvailable"] is False
    assert final["items"][-1]["quantityOut"] == "1.125"
    assert len(final["procurement"]["items"]) == 4


def test_review_stale_reconcile_cancellation_and_atomic_rollback(client, monkeypatch):
    api, db, settings = client
    headers, actor, fields, item = fixture(api, db)
    added, _ = save(api, headers, adjustment(item["id"], fields["locationId"]))
    lot = get(api, headers, f"/stock/{item['id']}/adjustment-choices")["lots"][0]
    body = dict(productId=item["id"], locationId=lot["locationId"], lotId=lot["lotId"],
                direction="reduce", quantity="1", reason="Synthetic reduction")
    stale = reviewed(api, headers, body)
    save(api, headers, {**body, "quantity": "0.125"})
    response = api.post(BASE + "/adjustments", headers=headers, json=stale)
    assert response.status_code == 409 and response.json()["error"]["code"] == "inventory_review_stale"
    command = reviewed(api, headers, {**body, "quantity": "0.125"})
    absent = get(api, headers, "/adjustment-requests/" + command["idempotencyKey"])
    assert absent == dict(state="not_committed", adjustment=None)
    assert api.post(BASE + "/adjustments", headers=headers, json=command).status_code == 409
    before = db.scalar(select(func.count()).select_from(InventoryPosting))
    identity = identity_from_token(db, headers["Authorization"][7:], settings)
    command = reviewed(api, headers, adjustment(item["id"], fields["locationId"]))
    real_post = inventory.post
    def fail_after_post(*args, **kwargs):
        real_post(*args, **kwargs)
        raise PRError("Synthetic rollback", 409, "synthetic")
    with monkeypatch.context() as patch:
        patch.setattr(inventory, "post", fail_after_post)
        with pytest.raises(PRError):
            inventory_adjustments.create(db, identity, AdjustmentCreate.model_validate(command))
    assert db.scalar(select(func.count()).select_from(InventoryPosting)) == before
    assert db.get(InventoryAdjustmentRequest, uuid.UUID(command["idempotencyKey"])) is None
    assert db.scalar(select(func.count()).select_from(InventoryAdjustment)) == 2


def test_read_adjustment_authorization_and_coverage_gap_fail_closed(client):
    api, db, _ = client
    headers, actor, fields, item = fixture(api, db)
    endpoint = f"/stock/{item['id']}/ledger"
    assert api.get(BASE + endpoint).status_code == 401
    nonadmin = create_user(db, "ledger-reader@example.com")
    response = login(api, nonadmin.email)
    denied = {"Authorization": "Bearer " + response.json()["access_token"]}
    assert api.get(BASE + endpoint, headers=denied).status_code == 403
    assert api.post(BASE + "/adjustments/preview", headers=denied,
        json=adjustment(item["id"], fields["locationId"])).status_code == 403
    added, _ = save(api, headers, adjustment(item["id"], fields["locationId"]))
    # Simulate missing history without disabling immutable posting guards: corrupt
    # only a synthetic balance through its ordinary SQL mutation surface.
    bal = db.scalar(select(InventoryBalance))
    bal.quantity = Decimal("0.125")
    db.commit()
    response = api.get(BASE + endpoint, headers=headers)
    assert response.status_code == 409 and response.json()["error"]["code"] == "inventory_history_gap"


def test_assembly_consumption_uses_retained_evidence_not_current_recipe(client):
    api, db, _ = client
    headers, actor, fields, lots, receipt, _ = product_setup(api, db)
    combo, _ = create_product(api, headers, fields)
    assembled, _ = assemble(api, headers, assembly_draft(combo, lots, receipt))
    pid = lots[0]["productId"]
    consumed = next(c["quantity"] for c in assembled["components"] if c["productId"] == pid)
    initial = get(api, headers, f"/stock/{pid}/ledger")
    assert initial["summary"]["closing"] == inventory.q(Decimal("10") - Decimal(consumed))
    assert initial["items"][-1]["type"] == "assembly_consumption"
    assert initial["items"][-1]["quantityOut"] == consumed
    assert initial["items"][-1]["sourceId"] == assembled["id"]
    # Retained assembly snapshots are independent from later catalogue versions.
    response = api.put("/api/v1/admin/products/" + combo["id"], headers=headers, json={
        **fields, "name": "Changed later recipe", "expected_version": combo["version"],
        "members": [{**m, "quantity": "0.500"} for m in fields["members"]],
        "idempotencyKey": str(uuid.uuid4())})
    assert response.status_code == 200, response.text
    later = get(api, headers, f"/stock/{pid}/ledger")
    assert later["items"] == initial["items"] and later["summary"] == initial["summary"]
    assert api.get(BASE + f"/stock/{combo['id']}/ledger", headers=headers).status_code == 404


def test_adjustment_lots_keep_provenance_through_transfer_and_scope_limits(client, monkeypatch):
    api, db, _ = client
    headers, actor, fields, item = fixture(api, db)
    result, _ = save(api, headers, adjustment(item["id"], fields["locationId"],
        batchNo="Explicit synthetic batch", expiryDate="2028-01-01"))
    choices = get(api, headers, f"/stock/{item['id']}/adjustment-choices")
    lot = choices["lots"][0]
    dst = destination(db, actor)
    create_move(api, headers, dict(sourceId=lot["locationId"], destinationId=str(dst.id),
        date="2026-10-19", deliveryMode="other", staffId=None, otherName="Synthetic transfer",
        lines=[dict(lotId=lot["lotId"], quantity="1.125")]))
    stock = get(api, headers, "/stock", product_ids=item["id"])["items"][0]
    assert stock["lots"][0]["source"] == "adjustment"
    assert stock["lots"][0]["adjustmentId"] == result["id"]
    assert stock["lots"][0]["receiptNumber"] is None
    with monkeypatch.context() as patch:
        patch.setattr(inventory, "LIMIT", 1)
        response = api.get(BASE + f"/stock/{item['id']}/ledger", headers=headers)
        assert response.status_code == 422
        assert "no partial" in response.json()["error"]["message"].lower()


def test_adjustment_concurrent_overdraw_uses_shared_inventory_lock(committed_openings, monkeypatch):
    api, db, engine, settings, headers, actor, fields, item = committed_openings
    save(api, headers, adjustment(item["id"], fields["locationId"]))
    lot = get(api, headers, f"/stock/{item['id']}/adjustment-choices")["lots"][0]
    body = dict(productId=item["id"], locationId=lot["locationId"], lotId=lot["lotId"],
        direction="reduce", quantity="1", reason="Synthetic competing count")
    a = AdjustmentCreate.model_validate(reviewed(api, headers, body))
    b = AdjustmentCreate.model_validate(reviewed(api, headers, body))
    results = race((api, db, engine, settings, headers, actor, fields, item), monkeypatch,
        lambda session, identity: inventory_adjustments.create(session, identity, a),
        lambda session, identity: inventory_adjustments.create(session, identity, b))
    assert sum(isinstance(r, dict) for r in results) == 1
    assert (409, "inventory_insufficient") in results or (409, "inventory_review_stale") in results
    db.expire_all()
    assert db.scalar(select(InventoryBalance.quantity)) == Decimal("0.125")


def test_duplicate_adjustment_and_delayed_request_cancellation_are_serialized(committed_openings, monkeypatch):
    env = committed_openings
    api, db, engine, settings, headers, actor, fields, item = env
    command = AdjustmentCreate.model_validate(reviewed(api, headers, adjustment(item["id"], fields["locationId"])))
    a, b = race(env, monkeypatch,
        lambda session, identity: inventory_adjustments.create(session, identity, command),
        lambda session, identity: inventory_adjustments.create(session, identity, command))
    assert a == b
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(InventoryAdjustment)) == 1
    assert db.scalar(select(func.count()).select_from(InventoryPosting)) == 1
    another = AdjustmentCreate.model_validate(reviewed(api, headers, adjustment(item["id"], fields["locationId"])))
    a, b = race(env, monkeypatch,
        lambda session, identity: inventory_adjustments.reconcile(session, identity, another.idempotencyKey),
        lambda session, identity: inventory_adjustments.create(session, identity, another))
    assert a["state"] == "not_committed" and b == (409, "inventory_retry")


def test_transfer_and_adjustment_compete_without_negative_stock(committed_openings, monkeypatch):
    env = committed_openings
    api, db, engine, settings, headers, actor, fields, item = env
    save(api, headers, adjustment(item["id"], fields["locationId"]))
    lot = get(api, headers, f"/stock/{item['id']}/adjustment-choices")["lots"][0]
    dst = destination(db, actor)
    movement = dict(sourceId=lot["locationId"], destinationId=str(dst.id), date="2026-10-19",
        deliveryMode="other", staffId=None, otherName="Competing transfer",
        lines=[dict(lotId=lot["lotId"], quantity="1")])
    preview = api.post(BASE + "/movements/preview", headers=headers, json=movement)
    assert preview.status_code == 200, preview.text
    move = MoveCreate(**movement, reviewToken=preview.json()["reviewToken"], idempotencyKey=uuid.uuid4())
    reduce = AdjustmentCreate.model_validate(reviewed(api, headers, dict(productId=item["id"],
        lotId=lot["lotId"], locationId=lot["locationId"], direction="reduce", quantity="1", reason="Competing reduction")))
    a, b = race(env, monkeypatch,
        lambda session, identity: inventory.create(session, identity, move),
        lambda session, identity: inventory_adjustments.create(session, identity, reduce))
    assert isinstance(a, dict) and b == (409, "inventory_insufficient")
    result = get(api, headers, f"/stock/{item['id']}/ledger")
    assert result["summary"]["closing"] == result["summary"]["current"] == "1.125"


def test_fresh_catalog_observation(client):
    """Actual isolated catalog evidence; no configured/shared DB access."""
    api, db, _ = client
    directory = os.environ.get("EVEXIA_LEDGER_CATALOG_DIR")
    if not directory:
        return
    from app.services.fresh_catalog import digest, projection
    target = Path(directory)
    target.mkdir(parents=True, exist_ok=True)
    connection = db.connection()
    evidence = dict(revision=db.scalar(text("SELECT version_num FROM alembic_version")),
        postgresql=db.scalar(text("SHOW server_version")), catalog_sha256=digest(connection))
    (target / "catalog-observation.json").write_text(json.dumps(evidence, indent=2) + "\n")
    (target / "catalog-projection.json").write_text(json.dumps(projection(connection), default=str, indent=2) + "\n")
