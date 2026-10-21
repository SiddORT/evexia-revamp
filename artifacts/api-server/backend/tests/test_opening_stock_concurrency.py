"""Explicit Opening Stock races: real commits, private databases, no TCP listeners."""
import csv
import io
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path
from threading import Event

import pytest
from alembic import command
from alembic.config import Config
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.inventory_models import (
    InventoryBalance, InventoryLot, InventoryMovement, InventoryPosting, InventoryRequest,
)
from app.db.models import AuditEvent
from app.db.opening_stock_models import OpeningStock, OpeningStockRequest
from app.db.session import get_db
from app.main import app
from app.schemas.inventory import MoveCreate, MovementSaved
from app.schemas.opening_stock import OpeningCreate, OpeningResult
from app.services import inventory, opening_stock
from app.services.auth import identity_from_token
from app.services.purchase_received_crypto import PRError
from test_inventory_crud import destination
from test_opening_stock_operations import BASE, STOCK, draft, reviewed, save, uploaded
from test_purchase_orders import fixture


@pytest.fixture
def committed_openings():
    """Each case owns its protected actor, database and in-process HTTP transport."""
    settings = get_settings()
    url = make_url(os.environ.get("TEST_DATABASE_URL", "postgresql:///missing"))
    assert settings.app_env == "test"
    assert url == make_url(settings.database_url)
    assert "test" in (url.database or "")
    assert str(url.query.get("host", "")).startswith("/tmp/evexia-api-test.")
    assert not url.host, "Never use a network or configured development database"
    name = "opening_stock_test_" + uuid.uuid4().hex
    control = create_engine(url, isolation_level="AUTOCOMMIT", hide_parameters=True)
    engine = create_engine(url.set(database=name), hide_parameters=True)
    overrides = dict(app.dependency_overrides)

    def override(request: Request):
        with Session(engine, expire_on_commit=False) as db:
            db.info["request_id"] = request.state.request_id
            yield db

    try:
        with control.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{name}" TEMPLATE template0'))
        root = Path(__file__).resolve().parents[1]
        config = Config(str(root / "alembic.ini"))
        config.set_main_option("script_location", str(root / "alembic"))
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        app.dependency_overrides[get_db] = override
        app.dependency_overrides[get_settings] = lambda: settings
        with TestClient(app, base_url="http://testserver") as api, Session(
            engine, expire_on_commit=False,
        ) as db:
            headers, actor, fields, item = fixture(api, db)
            yield api, db, engine, settings, headers, actor, fields, item
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(overrides)
        engine.dispose()
        with control.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        control.dispose()


def race(env, monkeypatch, first, second):
    """Hold winner after the real shared lock; prove the competitor blocks in PG.

    Never put a two-party barrier *inside* the production serialization boundary:
    contenders correctly wait on User/session locks before the inventory lock.
    No lock is replaced or acquired in a different order.
    """
    _, _, engine, settings, headers, *_ = env
    held, release, started = Event(), Event(), Event()
    real_lock = inventory.lock
    pids = {}
    prefix = "opening-race-" + uuid.uuid4().hex

    def held_lock(db):
        real_lock(db)
        if db.info.get("race_index") == 0:
            held.set()
            assert release.wait(15), "Timed out releasing first inventory transaction"

    def run(index, operation):
        with Session(engine, expire_on_commit=False) as db:
            db.execute(text("SET LOCAL statement_timeout = '20s'"))
            db.execute(text("SET LOCAL lock_timeout = '15s'"))
            pids[index] = db.scalar(text("SELECT pg_backend_pid()"))
            db.info["race_index"] = index
            db.info["request_id"] = f"{prefix}-{index}"
            actor = identity_from_token(db, headers["Authorization"][7:], settings)
            if index == 1:
                started.set()
            try:
                return operation(db, actor)
            except PRError as exc:
                return exc.status, exc.code

    with monkeypatch.context() as patch:
        patch.setattr(inventory, "lock", held_lock)
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix=prefix) as pool:
            winner = pool.submit(run, 0, first)
            try:
                assert held.wait(15), "First transaction never reached inventory lock"
                contender = pool.submit(run, 1, second)
                assert started.wait(15), "Second transaction never authenticated"
                deadline = time.monotonic() + 10
                with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
                    while time.monotonic() < deadline:
                        blocking = observer.scalar(text("SELECT pg_blocking_pids(:pid)"),
                                                   {"pid": pids[1]})
                        if pids[0] in blocking:
                            break
                        assert not contender.done(), "Competitor escaped serialization"
                        time.sleep(.01)
                    else:
                        pytest.fail("No PostgreSQL lock contention observed")
            finally:
                release.set()
            return winner.result(timeout=25), contender.result(timeout=25)


def opening_command(api, headers, body):
    return OpeningCreate(**body, reviewToken=reviewed(api, headers, body)["reviewToken"],
                         idempotencyKey=uuid.uuid4())


def assert_ledger(db, records, movements=0):
    """Exactly one credit/audit per durable row, plus balanced movement pairs."""
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(OpeningStock)) == len(records)
    assert db.scalar(select(func.count()).select_from(InventoryLot)) == len(records)
    openings = list(db.scalars(select(OpeningStock)))
    assert {(str(r.source_id), str(r.row_id)) for r in openings} == {
        (r["sourceId"], r["rowId"]) for r in records
    }
    events = list(db.scalars(select(AuditEvent).where(
        AuditEvent.resource_type == "opening_stock", AuditEvent.outcome == "success")))
    assert len(events) == len(records)
    assert {e.id for e in events} == {r.event_id for r in openings}
    assert {str(e.resource_id) for e in events} == {r["id"] for r in records}
    assert db.scalar(select(func.count()).select_from(InventoryMovement)) == movements
    assert db.scalar(select(func.count()).select_from(AuditEvent).where(
        AuditEvent.action == "inventory_allocated", AuditEvent.outcome == "success")) == movements
    postings = list(db.scalars(select(InventoryPosting)))
    assert len(postings) == len(records) + movements * 2
    for record in records:
        lot_id = uuid.UUID(record["lotId"])
        credits = [p for p in postings if p.lot_id == lot_id and p.movement_id is None]
        assert len(credits) == 1
        credit = credits[0]
        lot = db.get(InventoryLot, lot_id)
        assert credit.source_key == "opening:" + record["id"]
        assert credit.delta == lot.accepted == Decimal(record["quantity"])
        assert credit.before == 0 and credit.after == credit.delta
        assert lot.opening_id == uuid.UUID(record["id"])
        balances = list(db.scalars(select(InventoryBalance).where(InventoryBalance.lot_id == lot_id)))
        assert sum((b.quantity for b in balances), Decimal(0)) == lot.accepted
        for balance in balances:
            assert balance.quantity >= 0
            assert balance.quantity == sum(
                (p.delta for p in postings if p.lot_id == lot_id and p.location_id == balance.location_id),
                Decimal(0),
            )
        assert all(p.before >= 0 and p.after >= 0 and p.after == p.before + p.delta
                   for p in postings if p.lot_id == lot_id)


def assert_snapshots(api, db, headers, records, ciphertexts=None):
    crypto = inventory.InventoryCrypto(get_settings())
    for record in records:
        assert api.get(BASE + "/" + record["id"], headers=headers).json() == record
        opening = db.get(OpeningStock, uuid.UUID(record["id"]))
        lot = db.get(InventoryLot, uuid.UUID(record["lotId"]))
        meta = crypto.open(lot.id, "lot", lot.payload_ciphertext)
        assert meta["unitRate"] == record["unitRate"]
        assert meta["openingLocation"] == record["location"]
        assert meta["openingId"] == record["id"] and meta["source"] == "opening"
        assert meta["openingValue"] == record["openingValue"]
        assert meta["recordedDate"] == record["recordedDate"]
        assert meta["receiptId"] is None and meta["expiryDate"] is None
        if ciphertexts:
            assert (opening.payload_ciphertext, lot.payload_ciphertext) == ciphertexts[record["id"]]


@pytest.mark.parametrize("mode", ["manual", "import"])
def test_simultaneous_same_key_commits_credit_each_row_once(committed_openings, monkeypatch, mode):
    env = committed_openings
    api, db, _, _, headers, _, fields, item = env
    body = draft(item)
    body["mode"] = mode
    body["rows"].append(draft(item, fields["locationId"], quantity="1.001", rate="2.675")["rows"][0])
    command = opening_command(api, headers, body)
    operation = lambda db, actor: opening_stock.create(db, actor, command)
    first, second = race(env, monkeypatch, operation, operation)
    assert isinstance(first, dict) and second == first
    # HTTP response models canonicalize datetimes (+00:00 -> Z) and optional
    # provenance fields. Compare HTTP with HTTP shape, not raw service dicts.
    first = OpeningResult.model_validate(first).model_dump(mode="json")
    assert first["postedCount"] == 2
    assert [r["unitRate"] for r in first["records"]] == ["100.01", "2.68"]
    assert api.get(BASE + "/requests/" + str(command.idempotencyKey), headers=headers).json() == {
        "state": "committed", "result": first,
    }
    assert db.scalar(select(func.count()).select_from(OpeningStockRequest)) == 1
    assert_ledger(db, first["records"])
    assert_snapshots(api, db, headers, first["records"])


def test_concurrent_different_key_uploads_reconcile_same_durable_rows(committed_openings, monkeypatch):
    env = committed_openings
    api, db, _, _, headers, _, fields, _ = env
    sample = api.get(BASE + "/sample", headers=headers)
    assert sample.status_code == 200, sample.text
    rows = list(csv.reader(io.StringIO(sample.content.decode("utf-8-sig"))))
    rows[1][6:8] = ["2.125", "100.005"]
    extra = list(rows[1])
    extra[1], extra[6], extra[7], extra[8] = str(uuid.uuid4()), "1.001", "2.675", fields["locationId"]
    rows.append(extra)
    reviews = [uploaded(api, headers, rows, format) for format in ("csv", "xlsx")]
    commands = [OpeningCreate(**r["command"], reviewToken=r["reviewToken"],
                              idempotencyKey=uuid.uuid4()) for r in reviews]
    first, second = race(env, monkeypatch,
        lambda db, actor: opening_stock.create(db, actor, commands[0]),
        lambda db, actor: opening_stock.create(db, actor, commands[1]))
    assert isinstance(first, dict) and first["postedCount"] == 2
    assert second == (409, "opening_review_stale")
    first = OpeningResult.model_validate(first).model_dump(mode="json")
    # A stale pre-commit review is not permission to silently retry with a new key.
    cancelled = api.get(BASE + "/requests/" + str(commands[1].idempotencyKey), headers=headers)
    assert cancelled.status_code == 200 and cancelled.json() == {"state": "not_committed", "result": None}
    again = uploaded(api, headers, rows, "xlsx")
    assert again["alreadyImportedCount"] == 2 and again["validCount"] == 0
    response = api.post(BASE, headers=headers, json={
        **again["command"], "reviewToken": again["reviewToken"], "idempotencyKey": str(uuid.uuid4()),
    })
    assert response.status_code == 201, response.text
    assert response.json()["records"] == first["records"]
    assert response.json()["postedCount"] == 0 and response.json()["alreadyImportedCount"] == 2
    assert_ledger(db, first["records"])
    assert_snapshots(api, db, headers, first["records"])


@pytest.mark.parametrize("cancel_first", [True, False])
def test_absent_key_cancellation_and_delayed_writer_have_one_terminal_outcome(
    committed_openings, monkeypatch, cancel_first,
):
    env = committed_openings
    api, db, _, _, headers, _, _, item = env
    command = opening_command(api, headers, draft(item))
    write = lambda db, actor: opening_stock.create(db, actor, command)
    cancel = lambda db, actor: opening_stock.reconcile(db, actor, command.idempotencyKey)
    first, second = race(env, monkeypatch, cancel if cancel_first else write, write if cancel_first else cancel)
    outcome = api.get(BASE + "/requests/" + str(command.idempotencyKey), headers=headers)
    assert outcome.status_code == 200, outcome.text
    if cancel_first:
        assert first == outcome.json() == {"state": "not_committed", "result": None}
        assert second == (409, "opening_retry")
        assert_ledger(db, [])
        assert db.get(OpeningStockRequest, command.idempotencyKey).digest == "cancelled"
        assert api.post(BASE, headers=headers, json=command.model_dump(mode="json")).status_code == 409
    else:
        assert isinstance(first, dict) and first["postedCount"] == 1
        assert second == {"state": "committed", "result": first}
        first = OpeningResult.model_validate(first).model_dump(mode="json")
        assert outcome.json() == {"state": "committed", "result": first}
        assert_ledger(db, first["records"])
        assert_snapshots(api, db, headers, first["records"])
    assert db.scalar(select(func.count()).select_from(OpeningStockRequest)) == 1


def test_competing_unallocated_allocations_cannot_overdraw_or_rewrite_source(committed_openings, monkeypatch):
    env = committed_openings
    api, db, _, _, headers, actor, fields, item = env
    result, _ = save(api, headers, draft(item))
    record = result["records"][0]
    opening = db.get(OpeningStock, uuid.UUID(record["id"]))
    lot = db.get(InventoryLot, uuid.UUID(record["lotId"]))
    ciphertexts = {record["id"]: (opening.payload_ciphertext, lot.payload_ciphertext)}
    dst = destination(db, actor)
    commands = []
    # Both drafts are individually valid, but their combined demand exceeds 2.125.
    for target in (fields["locationId"], str(dst.id)):
        body = dict(sourceId=None, destinationId=target, date="2026-10-19",
                    deliveryMode="other", staffId=None, otherName="Synthetic carrier",
                    lines=[dict(lotId=record["lotId"], quantity="1.500")])
        response = api.post(STOCK + "/movements/preview", headers=headers, json=body)
        assert response.status_code == 200, response.text
        commands.append(MoveCreate(**body, reviewToken=response.json()["reviewToken"],
                                   idempotencyKey=uuid.uuid4()))
    db.commit()
    first, second = race(env, monkeypatch,
        lambda db, actor: inventory.create(db, actor, commands[0]),
        lambda db, actor: inventory.create(db, actor, commands[1]))
    assert isinstance(first, dict)
    assert second == (409, "inventory_insufficient")
    assert first["lines"][0]["sourceAfter"] == "0.625"
    assert first["lines"][0]["destinationAfter"] == "1.500"
    assert first["lines"][0]["unitRate"] == "100.01"
    first = MovementSaved.model_validate(first).model_dump(mode="json")
    replay = api.post(STOCK + "/movements", headers=headers, json=commands[0].model_dump(mode="json"))
    assert replay.status_code == 201 and replay.json() == first
    assert db.scalar(select(func.count()).select_from(InventoryRequest)) == 1
    assert db.get(InventoryRequest, commands[1].idempotencyKey) is None
    assert_ledger(db, [record], movements=1)
    balances = {b.location_id: b.quantity for b in db.scalars(select(InventoryBalance))}
    assert balances == {None: Decimal("0.625"), uuid.UUID(fields["locationId"]): Decimal("1.500")}
    assert_snapshots(api, db, headers, [record], ciphertexts)
