"""Bounded, independent-connection credit races; PostgreSQL locks are real.

An observed pg_locks waiter proves overlap before the winner is released.
Threads never share a Session; failures/timeouts always release the holder.
"""
import itertools
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event, current_thread

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db.settlement_models import SettlementEntry
from app.services import mr_orders, order_eligibility, settlements
from app.services.immunotherapy import ImmError
from order_eligibility_support import SERVICES


def wait_for(event):
    assert event.wait(15), "Concurrent worker never reached its synchronization point"


def observe_waiter(engine, pid):
    deadline = time.monotonic() + 15
    pause = Event()
    while time.monotonic() < deadline:
        with engine.connect() as conn:
            blocked = conn.scalar(text(
                "SELECT EXISTS (SELECT 1 FROM pg_locks "
                "WHERE pid=:pid AND locktype='advisory' AND NOT granted)"), {"pid": pid})
            if blocked:
                # In addition to policy/graph locks, every financial contender
                # must share this specific lock with the holder.
                available = conn.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"),
                                        {"key": order_eligibility.LOCK})
                assert available is False, "The financial lock was not held"
                return
        pause.wait(.01)
    pytest.fail("Second independent session never waited on the held transaction")


def outcome(call):
    try:
        return ("committed", call())
    except ImmError as error:
        return (error.code, error.status)


@pytest.mark.parametrize("first,second", list(itertools.permutations(SERVICES, 2)))
@pytest.mark.parametrize("second_amount,expected", [
    ("40.00", "committed"), ("40.01", "mr_payment_limit"),
])
def test_cross_type_placements_serialize_at_exact_credit_boundary(
        financial_store, first, second, second_amount, expected):
    store = financial_store
    held, release, started = Event(), Event(), Event()
    contender_pid = []

    def hold(db):
        held.set()
        wait_for(release)

    def before(db):
        contender_pid.append(db.scalar(text("SELECT pg_backend_pid()")))
        started.set()

    with ThreadPoolExecutor(max_workers=2) as pool:
        winner = pool.submit(store.place, first, store.body(first, "60.00"), hook=hold)
        try:
            wait_for(held)
            loser = pool.submit(outcome, lambda: store.place(second,
                store.body(second, second_amount), before=before))
            wait_for(started)
            observe_waiter(store.engine, contender_pid[0])
            assert not loser.done()
        finally:
            release.set()
        committed = winner.result(timeout=20)
        state, reply = loser.result(timeout=20)
    assert state == expected, reply
    assert committed["id"]
    assert sum(store.counts().values()) == (2 if expected == "committed" else 1)
    probe = store.evaluate("spt", store.body("spt", "0.00"))
    assert probe["outstanding"] == ("100.00" if expected == "committed" else "60.00")


@pytest.mark.parametrize("kind", SERVICES)
@pytest.mark.parametrize("payment_first", [True, False])
def test_settlement_commit_and_placement_use_one_serial_financial_view(
        financial_store, monkeypatch, kind, payment_first):
    store = financial_store
    saved = store.place(kind, store.body(kind, "100.00"))
    store.rewrite(kind, saved["id"], status="In process")
    next_kind = "kits" if kind != "kits" else "spt"
    held, release, started = Event(), Event(), Event()
    contender_pid = []
    original_revalidate = mr_orders.revalidate_identity

    # All service aliases call into this shared revalidation point after
    # taking the policy and financial locks, before taking graph/zone locks.
    def revalidate(db, actor, lock):
        current = original_revalidate(db, actor, lock)
        if current_thread().name.endswith("_0"):
            held.set()
            wait_for(release)
        return current
    monkeypatch.setattr(mr_orders, "revalidate_identity", revalidate)

    # The second session publishes its backend PID before attempting a lock.
    # payment() does not expose the Session, so record it from the connection
    # event instead, restricted to this pool's second thread.
    from sqlalchemy import event
    def on_execute(conn, cursor, statement, parameters, context, executemany):
        if current_thread().name.endswith("_1") and not contender_pid:
            cursor.execute("SELECT pg_backend_pid()")
            contender_pid.append(cursor.fetchone()[0])
            started.set()
    event.listen(store.engine, "before_cursor_execute", on_execute)

    try:
        # ThreadPoolExecutor starts its first submission on _0. Explicitly
        # wait for it before submitting _1, making both serial orders exact.
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="credit_interleave") as pool:
            payment = lambda: store.payment(kind, saved, "40.00")
            placement = lambda: store.place(next_kind, store.body(next_kind, "40.00"))
            first = pool.submit(outcome, payment if payment_first else placement)
            try:
                wait_for(held)
                second = pool.submit(outcome, placement if payment_first else payment)
                wait_for(started)
                observe_waiter(store.engine, contender_pid[0])
                assert not second.done()
            finally:
                release.set()
            first_result, second_result = first.result(timeout=20), second.result(timeout=20)
    finally:
        event.remove(store.engine, "before_cursor_execute", on_execute)
    if payment_first:
        assert first_result[0] == second_result[0] == "committed"
        assert sum(store.counts().values()) == 2
    else:
        assert first_result == ("mr_payment_limit", 409)
        assert second_result[0] == "committed"
        assert sum(store.counts().values()) == 1
        # The rejected placement is safe to retry with a fresh key after the
        # receipt commits; it never reserved credit or created a partial order.
        store.place(next_kind, store.body(next_kind, "40.00"))
    probe = store.evaluate("spt", store.body("spt", "0.00"))
    assert probe["outstanding"] == "100.00"
    with Session(store.engine) as db:
        assert len(list(db.scalars(select(SettlementEntry)))) == 1


@pytest.mark.parametrize("kind", SERVICES)
def test_authorization_holds_financial_lock_before_identity_revalidation(financial_store, monkeypatch, kind):
    store = financial_store
    original = mr_orders.revalidate_identity
    seen = []

    def revalidate(db, actor, lock):
        # Inspect the actual current backend, not a mocked call count.
        assert db.scalar(text(
            "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() "
            "AND locktype='advisory' AND classid=0 AND objid=:key AND granted)"),
            {"key": order_eligibility.LOCK})
        seen.append(True)
        return original(db, actor, lock)
    monkeypatch.setattr(mr_orders, "revalidate_identity", revalidate)
    store.place(kind, store.body(kind, "1.00"))
    assert seen == [True]
