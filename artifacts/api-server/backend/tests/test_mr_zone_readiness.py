"""Merged MR-zone readiness, exercised only in disposable PostgreSQL fixtures."""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import text
from test_sessions import client


def test_current_mr_zone_schema_is_ready(client):
    from app.core.schema import SCHEMA_REVISION

    api, db, _ = client
    assert db.scalar(text("SELECT version_num FROM alembic_version")) == SCHEMA_REVISION
    response = api.get("/api/v1/health/readiness")
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "ready"}


@pytest.mark.parametrize("table", [
    "purchase_receipts",
    "pr_batch_counters",
    "inventory_postings",
    "combo_products",
    "languages",
    "opening_stock",
    "mr_zone_assignments",
])
def test_mr_zone_successor_still_requires_each_inherited_feature(client, table):
    api, db, _ = client
    # Only fixed, parametrized fixture table names are interpolated.
    db.execute(text(f'ALTER TABLE "{table}" RENAME TO "readiness_hidden"'))
    db.commit()
    try:
        response = api.get("/api/v1/health/readiness")
        assert response.status_code == 503, response.text
        assert response.json()["error"]["message"] == "Service unavailable"
    finally:
        # The shared request fixture intentionally leaves failed SQL in its
        # savepoint; clear that before restoring the fixture-only table name.
        db.rollback()
        db.execute(text(f'ALTER TABLE "readiness_hidden" RENAME TO "{table}"'))
        db.commit()


def test_feature_inheritance_does_not_accept_a_stale_application(client, monkeypatch):
    from app.core import schema

    api, _, _ = client
    monkeypatch.setattr(schema, "SCHEMA_REVISION", "0050_opening_stock")
    assert api.get("/api/v1/health/readiness").status_code == 503


def test_unknown_account_revision_is_rejected_before_using_keys(monkeypatch):
    from app.services import account_crypto

    keys = Mock(side_effect=AssertionError("Unknown revisions must not use account keys"))
    monkeypatch.setattr(account_crypto, "crypto", keys)
    db = SimpleNamespace(
        get_bind=lambda: SimpleNamespace(engine=SimpleNamespace(echo=False)),
        execute=lambda statement: SimpleNamespace(
            scalars=lambda: SimpleNamespace(all=lambda: ["9999_unreviewed"])),
    )
    with pytest.raises(account_crypto.AccountCryptoError):
        account_crypto.ready(db)
    keys.assert_not_called()
