"""MR financial policy against real committed PostgreSQL facts.

Run only through scripts/test-order-eligibility.sh after separate approval.
See order_eligibility_support for the deliberately narrow fixture seams.
"""
import copy
import uuid
from contextlib import contextmanager
from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.settlement_models import SettlementBatch, SettlementEntry
from app.schemas.order_approval import OrderApproval
from app.services import mr_orders, order_approval, order_eligibility, settlements
from app.services.directory_runtime import crypto_scope
from app.services.immunotherapy import ImmError
from order_eligibility_support import SERVICES, TODAY


@contextmanager
def denied(code):
    with pytest.raises(ImmError) as caught:
        yield caught
    assert caught.value.code == code
    assert caught.value.status in (403, 404, 409, 422)


@pytest.mark.parametrize("kind", SERVICES)
def test_exact_amount_boundary_and_failed_write_leaves_no_order(financial_store, kind):
    store = financial_store
    store.place(kind, store.body(kind, "60.00"))
    result = store.evaluate(kind, store.body(kind, "40.00"))
    assert result["eligible"] and result["resultingOutstanding"] == "100.00"
    body = store.body(kind, "40.01")
    before = store.counts()
    with denied("mr_payment_limit"):
        store.place(kind, body)
    assert store.counts() == before
    store.place(kind, store.body(kind, "40.00"))
    assert sum(store.counts().values()) == 2


@pytest.mark.parametrize("kind", SERVICES)
def test_replacement_subtracts_old_order_and_committed_receipts_once(financial_store, kind):
    store = financial_store
    body = store.body(kind, "80.00")
    saved = store.place(kind, body)
    identity = uuid.UUID(saved["id"])
    # Commit a real receipt, then retain it as historical evidence when the
    # saved order becomes editable again. No legacy Paid flag becomes money.
    store.rewrite(kind, identity, status="In process")
    store.payment(kind, saved, "30.00")
    store.rewrite(kind, identity, status=body.status)
    replacement = copy.deepcopy(body)
    replacement.financial_snapshot.update(total="100.00", totalMinor=10000)
    if kind == "kits":
        priced = store.body(kind, "100.00")
        replacement.financial_snapshot["pricing"] = priced.financial_snapshot["pricing"]
    if kind == "immunotherapy":
        # Keep the protected clinical basis unchanged; its total is the exact
        # resolved total at this test seam, not a legacy composition correction.
        replacement.financial_snapshot["pricingBasis"] = "allergen_rates"
    result = store.evaluate(kind, replacement, identity=identity)
    assert result["outstanding"] == "0.00"
    assert result["proposedBalance"] == result["resultingOutstanding"] == "70.00"
    changed = store.place(kind, replacement, identity=identity, expected=saved["version"])
    assert changed["id"] == saved["id"] and changed["version"] == saved["version"] + 1
    assert store.counts()[kind] == 1
    # Replacement below already committed payment must fail, not create credit.
    below = store.body(kind, "20.00")
    if kind == "immunotherapy":
        below.financial_snapshot["pricingBasis"] = "allergen_rates"
    with denied("mr_eligibility_unavailable"):
        store.place(kind, below, identity=identity, expected=changed["version"])
    assert store.counts()[kind] == 1


@pytest.mark.parametrize("kind", SERVICES)
def test_committed_replay_precedes_changed_credit_days_and_missing_totals(financial_store, kind):
    store = financial_store
    body, key = store.body(kind, "50.00"), uuid.uuid4()
    saved = store.place(kind, body, key=key)
    store.settings("1.00", 1)
    # New unrelated unpriced history and tighter settings must not turn an
    # already committed request into a rejected attempt or duplicate its write.
    store.place("spt", store.body("spt", "0.00", status="Draft"))
    draft_id = None
    with Session(store.engine) as db:
        draft_id = db.scalar(select(SERVICES["spt"].Order.id).where(
            SERVICES["spt"].Order.status == "Draft"))
    store.rewrite("spt", draft_id, status="Saved", total=None, date=TODAY - timedelta(days=30))
    before = store.counts()
    replay = store.place(kind, body, key=key)
    assert replay["id"] == saved["id"] and replay["version"] == saved["version"]
    assert store.counts() == before
    with denied("mr_eligibility_unavailable"):
        store.place(kind, body)  # A new key does have to recheck eligibility.
    assert store.counts() == before


@pytest.mark.parametrize("kind", SERVICES)
def test_rejected_correction_resubmission_rechecks_credit_and_replays(financial_store, kind):
    store = financial_store
    body = store.body(kind, "50.00")
    saved = store.place(kind, body)
    identity = uuid.UUID(saved["id"])
    store.rewrite(kind, identity, status="Rejected", correctionSaved=True)
    store.settings("40.00")
    command = OrderApproval(expected_version=saved["version"], idempotencyKey=uuid.uuid4())
    with Session(store.engine) as db, denied("mr_payment_limit"):
        order_approval.resubmit(db, store.actor, identity, command, kind)
    with Session(store.engine) as db:
        row = db.get(SERVICES[kind].Order, identity)
        assert row.status == "Rejected" and row.version == saved["version"]
        assert db.get(SERVICES[kind].Retry, command.idempotencyKey) is None
    # Rejected history does not count as live exposure; adding it back once at
    # equality is permitted, not rejected as old + resubmitted.
    store.settings("50.00")
    with Session(store.engine) as db:
        committed = order_approval.resubmit(db, store.actor, identity, command, kind)
    assert committed["status"] == ("Saved" if kind == "spt" else "Confirmed")
    assert committed["version"] == saved["version"] + 1
    store.settings("1.00", 1)
    with Session(store.engine) as db:
        replay = order_approval.resubmit(db, store.actor, identity, command, kind)
    assert replay["id"] == committed["id"] and replay["version"] == committed["version"]
    assert store.counts()[kind] == 1


@pytest.mark.parametrize("kind", SERVICES)
@pytest.mark.parametrize("age,paid,eligible", [
    (10, "0.00", True), (11, "0.00", False),
    (11, "49.99", False), (11, "50.00", True),
])
def test_saved_order_date_not_transaction_date_controls_doctor_aging(
        financial_store, kind, age, paid, eligible):
    store = financial_store
    saved = store.place(kind, store.body(kind, "50.00"))
    store.rewrite(kind, saved["id"], date=TODAY - timedelta(days=age), status="In process")
    if paid != "0.00":
        store.payment(kind, saved, paid)  # Payment date is TODAY, not the order date.
    store.settings("0.00", 10)
    result = store.evaluate("spt", store.body("spt", "1.00"))
    assert result["eligible"] is eligible
    assert [r["code"] for r in result["reasons"]] == ([] if eligible else ["mr_doctor_days_limit"])
    if not eligible:
        assert result["reasons"][0]["ageDays"] == age
    other_doctor = store.evaluate("spt", store.body("spt", "1.00", doctor=store.doctor2))
    assert other_doctor["eligible"]


def test_backdated_proposal_and_saved_replacement_keep_their_own_date(financial_store):
    store = financial_store
    store.settings("0.00", 10)
    body = store.body("spt", "50.00", order_date=TODAY - timedelta(days=11))
    with denied("mr_doctor_days_limit"):
        store.place("spt", body)
    body.orderDate = TODAY - timedelta(days=10)
    saved = store.place("spt", body)
    store.rewrite("spt", saved["id"], date=TODAY - timedelta(days=11))
    body.orderDate = None
    with denied("mr_doctor_days_limit"):
        store.place("spt", body, identity=uuid.UUID(saved["id"]), expected=saved["version"])


@pytest.mark.parametrize("limit,days,eligible,reason", [
    ("0.00", 0, True, None),
    ("0.00", 10, False, "mr_doctor_days_limit"),
    ("100.00", 0, False, "mr_payment_limit"),
])
def test_zero_settings_are_independent_and_doctor_master_is_not_a_fallback(
        financial_store, limit, days, eligible, reason):
    store = financial_store
    saved = store.place("spt", store.body("spt", "90.00"))
    store.rewrite("spt", saved["id"], date=TODAY - timedelta(days=11))
    store.settings(limit, days)
    from app.db.doctor_models import DoctorDirectory
    with Session(store.engine) as db:
        doctor = db.get(DoctorDirectory, store.doctor)
        doctor.daysLimit, doctor.paymentLimit = 1, Decimal("1.00")
        db.commit()
    # Restrictive Doctor Master values are NOT extra limits or fallback values.
    # Only MR settings apply, including when both MR controls are zero.
    result = store.evaluate("lupin", store.body("lupin", "20.00"))
    assert result["eligible"] is eligible
    assert [r["code"] for r in result["reasons"]] == ([reason] if reason else [])


@pytest.mark.parametrize("kind", SERVICES)
@pytest.mark.parametrize("limit,days", [("100.00", 0), ("0.00", 10)])
def test_unknown_proposed_and_saved_totals_fail_closed_for_either_rule(
        financial_store, kind, limit, days):
    store = financial_store
    store.settings(limit, days)
    unknown = store.body(kind, None)
    with denied("mr_eligibility_unavailable"):
        store.place(kind, unknown)
    assert sum(store.counts().values()) == 0
    saved = store.place(kind, store.body(kind, "50.00"))
    changes = {"totalMinor": None} if kind == "immunotherapy" else (
        {"pricing": None} if kind == "kits" else {"total": None})
    store.rewrite(kind, saved["id"], **changes)
    with denied("mr_eligibility_unavailable"):
        store.place("spt", store.body("spt", "1.00"))
    # Days-only evaluation can ignore a different Doctor's unpriced history;
    # amount-only evaluation must examine the MR's complete exposure.
    if not Decimal(limit):
        assert store.evaluate("spt", store.body("spt", "1.00", doctor=store.doctor2))["eligible"]


@pytest.mark.parametrize("kind", SERVICES)
def test_unknown_totals_are_not_required_when_both_rules_disabled(financial_store, kind):
    store = financial_store
    store.settings("0.00", 0)
    assert store.evaluate(kind, store.body(kind, None))["eligible"]
    assert store.place(kind, store.body(kind, None))["id"]


@pytest.mark.parametrize("kind", ["spt", "lupin"])
def test_multiple_patients_do_not_multiply_order_or_receipt_balance(financial_store, kind):
    store = financial_store
    saved = store.place(kind, store.body(kind, "80.00"))
    with Session(store.engine) as db:
        membership = SERVICES[kind].Membership if kind == "spt" else SERVICES[kind].Patient
        assert db.scalar(select(func.count()).select_from(membership)) == 2
    store.rewrite(kind, saved["id"], status="In process")
    key = uuid.uuid4()
    first = store.payment(kind, saved, "30.00", key=key)
    assert store.payment(kind, saved, "30.00", key=key) == first
    result = store.evaluate("kits", store.body("kits", "50.00"))
    assert result["outstanding"] == "50.00" and result["resultingOutstanding"] == "100.00"
    with Session(store.engine) as db:
        assert db.scalar(select(func.count()).select_from(SettlementBatch)) == 1
        assert db.scalar(select(func.count()).select_from(SettlementEntry)) == 1


@pytest.mark.parametrize("kind", SERVICES)
def test_admin_writes_are_not_mr_credit_restricted_but_cannot_post_payments(financial_store, kind):
    store = financial_store
    store.settings("1.00", 1)
    body = store.body(kind, "500.00", order_date=TODAY - timedelta(days=30))
    saved = store.place(kind, body, actor=store.admin)
    assert store.evaluate(kind, body, actor=store.admin)["eligible"]
    store.rewrite(kind, saved["id"], status="In process")
    with denied("access_denied"):
        store.payment(kind, saved, "1.00", actor=store.admin)
    with Session(store.engine) as db:
        assert db.scalar(select(func.count()).select_from(SettlementEntry)) == 0


@pytest.mark.parametrize("kind", SERVICES)
def test_other_mr_history_and_retry_results_remain_private(financial_store, kind):
    store = financial_store
    key = uuid.uuid4()
    body = store.body(kind, "80.00")
    saved = store.place(kind, body, key=key)
    store.rewrite(kind, saved["id"], status="In process")
    payment_key = uuid.uuid4()
    store.payment(kind, saved, "10.00", key=payment_key)
    # Another MR's history cannot reduce this MR's available limit or be
    # exposed through a direct order ID, order retry or receipt retry.
    own = store.evaluate(kind, store.body(kind, "100.00", actor=store.other), actor=store.other)
    assert own["eligible"] and own["outstanding"] == "0.00"
    with Session(store.engine) as db, pytest.raises(ImmError) as missing:
        SERVICES[kind].detail(db, store.other, uuid.UUID(saved["id"]))
    assert missing.value.status == 404
    assert "Saved Doctor" not in missing.value.message and "80.00" not in missing.value.message
    with pytest.raises(ImmError) as retry:
        store.place(kind, body, actor=store.other, key=key)
    assert retry.value.status == 409
    with denied("settlement_not_found"):
        store.payment(kind, saved, "1.00", actor=store.other)
    with Session(store.engine) as db, denied("access_denied"):
        settlements.reconcile(db, store.other, payment_key)
    with denied("access_denied"):
        store.payment(kind, saved, "10.00", key=payment_key, actor=store.other)
    # Unknown foreign evidence must also remain outside eligibility's scan.
    store.rewrite(kind, saved["id"], total=None, totalMinor=None, pricing=None)
    assert store.evaluate("spt", store.body("spt", "100.00", actor=store.other),
                          actor=store.other)["eligible"]


def test_eligibility_never_silently_defaults_to_admin_before_authorization(financial_store):
    store = financial_store
    with Session(store.engine) as db, crypto_scope(db) as keys, denied("access_denied"):
        order_eligibility.evaluate(db, keys, "spt", store.body("spt").financial_snapshot)
    with Session(store.engine) as db, denied("mr_order_assignment"):
        mr_orders.authorize(db, store.actor)
        mr_orders.require_assignment(db, store.other.mr.id)


@pytest.mark.parametrize("kind", SERVICES)
def test_rejected_resubmission_retains_receipts_and_saved_date(financial_store, kind):
    store = financial_store
    saved = store.place(kind, store.body(kind, "50.00"))
    identity = uuid.UUID(saved["id"])
    store.rewrite(kind, identity, status="In process", date=TODAY - timedelta(days=11))
    store.payment(kind, saved, "30.00")
    store.rewrite(kind, identity, status="Rejected", correctionSaved=True)
    store.settings("30.00", 10)
    command = OrderApproval(expected_version=saved["version"], idempotencyKey=uuid.uuid4())
    with Session(store.engine) as db, denied("mr_doctor_days_limit"):
        order_approval.resubmit(db, store.actor, identity, command, kind)
    # Full payment removes the aged obligation, even when resubmitting an old
    # rejected order. Keep both committed receipts, never count them twice.
    store.rewrite(kind, identity, status="In process")
    store.payment(kind, saved, "20.00", paid="30.00")
    store.rewrite(kind, identity, status="Rejected", correctionSaved=True)
    with Session(store.engine) as db:
        committed = order_approval.resubmit(db, store.actor, identity, command, kind)
    assert committed["version"] == saved["version"] + 1
    with Session(store.engine) as db:
        assert db.scalar(select(func.count()).select_from(SettlementEntry)) == 2
    probe = store.evaluate("spt", store.body("spt", "30.00"))
    assert probe["eligible"] and probe["outstanding"] == "0.00"
