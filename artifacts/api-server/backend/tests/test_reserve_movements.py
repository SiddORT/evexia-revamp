"""Only the new reviewed reserve movement/conversion contract, disposable data."""
import uuid
import json
import os
from pathlib import Path
from datetime import date
from decimal import Decimal
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import pytest
from sqlalchemy import select, func, event
from sqlalchemy.orm import Session
from app.db.inventory_models import InventoryLot, InventoryMovement, InventoryBalance, InventoryPosting, InventoryRequest
from app.db.in_house_stock_models import InHouseStock, InHousePosting
from app.schemas.inventory import MoveCreate
from app.services import inventory
from app.services.auth import identity_from_token
from app.services.reserve_movements import calculate
from app.services.purchase_received_crypto import PRError
from test_sessions import client, create_user, login
from test_purchase_orders import fixture
from test_in_house_stock import command as reserve_command
from test_opening_stock_concurrency import committed_openings

BASE = "/api/v1/admin/inventory"
RESERVES = "/api/v1/admin/in-house-stock"


def setup(api, db, **changes):
    headers, actor, fields, item = fixture(api, db)
    return seed(api, db, headers, actor, fields, item, **changes)


def seed(api, db, headers, actor, fields, item, **changes):
    body = dict(allergenId=item["id"], concentration="10%", quantity="25", unit="ml",
        expiryDate="2027-01-01", locationId=fields["locationId"], batch="Synthetic reserve", notes="")
    body.update(changes)
    saved = api.post(RESERVES, headers=headers, json=reserve_command(api, headers, body))
    assert saved.status_code == 201, saved.text
    destination = api.post("/api/v1/admin/storage-locations", headers=headers,
        json=dict(name="Synthetic destination " + str(uuid.uuid4()), address="Synthetic", status="active"))
    assert destination.status_code == 201, destination.text
    move = dict(sourceId=fields["locationId"], destinationId=destination.json()["id"],
        date="2026-10-30", deliveryMode="other", otherName="Synthetic carrier", staffId=None,
        lines=[dict(lotId=saved.json()["id"], quantity="10", sourceKind="reserve", dilute=True, dilutionFactor=10)])
    return headers, actor, saved.json(), move


def reviewed(api, headers, body):
    r = api.post(BASE + "/movements/preview", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return {**body, "reviewToken": r.json()["reviewToken"], "idempotencyKey": str(uuid.uuid4())}, r.json()["movement"]


def count(db, model):
    return db.scalar(select(func.count()).select_from(model))


@pytest.mark.parametrize("factor,concentration,expected", [
    (2, "5", "2.5"), (5, "5", "1"), (10, "5", "0.5"),
    (2, "5%", "2.5%"), (5, "5%", "1%"), (10, "5%", "0.5%"),
])
def test_plain_and_percent_preview_create_read(client, factor, concentration, expected):
    api, db, _ = client
    headers, _, reserve, move = setup(api, db, concentration=concentration, quantity="100")
    move["lines"][0].update(quantity="100", dilutionFactor=factor)
    request, preview = reviewed(api, headers, move)
    assert count(db, InventoryLot) == count(db, InHousePosting) == 0
    line = preview["lines"][0]
    assert line["resultingQuantity"] == f"{100 * factor}.000"
    assert line["resultingConcentration"] == expected
    assert line["sourceAfter"] == "0.000"
    created = api.post(BASE + "/movements", headers=headers, json=request)
    assert created.status_code == 201, created.text
    saved = created.json()
    assert api.get(BASE + "/movements/" + saved["id"], headers=headers).json() == saved
    assert saved["lines"][0]["resultingConcentration"] == expected
    assert api.post(BASE + "/movements", headers=headers, json=request).json() == saved
    assert count(db, InHousePosting) == count(db, InventoryLot) == 1
    detail = api.get(RESERVES + "/" + reserve["id"], headers=headers).json()
    assert detail["availableQuantity"] == "0.000"
    assert detail["concentration"] == concentration  # Original is never rewritten.
    stocks = api.get(BASE + "/stock", headers=headers).json()["items"]
    lot = next(l for s in stocks for l in s["lots"] if l.get("reserveId") == reserve["id"])
    assert lot["concentration"] == expected
    assert lot["quantity"] == f"{100 * factor}.000"


@pytest.mark.parametrize("factor", [2, 5, 10])
def test_review_commit_and_saved_batch_metadata(client, factor):
    api, db, _ = client
    headers, actor, reserve, move = setup(api, db)
    move["lines"][0]["dilutionFactor"] = factor
    request, preview = reviewed(api, headers, move)
    assert count(db, InventoryLot) == count(db, InHousePosting) == 0
    line = preview["lines"][0]
    assert line["sourceBefore"] == "25.000" and line["sourceAfter"] == "15.000"
    assert line["resultingQuantity"] == f"{10 * factor}.000"
    assert line["resultingConcentration"] == {2: "5%", 5: "2%", 10: "1%"}[factor]
    assert line["resultingExpiryDate"] == "2028-10-30"  # Not original expiry + 2.
    result = api.post(BASE + "/movements", headers=headers, json=request)
    assert result.status_code == 201, result.text
    saved = result.json()
    assert api.post(BASE + "/movements", headers=headers, json=request).json() == saved
    assert api.get(BASE + "/requests/" + request["idempotencyKey"], headers=headers).json()["movement"] == saved
    assert api.get(BASE + "/movements/" + saved["id"], headers=headers).json() == saved
    assert count(db, InventoryLot) == count(db, InventoryMovement) == count(db, InHousePosting) == 1
    detail = api.get(RESERVES + "/" + reserve["id"], headers=headers).json()
    assert detail["quantity"] == "25.000" and detail["availableQuantity"] == "15.000"
    assert db.get(InHouseStock, uuid.UUID(reserve["id"])).payload_ciphertext
    stocks = api.get(BASE + "/stock", headers=headers).json()["items"]
    lot = next(l for s in stocks for l in s["lots"] if l["reserveId"] == reserve["id"])
    assert lot["concentration"] == line["resultingConcentration"]
    assert lot["quantity"] == line["resultingQuantity"] and lot["expiryDate"] == "2028-10-30"
    assert lot["sourceMovementId"] == saved["id"] and lot["source"] == "in_house_dilution"
    ledger = api.get(BASE + "/stock/" + line["productId"] + "/ledger", headers=headers)
    assert ledger.status_code == 200, ledger.text
    assert ledger.json()["items"][0]["type"] == "dilution"
    # Transfer the new lot unchanged, never repeating conversion or using today's catalogue.
    onward = {**move, "sourceId": move["destinationId"], "destinationId": move["sourceId"],
        "lines": [dict(lotId=lot["lotId"], quantity="1")]}
    next_request, next_preview = reviewed(api, headers, onward)
    assert next_preview["lines"][0]["dilutionFactor"] is None
    assert next_preview["lines"][0]["concentration"] == line["resultingConcentration"]
    assert api.post(BASE + "/movements", headers=headers, json=next_request).status_code == 201
    assert count(db, InventoryLot) == 1
    output = os.environ.get("EVEXIA_RESERVE_CATALOG")
    if output:
        from app.services.fresh_catalog import projection, digest
        observed = projection(db.connection())
        target = Path(output)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(dict(revision="0078_reserve_movements", sha256=digest(db.connection()),
            tables=sorted(row[0] for row in observed["relations"] if row[1] == "r")), indent=2) + "\n")


def test_undiluted_location_transfer_stays_reserve_and_can_then_dilute(client):
    api, db, _ = client
    headers, _, reserve, move = setup(api, db, concentration="Legacy concentrate", unit="legacy units")
    move["lines"][0].update(dilute=False, dilutionFactor=None)
    request, preview = reviewed(api, headers, move)
    line = preview["lines"][0]
    assert line["resultingQuantity"] == "10.000" and line["resultingConcentration"] == "Legacy concentrate"
    assert line["resultingExpiryDate"] == reserve["expiryDate"] and line["reserveOnly"]
    assert api.post(BASE + "/movements", headers=headers, json=request).status_code == 201
    assert count(db, InventoryLot) == count(db, InventoryBalance) == count(db, InventoryPosting) == 0
    detail = api.get(RESERVES + "/" + reserve["id"], headers=headers).json()
    assert detail["availableQuantity"] == "25.000"
    assert sorted(x["quantity"] for x in detail["locationBalances"]) == ["10.000", "15.000"]
    for location in (move["sourceId"], move["destinationId"]):
        refs = api.get(BASE + "/references/lots", headers=headers, params={"source_id": location}).json()["items"]
        assert refs[0]["sourceKind"] == "reserve" and refs[0]["reserveOnly"]


def test_stale_review_cancelled_identity_draft_changes_and_authorization(client):
    api, db, _ = client
    headers, _, reserve, move = setup(api, db)
    request, _ = reviewed(api, headers, move)
    other, _ = reviewed(api, headers, move)
    assert api.post(BASE + "/movements", headers=headers, json=other).status_code == 201
    assert api.post(BASE + "/movements", headers=headers, json=request).status_code == 409
    request, _ = reviewed(api, headers, move)
    assert api.get(BASE + "/requests/" + request["idempotencyKey"], headers=headers).json()["state"] == "not_committed"
    assert api.post(BASE + "/movements", headers=headers, json=request).status_code == 409
    request, _ = reviewed(api, headers, move)
    request["date"] = "2026-11-01"
    assert api.post(BASE + "/movements", headers=headers, json=request).status_code == 409
    ordinary = {**move, "lines": [dict(lotId=reserve["id"], quantity="1", dilute=True, dilutionFactor=2)]}
    assert api.post(BASE + "/movements/preview", headers=headers, json=ordinary).status_code == 422
    missing_choice = {**move, "lines": [dict(lotId=reserve["id"], quantity="1", sourceKind="reserve")]}
    assert api.post(BASE + "/movements/preview", headers=headers, json=missing_choice).status_code == 422


def test_staff_movement_grants_do_not_expose_or_consume_protected_reserves(client):
    from app.db.role_models import CustomRole
    from test_staff import seed_designation
    from staff_number_fixture import seed_staff, PASSWORD
    api, db, _ = client
    headers, actor, reserve, move = setup(api, db)
    designation = seed_designation(db, actor.id)
    role = CustomRole(id=uuid.uuid4(), name="Synthetic movement grants", permissions=[
        "stock_movement.view", "stock_movement.create", "stock_movement.activity", "stock_movement.analytics"],
        created_by=actor.id, updated_by=actor.id)
    db.add(role)
    db.commit()
    seed_staff(db, actor.id, designation, role.id, "dilution", label="EVX-9900", code="SYNTHETIC-DILUTION")
    response = api.post("/api/v1/auth/login", headers={"Origin": "http://testserver"},
        json=dict(identifier="staff-dilution@example.com", password=PASSWORD))
    assert response.status_code == 200, response.text
    denied = {"Authorization": "Bearer " + response.json()["access_token"]}
    assert api.get(BASE + "/references/lots", headers=denied, params={"source_id": move["sourceId"]}).json()["items"] == []
    assert api.post(BASE + "/movements/preview", headers=denied, json=move).status_code == 403
    request, _ = reviewed(api, headers, move)
    assert api.post(BASE + "/movements", headers=denied, json=request).status_code == 403
    saved = api.post(BASE + "/movements", headers=headers, json=request).json()
    assert api.get(BASE + "/movements", headers=denied).json()["items"] == []
    assert api.get(BASE + "/movements/" + saved["id"], headers=denied).status_code == 404
    assert api.get(BASE + "/references/movement-allergens", headers=denied).json()["items"] == []


@pytest.mark.parametrize("unit,concentration,amount,factor,day,expected", [
    ("ml", "10%", "10", 10, "2024-02-29", ("100.000", "1%", "2026-02-28")),
    ("", "10%", ".001", 2, "2026-10-30", ("0.002", "5%", "2028-10-30")),
])
def test_exact_arithmetic_and_calendar(unit, concentration, amount, factor, day, expected):
    r = calculate(Decimal(amount), concentration, unit, factor, date.fromisoformat(day))
    assert (r["resultingQuantity"], r["resultingConcentration"], r["resultingExpiryDate"]) == expected


@pytest.mark.parametrize("unit,concentration,amount,factor", [
    ("vials", "10%", "10", 10), ("ML", "10%", "10", 10),
    ("ml", "1:10", "10", 10), ("ml", "0%", "10", 10), ("ml", "101%", "10", 10),
    ("ml", "0.000001%", "10", 10), ("ml", "10%", "100001", 10), ("ml", "10%", "10", 3),
    ("ml", "0", "10", 5), ("ml", "0.000001", "10", 2),
    ("ml", "1000", "10", 5), ("ml", "5.0000001", "10", 5),
])
def test_unsupported_and_unrepresentable_outputs(unit, concentration, amount, factor):
    with pytest.raises(PRError):
        calculate(Decimal(amount), concentration, unit, factor, date(2026, 10, 30))


def test_atomic_failure_has_no_reserve_or_inventory_effects(client):
    api, db, _ = client
    headers, _, _, move = setup(api, db)
    request, _ = reviewed(api, headers, move)
    def fail(mapper, connection, target):
        raise RuntimeError("synthetic final retry failure")
    event.listen(InventoryRequest, "before_insert", fail)
    try:
        assert api.post(BASE + "/movements", headers=headers, json=request).status_code == 500
    finally:
        event.remove(InventoryRequest, "before_insert", fail)
    assert all(count(db, m) == 0 for m in (InventoryLot, InventoryMovement, InHousePosting, InventoryBalance, InventoryPosting))
    assert api.post(BASE + "/movements", headers=headers, json=request).status_code == 201


def test_concurrent_reviews_cannot_overconsume(committed_openings):
    api, db, engine, settings, headers, actor, fields, item = committed_openings
    headers, _, _, move = seed(api, db, headers, actor, fields, item, quantity="10")
    requests = [reviewed(api, headers, move)[0] for _ in range(2)]
    barrier = Barrier(2)
    def save(request):
        with Session(engine, expire_on_commit=False) as session:
            identity = identity_from_token(session, headers["Authorization"].split()[1], settings)
            session.commit()
            barrier.wait(timeout=20)
            try:
                inventory.create(session, identity, MoveCreate(**request))
                return "saved"
            except PRError as e:
                return e.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, requests))
    assert results.count("saved") == 1
    assert count(db, InHousePosting) == count(db, InventoryLot) == 1
