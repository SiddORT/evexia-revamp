"""Current-schema readiness on the harness's private, synthetic database only."""
from fastapi import HTTPException
import pytest
from sqlalchemy import text

from app.api.v1.system import readiness
from app.services.account_crypto import AccountCryptoError, ready as accounts_ready
from test_sessions import client


def test_current_schema_readiness_preserves_underlying_failure(client):
    _, db, _ = client
    try:
        assert readiness(db) == {"status": "ready"}
    except HTTPException as error:
        # This database contains only synthetic test data. Expose the real
        # failure instead of losing it behind the public 503 response.
        if isinstance(error.__context__, Exception):
            raise error.__context__ from None
        raise


@pytest.mark.parametrize("fragment", [
    "FROM purchase_receipts", "FROM pr_batch_counters", "FROM inventory_lots",
    "FROM combo_products", "FROM languages", "FROM opening_stock",
    "FROM mr_zone_assignments",
])
def test_successor_retains_inherited_readiness_probes(client, monkeypatch, fragment):
    _, db, _ = client
    original = db.execute
    def unavailable(statement, *args, **kwargs):
        if fragment in str(statement):
            raise RuntimeError("Synthetic unavailable inherited feature")
        return original(statement, *args, **kwargs)
    monkeypatch.setattr(db, "execute", unavailable)
    with pytest.raises(HTTPException) as failure:
        readiness(db)
    assert failure.value.status_code == 503
    assert isinstance(failure.value.__context__, RuntimeError)


def test_modern_readiness_requires_distinct_mr_invitation(client, monkeypatch):
    from app.services import email_templates
    _, db, _ = client
    original = email_templates.resolve_event
    events = []
    def resolve(session, event):
        events.append(event)
        if event == "mr_invitation":
            raise ValueError("Synthetic missing required template")
        return original(session, event)
    monkeypatch.setattr(email_templates, "resolve_event", resolve)
    with pytest.raises(HTTPException) as failure:
        readiness(db)
    assert failure.value.status_code == 503
    assert events == ["password_recovery", "account_invitation", "mr_invitation"]


def test_unknown_account_successor_remains_rejected(client):
    _, db, _ = client
    db.execute(text("UPDATE alembic_version SET version_num='unknown_future'"))
    try:
        with pytest.raises(AccountCryptoError):
            accounts_ready(db)
    finally:
        db.rollback()
