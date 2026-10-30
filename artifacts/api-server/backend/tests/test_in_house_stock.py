"""Synthetic disposable-only checks for reserve isolation and durable outcomes."""
import json
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
import pytest
from sqlalchemy import select, func, text, event
from sqlalchemy.exc import DBAPIError
from app.db.in_house_stock_models import InHouseStock, InHouseStockRequest
from app.db.inventory_models import InventoryLot, InventoryBalance, InventoryPosting
from app.db.allergen_models import AllergenProduct
from app.db.product_category_models import ProductCategory
from app.db.location_models import StorageLocation
from app.db.models import AuditEvent
from app.db.session import session_factory
from app.services import in_house_stock as service
from app.services.auth import identity_from_token
from app.schemas.in_house_stock import ReserveCreate
from test_sessions import client, create_user, login
from test_purchase_orders import fixture
from test_opening_stock_concurrency import committed_openings
from sqlalchemy.orm import Session

BASE = "/api/v1/admin/in-house-stock"


def draft(item, location):
    return dict(allergenId=item["id"], concentration="Manufactured 1:7 concentrate",
        quantity="2.125", unit="ml", expiryDate="2020-01-01", locationId=location,
        batch="Synthetic batch", notes="Reserve only, no dilution")


def command(api, headers, body):
    response = api.post(BASE + "/preview", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return {**body, "reviewToken": response.json()["reviewToken"], "idempotencyKey": str(uuid.uuid4())}


def count(db, model):
    return db.scalar(select(func.count()).select_from(model))


def test_create_history_isolation_dedup_search_and_reconcile(client):
    api, db, _ = client
    headers, actor, fields, item = fixture(api, db)
    before = api.get("/api/v1/admin/inventory/stock", headers=headers, params={"snapshot": True}).json()
    counts = [count(db, m) for m in (InventoryLot, InventoryBalance, InventoryPosting)]
    body = draft(item, fields["locationId"])
    request = command(api, headers, body)
    result = api.post(BASE, headers=headers, json=request)
    assert result.status_code == 201, result.text
    saved = result.json()
    assert saved["concentration"] == body["concentration"] != item["concentration"]
    assert saved["quantity"] == "2.125" and saved["unit"] == "ml"
    assert saved["expired"] and saved["reserveOnly"] and saved["actorId"] == str(actor.id)
    assert api.post(BASE, headers=headers, json=request).json() == saved
    assert api.get(BASE + "/requests/" + request["idempotencyKey"], headers=headers).json() == dict(state="committed", result=saved)
    assert count(db, InHouseStock) == 1
    assert count(db, AuditEvent) > 0
    assert [count(db, m) for m in (InventoryLot, InventoryBalance, InventoryPosting)] == counts
    after = api.get("/api/v1/admin/inventory/stock", headers=headers, params={"snapshot": True}).json()
    before.pop("asOf", None)
    after.pop("asOf", None)
    assert after == before
    choices = api.get("/api/v1/admin/inventory/references/lots", headers=headers,
        params={"source_id": fields["locationId"]}).json()["items"]
    assert len(choices) == 1 and choices[0]["sourceKind"] == "reserve"
    assert choices[0]["reserveOnly"] and choices[0]["id"] == saved["id"]
    row = db.get(AllergenProduct, uuid.UUID(item["id"]))
    row.name = "Changed catalogue name"
    row.concentration = "Purchased new concentration"
    row.version += 1
    db.get(ProductCategory, row.category_id).name = "Changed category"
    db.get(StorageLocation, uuid.UUID(fields["locationId"])).name = "Changed location"
    db.commit()
    detail = api.get(BASE + "/" + saved["id"], headers=headers).json()
    assert {k: v for k, v in detail.items() if k not in {"availableQuantity", "locationBalances"}} == {
        k: v for k, v in saved.items() if k not in {"availableQuantity", "locationBalances"}}
    assert detail["availableQuantity"] == saved["quantity"]
    assert api.get(BASE, headers=headers, params={"query": saved["allergenName"], "limit": 1}).json()["items"] == [detail]
    assert api.get(BASE, headers=headers, params={"query": "not-found"}).json()["filtered"] == 0
    assert api.get(BASE, headers=headers, params={"offset": 1}).json()["items"] == []
    encrypted = db.get(InHouseStock, uuid.UUID(saved["id"])).payload_ciphertext
    assert saved["concentration"] not in encrypted and body["notes"] not in encrypted
    for method in (api.put, api.delete):
        assert method(BASE + "/" + saved["id"], headers=headers).status_code == 405
    for table in ("in_house_stock", "in_house_stock_requests"):
        with pytest.raises(DBAPIError):
            with db.begin_nested():
                db.execute(text(f"DELETE FROM {table}"))


@pytest.mark.parametrize("field,value", [
    ("quantity", "0"), ("quantity", "-1"), ("quantity", "1.0001"), ("quantity", "1e2"),
    ("quantity", "1000000.001"), ("quantity", 2), ("quantity", "NaN"),
    ("concentration", "  "), ("unit", ""), ("expiryDate", "2026-02-30"),
    ("locationId", None), ("allergenId", None), ("batch", "x" * 101),
])
def test_invalid_fields_rejected_before_persistence(client, field, value):
    api, db, _ = client
    headers, _, fields, item = fixture(api, db)
    body = {**draft(item, fields["locationId"]), field: value}
    assert api.post(BASE + "/preview", headers=headers, json=body).status_code == 422
    assert count(db, InHouseStock) == count(db, InHouseStockRequest) == 0


def test_cancelled_request_stale_review_active_references_authorization(client):
    api, db, _ = client
    headers, _, fields, item = fixture(api, db)
    body = draft(item, fields["locationId"])
    request = command(api, headers, body)
    assert api.get(BASE + "/requests/" + request["idempotencyKey"], headers=headers).json() == dict(state="not_committed", result=None)
    assert api.post(BASE, headers=headers, json=request).status_code == 409
    request = command(api, headers, body)
    row = db.get(AllergenProduct, uuid.UUID(item["id"]))
    row.version += 1
    db.commit()
    assert api.post(BASE, headers=headers, json=request).status_code == 409
    row.status = "inactive"
    db.commit()
    assert api.post(BASE + "/preview", headers=headers, json=body).status_code == 409
    assert api.get(BASE + "/references/allergens", headers=headers).json()["items"] == []
    assert api.get(BASE + "/references/locations", headers=headers).json()["items"][0]["id"] == fields["locationId"]
    stranger = create_user(db, "reserve-denied@example.com")
    denied = {"Authorization": "Bearer " + login(api, stranger.email).json()["access_token"]}
    for path in ("", "/references/allergens", "/references/locations", "/requests/" + request["idempotencyKey"]):
        assert api.get(BASE + path, headers=denied).status_code == 403
        assert api.get(BASE + path).status_code == 401
    assert api.post(BASE + "/preview", headers=denied, json=body).status_code == 403
    assert count(db, InHouseStock) == 0


def test_atomic_rollback_including_audit_and_request(client, monkeypatch):
    api, db, _ = client
    headers, _, fields, item = fixture(api, db)
    request = command(api, headers, draft(item, fields["locationId"]))
    original = db.flush
    def fail(*args, **kwargs):
        if any(isinstance(row, InHouseStockRequest) for row in db.new):
            raise RuntimeError("Synthetic rollback")
        return original(*args, **kwargs)
    monkeypatch.setattr(db, "flush", fail)
    assert api.post(BASE, headers=headers, json=request).status_code == 500
    monkeypatch.setattr(db, "flush", original)
    assert count(db, InHouseStock) == count(db, InHouseStockRequest) == 0
    assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.resource_type == "in_house_stock")) == 0


def test_concurrent_same_request_and_cancellation(committed_openings):
    """Independent real transactions, never one shared SQLAlchemy session."""
    api, db, engine, settings, headers, actor, fields, item = committed_openings
    request = command(api, headers, draft(item, fields["locationId"]))
    token = headers["Authorization"].removeprefix("Bearer ")
    barrier = Barrier(2)
    def save():
        with Session(engine) as session:
            identity = identity_from_token(session, token, settings)
            barrier.wait(timeout=20)
            return service.create(session, identity, ReserveCreate(**request))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: save(), range(2)))
    assert results[0] == results[1]
    with Session(engine) as session:
        assert count(session, InHouseStock) == 1
        assert count(session, InventoryPosting) == 0


def test_observe_actual_disposable_catalog(client):
    """Opt-in observation used to regenerate the source catalog, no managed DB."""
    out = os.environ.get("EVEXIA_IN_HOUSE_CATALOG")
    if not out:
        pytest.skip("No disposable catalog observation requested")
    from app.services.fresh_catalog import projection, digest
    _, db, _ = client
    path = Path(out)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = db.connection()
    result = {"revision": db.scalar(text("SELECT version_num FROM alembic_version")),
        "postgresql": db.scalar(text("SHOW server_version")), "sha256": digest(conn),
        "tables": sorted(row[0] for row in projection(conn)["relations"] if row[1] in ("r", "p"))}
    path.write_text(json.dumps(result, indent=2) + "\n")
