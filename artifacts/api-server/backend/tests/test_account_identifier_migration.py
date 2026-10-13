"""Populated migration proofs using original migrations and real dump/restore."""
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import User
from app.services.account_crypto import crypto, lookup, AccountCryptoError
from account_migration_fixture import rehearsed_account_approval

PREVIOUS = "0034_shared_phone_countries"
TARGET = "0035_account_identifiers"


@pytest.fixture
def legacy(monkeypatch):
    admin = sa.create_engine(get_settings().database_url, hide_parameters=True)
    schema = "account_old_" + uuid.uuid4().hex
    with admin.begin() as db:
        db.execute(sa.text(f'CREATE SCHEMA "{schema}"'))
    url = admin.url.set(query={**admin.url.query, "options": f"-csearch_path={schema}"})
    monkeypatch.setenv("DATABASE_URL", url.render_as_string(hide_password=False))
    get_settings.cache_clear()
    engine = sa.create_engine(url, hide_parameters=True)
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    try:
        command.upgrade(config, PREVIOUS)
        yield engine, config
    finally:
        engine.dispose()
        get_settings.cache_clear()
        with admin.begin() as db:
            db.execute(sa.text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def seed(engine):
    owner = uuid.uuid4()
    ordinary = uuid.uuid4()
    password = hash_password("synthetic-protected-password")
    with engine.begin() as db:
        db.execute(sa.text("SET LOCAL evexia.bootstrap_super_admin='on'"))
        db.execute(sa.text("""
          INSERT INTO users(id,email,username,password_hash,system_role,
                            is_protected_system_admin,is_active,token_version,identity_version)
          VALUES (:id,'crm-admin@allergyevexia.in',NULL,:password,'super_admin',true,true,7,3)
        """), {"id": owner, "password": password})
        # A genuine historical alias, retained under the original owner.
        db.execute(sa.text("""
          INSERT INTO account_identifier_reservations(identifier,user_id)
          VALUES ('previous.alias',:id)
        """), {"id": owner})
        db.execute(sa.text("""
          INSERT INTO users(id,email,username,password_hash,system_role,
                            is_protected_system_admin,is_active,token_version,identity_version)
          VALUES (:id,'Ordinary.Person@EXAMPLE.COM','Ordinary.Person','unchanged-synthetic-hash',
                  'mr',false,true,2,1)
        """), {"id": ordinary})
        db.execute(sa.text("INSERT INTO mr_profiles(id,user_id,is_active) VALUES (:id,:owner,true)"),
                   {"id": uuid.uuid4(), "owner": ordinary})
    return owner, password


def snapshot(engine):
    with engine.connect() as db:
        return (
            db.execute(sa.text("SELECT * FROM users ORDER BY id")).all(),
            db.execute(sa.text("SELECT * FROM account_identifier_reservations ORDER BY identifier")).all(),
            db.scalar(sa.text("SELECT version_num FROM alembic_version")),
            {c["name"] for c in sa.inspect(db).get_columns("users")},
        )


def test_empty_install_has_ciphertext_schema_without_fake_evidence(legacy):
    engine, config = legacy
    command.upgrade(config, TARGET)
    with engine.connect() as db:
        assert db.scalar(sa.text("SELECT version_num FROM alembic_version")) == TARGET
        assert db.scalar(sa.text("SELECT count(*) FROM users")) == 0
        assert db.scalar(sa.text("SELECT count(*) FROM account_crypto_state")) == 1


def test_populated_install_refuses_missing_approval_without_any_changes(legacy):
    engine, config = legacy
    seed(engine)
    before = snapshot(engine)
    with pytest.raises(AccountCryptoError, match="approval/evidence"):
        command.upgrade(config, TARGET)
    assert snapshot(engine) == before


def test_verified_migration_preserves_owner_credentials_and_history(legacy):
    engine, config = legacy
    owner, password = seed(engine)
    before = snapshot(engine)
    with rehearsed_account_approval(engine) as arguments:
        config.cmd_opts = SimpleNamespace(x=arguments)
        command.upgrade(config, TARGET)
    with Session(engine) as db:
        user = db.scalar(sa.select(User).where(lookup(db, "CRM-ADMIN@ALLERGYEVEXIA.IN")))
        assert user.id == owner and user.password_hash == password
        assert user.token_version == 7 and user.identity_version == 3
        assert user.is_protected_system_admin and user.system_role == "super_admin"
        assert user.email == "crm-admin@allergyevexia.in" and user.username is None
        assert db.scalar(sa.text("SELECT email FROM users")).startswith("v1:")
        rows = db.execute(sa.text("SELECT * FROM account_identifier_reservations")).mappings().all()
        assert len(rows) == len(before[1]) == 4
        assert {crypto().decrypt(row["user_id"], row["field"], row["identifier"]) for row in rows} == {
            "previous.alias", "crm-admin@allergyevexia.in",
            "ordinary.person", "ordinary.person@example.com",
        }
        ordinary = db.scalar(sa.select(User).where(lookup(db, "ORDINARY.PERSON")))
        assert ordinary.email == "Ordinary.Person@EXAMPLE.COM" and ordinary.username == "Ordinary.Person"
        assert ordinary.password_hash == "unchanged-synthetic-hash"
        assert ordinary.token_version == 2 and ordinary.identity_version == 1
        with pytest.raises(sa.exc.IntegrityError):
            db.execute(sa.text("DELETE FROM users WHERE id=:id"), {"id": owner})
        db.rollback()


@pytest.mark.parametrize("flag", [
    "account_restoration_rehearsal", "account_writers_stopped", "account_backup_durable",
    "account_crypto_approved", "account_external_consumers_reviewed",
    "account_expected_database", "account_expected_system_identifier",
])
def test_each_gate_is_separate_and_failure_rolls_back(legacy, flag):
    engine, config = legacy
    seed(engine)
    before = snapshot(engine)
    with rehearsed_account_approval(engine) as arguments:
        config.cmd_opts = SimpleNamespace(x=[item for item in arguments if not item.startswith(flag + "=")])
        with pytest.raises(AccountCryptoError):
            command.upgrade(config, TARGET)
    assert snapshot(engine) == before


def test_digest_is_not_restoration_attestation(legacy):
    engine, config = legacy
    seed(engine)
    before = snapshot(engine)
    with rehearsed_account_approval(engine) as arguments:
        config.cmd_opts = SimpleNamespace(x=[
            item.replace("account_restoration_rehearsal=yes", "account_restoration_rehearsal=no")
            for item in arguments
        ])
        with pytest.raises(AccountCryptoError, match="account_restoration_rehearsal"):
            command.upgrade(config, TARGET)
    assert snapshot(engine) == before


def test_corrupt_backup_blocks_before_plaintext_retirement(legacy):
    engine, config = legacy
    seed(engine)
    before = snapshot(engine)
    with rehearsed_account_approval(engine) as arguments:
        config.cmd_opts = SimpleNamespace(x=[
            "account_backup_sha256=" + "0" * 64 if item.startswith("account_backup_sha256=") else item
            for item in arguments
        ])
        with pytest.raises(AccountCryptoError, match="integrity"):
            command.upgrade(config, TARGET)
    assert snapshot(engine) == before


def test_invalid_identifier_is_reported_not_repaired(legacy):
    engine, config = legacy
    owner = uuid.uuid4()
    with engine.begin() as db:
        db.execute(sa.text(
            "INSERT INTO users(id,email,password_hash,is_active,token_version,identity_version,is_protected_system_admin) "
            "VALUES (:id,'not-an-email','synthetic',true,0,0,false)"
        ), {"id": owner})
    before = snapshot(engine)
    with pytest.raises(AccountCryptoError, match="invalid_identifier") as error:
        command.upgrade(config, TARGET)
    assert str(owner) in str(error.value) and "not-an-email" not in str(error.value)
    assert snapshot(engine) == before


def test_persisted_verification_failure_rolls_back_shadows(legacy, monkeypatch):
    from app.services.account_crypto import AccountCrypto
    engine, config = legacy
    seed(engine)
    before = snapshot(engine)
    original = AccountCrypto.decrypt
    calls = 0
    def fail_persisted(self, owner, field, value):
        nonlocal calls
        calls += 1
        result = original(self, owner, field, value)
        if calls > 8:
            raise RuntimeError("synthetic persisted-copy verification failure")
        return result
    with rehearsed_account_approval(engine) as arguments:
        config.cmd_opts = SimpleNamespace(x=arguments)
        monkeypatch.setattr(AccountCrypto, "decrypt", fail_persisted)
        with pytest.raises(RuntimeError):
            command.upgrade(config, TARGET)
    assert snapshot(engine) == before


def test_downgrade_cannot_restore_plaintext_implicitly(legacy):
    engine, config = legacy
    command.upgrade(config, TARGET)
    before = snapshot(engine)
    with pytest.raises(RuntimeError, match="downgrade is refused"):
        command.downgrade(config, PREVIOUS)
    assert snapshot(engine) == before
