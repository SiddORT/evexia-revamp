"""Real branch/merge migrations and retained synthetic accounts; no live DB.

Run with scripts/test-api-foundation.sh tests/test_tariff_merge_compatibility.py.
The harness owns a private PostgreSQL cluster. Each parameter gets a separate
database, migrated to 0102, populated, then (only for 0103) actually merged.
"""
import uuid
from datetime import date
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.v1.system import readiness
from app.core.config import get_settings
from app.core.security import hash_password, utcnow
from app.db.models import MRProfile, User
from app.db.product_category_models import ProductCategory
from app.db.pricing_rule_models import CategoryCountTariff
from app.db.session import get_db
from app.main import app
from app.services import account_crypto, auth
from app.services.purchase_received_crypto import ReceiptCrypto

BRANCH = "0102_category_count_tariffs"
MERGE = "0103_tariff_staged_merge"
PASSWORD = "synthetic-retained-password-123"
BACKEND = Path(__file__).resolve().parents[1]


def retained(db):
    return {
        table: db.execute(sa.text(f"SELECT * FROM {table} ORDER BY 1")).mappings().all()
        for table in ("users", "account_identifier_reservations", "account_crypto_state",
                      "directory_crypto_stage", "it_category_count_tariffs")
    }


@pytest.fixture(scope="module", params=[BRANCH, MERGE])
def migrated(request):
    settings = get_settings()
    url = sa.engine.make_url(settings.database_url)
    # Never allow this suite's CREATE/DROP against an operator-configured DB.
    assert settings.app_env == "test" and url.database == "evexia_api_test"
    assert str(url.query.get("host", "")).startswith("/tmp/evexia-api-test.")
    name = "tariff_compat_" + uuid.uuid4().hex
    admin = sa.create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.exec_driver_sql(f'CREATE DATABASE "{name}"')
    engine = sa.create_engine(url.set(database=name), hide_parameters=True)
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "alembic"))

    def migrate(target):
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, target)

    try:
        migrate(BRANCH)
        with Session(engine) as db:
            user = User(email="Retained@example.com", username="retained.user",
                        system_role="mr", is_active=True, password_hash=hash_password(PASSWORD))
            db.add(user)
            db.flush()
            db.add(MRProfile(user_id=user.id, is_active=True))
            category = ProductCategory(name="Synthetic retained tariff", unit_price="123.45",
                                       status="active", created_by=user.id, updated_by=user.id)
            db.add(category)
            db.flush()
            tariff_id = uuid.uuid4()
            db.add(CategoryCountTariff(
                id=tariff_id, category_id=category.id, allergen_count=1,
                effective_from=date(2026, 1, 1), version=1, actor_id=user.id,
                recorded_at=utcnow(), payload_ciphertext=ReceiptCrypto(settings).seal(
                    tariff_id, "it-count-tariff", {"totalMrp": "123.45"})))
            db.commit()
            before = retained(db)
            owner = user.id
        if request.param == MERGE:
            migrate(MERGE)
        with Session(engine) as db:
            assert retained(db) == before
        yield engine, owner, request.param, before
    finally:
        engine.dispose()
        with admin.connect() as connection:
            connection.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
        admin.dispose()


@pytest.fixture
def db(migrated):
    engine, _, _, _ = migrated
    with engine.connect() as connection:
        outer = connection.begin()
        with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
            yield session
        outer.rollback()


def test_retained_account_lookup_login_and_readiness(db, migrated):
    _, owner, revision, before = migrated
    assert db.scalars(sa.text("SELECT version_num FROM alembic_version")).all() == [revision]
    assert readiness(db) == {"status": "ready"}
    for identifier in ("RETAINED.USER", "RETAINED@EXAMPLE.COM"):
        assert db.scalar(sa.select(User.id).where(account_crypto.lookup(db, identifier))) == owner
        identity, refresh = auth.login(db, identifier, PASSWORD, get_settings(),
                                      False, "synthetic-compatibility", "127.0.0.1")
        assert identity.user.id == owner
        renewed, _ = auth.rotate_refresh(db, refresh, get_settings(), "synthetic-renewal")
        assert renewed.user.id == owner
    assert retained(db) == before


def test_http_login_and_readiness_without_workers(db):
    # Intentionally no TestClient context: do not start notification/expiry or
    # scheduler lifespan tasks, even on this private fixture.
    app.dependency_overrides[get_db] = lambda: db
    try:
        with_client = TestClient(app, base_url="http://testserver")
        try:
            response = with_client.post("/api/v1/auth/login",
                headers={"Origin": "http://testserver"},
                json={"identifier": "retained.user", "password": PASSWORD})
            assert response.status_code == 200, response.text
            assert with_client.get("/api/v1/health/readiness").json() == {"status": "ready"}
        finally:
            with_client.close()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.parametrize("table", [
    "it_category_count_tariffs", "gst_policy_revisions", "opening_stock_revisions",
    "hsn_mappings", "quantity_precision_boundary", "quantity_precision_snapshots",
    "languages", "immunotherapy_dilution_material", "invoice_settings_revisions",
    "order_notification_deliveries", "purchase_receipts", "pr_batch_counters",
    "inventory_lots", "combo_products", "opening_stock", "mr_zone_assignments",
    "low_stock_settings", "low_stock_settings_requests", "low_stock_weeks",
    "low_stock_deliveries", "low_stock_schedule", "low_stock_occurrences",
    "low_stock_occurrence_deliveries",
])
def test_missing_inherited_tables_fail_readiness(db, migrated, table):
    if table.startswith("low_stock_") and migrated[2] == BRANCH:
        assert db.scalar(sa.text("SELECT to_regclass(:name)"), {"name": table}) is None
        return
    # Rename, rather than mock SQL: the actual table is unavailable to probes.
    db.execute(sa.text(f'ALTER TABLE "{table}" RENAME TO "unavailable_{table}"'))
    with pytest.raises(HTTPException) as failure:
        readiness(db)
    assert failure.value.status_code == 503


@pytest.mark.parametrize("statement", [
    'ALTER TABLE designations DROP COLUMN "shortName"',
    "ALTER TABLE language_changes DROP COLUMN after_status",
    "ALTER TABLE inventory_postings DISABLE TRIGGER quantity_hundredths",
    "ALTER TABLE opening_stock_revisions DISABLE TRIGGER opening_stock_revisions_immutable",
    "ALTER TABLE it_category_count_tariffs DISABLE TRIGGER it_tariff_immutable",
    "ALTER TABLE it_category_count_tariffs DISABLE TRIGGER it_tariff_no_truncate",
    "ALTER TABLE it_category_count_tariffs DROP CONSTRAINT uq_it_tariff_date",
    "ALTER TABLE settlement_entries DISABLE TRIGGER settlement_entries_immutable",
])
def test_missing_inherited_columns_and_guards_fail_readiness(db, statement):
    db.execute(sa.text(statement))
    with pytest.raises(HTTPException) as failure:
        readiness(db)
    assert failure.value.status_code == 503


@pytest.mark.parametrize("anchor", [
    "configuration_digest", "protected_email_index", "missing_account_state",
    "directory_configuration", "directory_index", "directory_phase",
])
def test_bad_anchors_fail_closed(db, anchor):
    if anchor.startswith("directory_"):
        column, value = {
            "directory_configuration": ("configuration_digest", "0" * 64),
            "directory_index": ("index_key_check", "0" * 64),
            "directory_phase": ("phase", "frozen"),
        }[anchor]
        db.execute(sa.text(f"UPDATE directory_crypto_stage SET {column}=:v"), {"v": value})
    elif anchor == "missing_account_state":
        db.execute(sa.text("DELETE FROM account_crypto_state"))
    else:
        db.execute(sa.text(f"UPDATE account_crypto_state SET {anchor}=:v"), {"v": "0" * 64})
    if not anchor.startswith("directory_"):
        with pytest.raises(account_crypto.AccountCryptoError):
            account_crypto.lookup(db, "retained.user")
    with pytest.raises(HTTPException) as failure:
        readiness(db)
    assert failure.value.status_code == 503


@pytest.mark.parametrize("revisions", [
    ["0104_unknown_successor"], ["0101_gst_staged_merge"],
    [BRANCH, MERGE], [],
])
def test_unreviewed_or_multiple_heads_fail_closed(db, revisions):
    db.execute(sa.text("DELETE FROM alembic_version"))
    for revision in revisions:
        db.execute(sa.text("INSERT INTO alembic_version VALUES (:r)"), {"r": revision})
    with pytest.raises(account_crypto.AccountCryptoError):
        account_crypto.lookup(db, "retained.user")
    with pytest.raises(HTTPException):
        readiness(db)


def test_development_target_and_staged_delivery_remain_unchanged(db, migrated):
    from app.core.schema import SCHEMA_REVISION
    from app.services.low_stock_worker import claim
    from app.services import directory_rotation

    assert SCHEMA_REVISION == BRANCH
    assert claim(db, utcnow()) is None
    if migrated[2] == MERGE:
        # Offline rotation has its own reviewed inventory/lock contract.
        # Runtime compatibility must not silently authorize that operation.
        with pytest.raises(directory_rotation.RotationError):
            directory_rotation._fields(db)


def test_preflight_succeeds_in_read_only_transaction(migrated):
    engine, _, revision, before = migrated
    with engine.connect() as connection, connection.begin():
        connection.execute(sa.text("SET TRANSACTION READ ONLY"))
        connection.execute(sa.text("SET LOCAL lock_timeout='500ms'"))
        with Session(bind=connection, join_transaction_mode="rollback_only") as db:
            assert db.scalars(sa.text("SELECT version_num FROM alembic_version")).all() == [revision]
            assert readiness(db) == {"status": "ready"}
            assert retained(db) == before
