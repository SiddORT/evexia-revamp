"""Feature-only, disposable in-memory shipment contract and transition checks."""
import uuid
from contextlib import contextmanager
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.schemas.shipments import ShipmentDispatch, ShipmentCommand, ShipmentDelivery
from app.services import kits, immunotherapy, lupin, spt, shipments
from app.services.immunotherapy import ImmError

KEYS = SimpleNamespace(keys={"test": b"x" * 32}, active="test")
SOURCES = {"Kit": kits, "IT": immunotherapy, "Lupin": lupin, "SPT": spt}


@pytest.fixture
def store(monkeypatch):
    @contextmanager
    def keys(_db):
        yield KEYS
    monkeypatch.setattr(shipments, "crypto_scope", keys)
    monkeypatch.setattr(shipments, "lock_policy", lambda db: None)
    monkeypatch.setattr(shipments, "revalidate_identity", lambda db, actor, lock: actor)
    monkeypatch.setattr(shipments, "is_super_admin", lambda actor: actor.allowed)
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        for service in SOURCES.values():
            table = service.Order.__tablename__
            conn.execute(text(f"""CREATE TABLE {table} (
                id TEXT PRIMARY KEY, source_id TEXT, number TEXT, date DATE NOT NULL,
                doctor_id TEXT, mr_id TEXT, patient_id TEXT, order_for TEXT,
                status TEXT, payment_status TEXT, version INTEGER,
                snapshot_ciphertext TEXT, created_by TEXT, updated_by TEXT,
                created_at DATETIME, updated_at DATETIME)"""))
            conn.execute(text(f"""CREATE TABLE {service.Retry.__tablename__} (
                key TEXT PRIMARY KEY, actor_id TEXT, response_ciphertext TEXT)"""))
        conn.execute(text("""CREATE TABLE courier_partners (
            id TEXT PRIMARY KEY, name TEXT, status TEXT, version INTEGER,
            created_by TEXT, updated_by TEXT, deleted_at DATETIME, deleted_by TEXT,
            created_at DATETIME, updated_at DATETIME)"""))

    class TestSession(Session):
        def execute(self, statement, *args, **kwargs):
            if isinstance(statement, type(text(""))) and "pg_advisory_xact_lock" in str(statement):
                return None
            return super().execute(statement, *args, **kwargs)

        def add(self, instance, **kwargs):
            if instance.__class__.__name__ == "AuditEvent":
                return
            return super().add(instance, **kwargs)

    with TestSession(engine) as db:
        actor = SimpleNamespace(allowed=True, user=SimpleNamespace(id=uuid.uuid4()), session_id="test",
                                permissions=["admin.access"], role="super_admin")
        courier_id = uuid.uuid4()
        db.execute(text("INSERT INTO courier_partners (id,name,status,version,created_by,updated_by) "
                        "VALUES (:id,'Saved Courier','active',1,:actor,:actor)"),
                   {"id": courier_id.hex, "actor": actor.user.id.hex})
        records = {}
        for kind, service in SOURCES.items():
            identity = uuid.uuid4()
            record = {
                "status": "Approved" if kind == "IT" else "In process",
                "doctor": {"name": f"{kind} historical doctor"},
                "mr": {"name": f"{kind} historical MR"},
                "recipient": {"name": "Saved destination", "address": {"line1": "=Saved address", "city": "Pune"}},
                "total": "123456789012345.67", "totalMinor": 123456789, "pricing": {"total": "987654321.23"},
            }
            db.execute(text(f"""INSERT INTO {service.Order.__tablename__}
                (id,number,date,status,version,snapshot_ciphertext,created_by,updated_by)
                VALUES (:id,:number,:date,:status,1,:snapshot,:actor,:actor)"""),
                {"id": identity.hex, "number": f"{kind}-01", "date": "2026-10-01",
                 "status": record["status"], "snapshot": service.seal(KEYS, "orders", identity, record),
                 "actor": actor.user.id.hex})
            records[kind] = identity
        db.commit()
        yield db, actor, courier_id, records


def dispatch(version, courier_id, **kwargs):
    return ShipmentDispatch(idempotency_key=kwargs.get("key", uuid.uuid4()), expected_version=version,
        courier_id=courier_id, tracking_id="=TRK-1", expected_delivery_date=date.today() + timedelta(days=7))


def test_projection_filters_pages_search_and_exact_values(store):
    db, actor, courier, records = store
    page = shipments.listing(db, actor, limit=2)
    assert page["total"] == 4 and len(page["items"]) == 2
    assert page["items"] + shipments.listing(db, actor, offset=2, limit=2)["items"] == \
        shipments.listing(db, actor, complete=True)["items"]
    assert shipments.listing(db, actor, search="historical doctor", type="Kit")["total"] == 1
    assert shipments.listing(db, actor, status="Returned")["total"] == 0
    assert shipments.listing(db, actor, type="Kit")["items"][0]["value"] == "987654321.23"
    assert shipments.listing(db, actor, type="SPT")["items"][0]["value"] == "123456789012345.67"
    assert shipments.listing(db, actor, type="IT")["items"][0]["status"] == "In process"
    assert shipments.listing(db, actor, type="IT")["items"][0]["address"] == "=Saved address, Pune"
    with pytest.raises(ImmError):
        shipments.listing(db, SimpleNamespace(allowed=False), limit=2)
    with pytest.raises(ImmError):
        shipments.listing(db, actor, from_date=date(2026, 10, 2), to_date=date(2026, 10, 1))


@pytest.mark.parametrize("kind", SOURCES)
def test_ship_delivery_return_retry_and_saved_courier_label(store, kind):
    db, actor, courier_id, records = store
    identity = records[kind]
    body = dispatch(1, courier_id)
    shipped = shipments.mutate(db, actor, kind, identity, body, "ship")
    assert shipped["status"] == "Shipped" and shipped["version"] == 2
    assert shipped["courier"] == "Saved Courier" and shipped["trackingId"] == "=TRK-1"
    assert shipments.mutate(db, actor, kind, identity, body, "ship") == shipped
    db.execute(text("UPDATE courier_partners SET name='Renamed Courier', status='inactive' WHERE id=:id"),
               {"id": courier_id.hex})
    db.commit()
    assert shipments.listing(db, actor, status="Shipped", type=kind)["items"][0]["courier"] == "Saved Courier"
    with pytest.raises(ImmError):
        shipments.mutate(db, actor, kind, identity, dispatch(2, courier_id), "ship")
    with pytest.raises(ImmError):
        shipments.mutate(db, actor, kind, identity, dispatch(2, courier_id, key=body.idempotency_key), "ship")
    with pytest.raises(ImmError):
        shipments.mutate(db, actor, kind, identity,
            ShipmentDelivery(idempotency_key=uuid.uuid4(), expected_version=2,
                             actual_delivery_date=date.today() + timedelta(days=1)), "delivery")
    delivered = shipments.mutate(db, actor, kind, identity,
        ShipmentDelivery(idempotency_key=uuid.uuid4(), expected_version=2,
                         actual_delivery_date=date.today()), "delivery")
    assert delivered["status"] == "Shipped" and delivered["actualDeliveryDate"]
    returned = shipments.mutate(db, actor, kind, identity,
        ShipmentCommand(idempotency_key=uuid.uuid4(), expected_version=3), "return")
    assert returned["status"] == "Returned" and returned["courier"] == "Saved Courier"
    assert returned["actualDeliveryDate"] == delivered["actualDeliveryDate"]
    assert shipments.listing(db, actor, status="Returned", type=kind)["total"] == 1


def test_active_courier_lookup_and_export_bound(store, monkeypatch):
    db, actor, courier_id, records = store
    denied = SimpleNamespace(allowed=False)
    with pytest.raises(ImmError):
        shipments.couriers(db, denied)
    with pytest.raises(ImmError):
        shipments.mutate(db, denied, "Kit", records["Kit"], dispatch(1, courier_id), "ship")
    with pytest.raises(ImmError, match="Only Shipped"):
        shipments.mutate(db, actor, "Kit", records["Kit"],
            ShipmentCommand(idempotency_key=uuid.uuid4(), expected_version=1), "return")
    with pytest.raises(ImmError, match="Only Shipped"):
        shipments.mutate(db, actor, "Kit", records["Kit"],
            ShipmentDelivery(idempotency_key=uuid.uuid4(), expected_version=1,
                             actual_delivery_date=date.today()), "delivery")
    assert shipments.couriers(db, actor, search="Saved")["total"] == 1
    db.execute(text("UPDATE courier_partners SET status='inactive'"))
    db.commit()
    assert shipments.couriers(db, actor)["total"] == 0
    with pytest.raises(ImmError):
        shipments.mutate(db, actor, "Kit", records["Kit"], dispatch(1, courier_id), "ship")
    monkeypatch.setattr(shipments, "EXPORT_LIMIT", 1)
    with pytest.raises(ImmError, match="5,000"):
        shipments.listing(db, actor, complete=True)


def test_spt_read_contract_accepts_fulfillment_but_not_ordinary_status_writes(store):
    from app.schemas.spt import SptRecord, Status
    from typing import get_args
    assert {"Shipped", "Returned"}.isdisjoint(set(get_args(Status)))
    db, actor, courier_id, records = store
    shipped = shipments.mutate(db, actor, "SPT", records["SPT"], dispatch(1, courier_id), "ship")
    row = db.get(spt.Order, records["SPT"])
    from app.schemas.spt import ReadStatus
    assert row.status == shipped["status"] == "Shipped"
    assert "Shipped" in get_args(ReadStatus) and "Returned" in get_args(ReadStatus)
