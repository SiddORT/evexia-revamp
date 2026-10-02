"""Protected Super Admin bootstrap tests on an isolated PostgreSQL schema."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest
from alembic import command
from alembic.config import Config
from pydantic import SecretStr
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.bootstrap import (
    BootstrapConfigurationError, SUPER_ADMIN_EMAIL, bootstrap_super_admin,
)
from app.core.config import get_settings
from app.db.models import AuditEvent, User


@pytest.fixture
def protected_admin_db(monkeypatch):
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("requires isolated TEST_DATABASE_URL")
    url = make_url(database_url)
    if not url.drivername.startswith("postgresql") or "test" not in (url.database or "").lower():
        pytest.fail("TEST_DATABASE_URL must target an isolated PostgreSQL database whose name includes 'test'")
    schema = f"protected_admin_{uuid.uuid4().hex}"
    admin_engine = create_engine(url)
    with admin_engine.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    isolated_url = url.set(query={**url.query, "options": f"-csearch_path={schema}"})
    monkeypatch.setenv("DATABASE_URL", isolated_url.render_as_string(hide_password=False))
    get_settings.cache_clear()
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    engine = create_engine(isolated_url, pool_size=4, max_overflow=4)
    try:
        command.upgrade(config, "head")
        yield engine
    finally:
        engine.dispose()
        get_settings.cache_clear()
        with admin_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin_engine.dispose()


def test_bootstrap_idempotence_missing_secret_and_argon2(protected_admin_db):
    engine = protected_admin_db
    secret = SecretStr("synthetic-test-only-bootstrap-secret")
    with Session(engine, expire_on_commit=False) as db:
        with pytest.raises(BootstrapConfigurationError, match="SUPER_ADMIN_INITIAL_PASSWORD"):
            bootstrap_super_admin(db, None)
        assert db.scalar(select(User.id)) is None
        first = bootstrap_super_admin(db, secret)
        admin = db.get(User, first.user_id)
        assert first.created
        assert admin.email == SUPER_ADMIN_EMAIL
        assert admin.system_role == "super_admin"
        assert admin.is_protected_system_admin and admin.is_active
        assert admin.password_hash.startswith("$argon2id$")
        original = (admin.id, admin.password_hash, admin.is_active, admin.token_version, admin.identity_version)
        second = bootstrap_super_admin(db, None)
        assert not second.created
        assert second.user_id == first.user_id
        assert (admin.id, admin.password_hash, admin.is_active, admin.token_version, admin.identity_version) == original
        outcomes = list(db.scalars(select(AuditEvent.outcome).where(
            AuditEvent.action == "super_admin_bootstrap",
        )))
        assert sorted(outcomes) == ["created", "existing"]


def test_concurrent_bootstrap_is_singleton_and_preserves_password(protected_admin_db):
    engine = protected_admin_db
    gate = Barrier(2)

    def create():
        with Session(engine, expire_on_commit=False) as db:
            gate.wait(timeout=5)
            return bootstrap_super_admin(db, SecretStr("synthetic-concurrent-test-secret"))

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: create(), range(2)))
    assert sorted(result.created for result in outcomes) == [False, True]
    assert outcomes[0].user_id == outcomes[1].user_id
    with Session(engine) as db:
        assert db.scalar(select(User).where(User.is_protected_system_admin)).password_hash.startswith("$argon2id$")
        assert db.scalar(select(User.id).where(User.is_protected_system_admin)) == outcomes[0].user_id


@pytest.mark.parametrize(
    ("email", "username"),
    [
        (SUPER_ADMIN_EMAIL, None),
        ("CRM-Admin@allergyevexia.in", None),
        ("legacy@example.test", SUPER_ADMIN_EMAIL),
    ],
)
def test_reserved_identifier_conflict_is_not_elevated(protected_admin_db, email, username):
    with Session(protected_admin_db) as db:
        conflict = User(
            email=email, username=username, password_hash="synthetic-not-a-real-password-hash",
            is_active=True, token_version=0, identity_version=0,
        )
        db.add(conflict)
        db.commit()
        with pytest.raises(BootstrapConfigurationError, match="operator review"):
            bootstrap_super_admin(db, SecretStr("synthetic-test-only-bootstrap-secret"))
        db.refresh(conflict)
        assert not conflict.is_protected_system_admin
        assert conflict.system_role is None


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE users SET is_active=false WHERE is_protected_system_admin",
        "UPDATE users SET system_role='mr' WHERE is_protected_system_admin",
        "UPDATE users SET email='renamed@example.test' WHERE is_protected_system_admin",
        "UPDATE users SET username='another.login' WHERE is_protected_system_admin",
        "UPDATE users SET identity_version=identity_version + 1 WHERE is_protected_system_admin",
        "DELETE FROM users WHERE is_protected_system_admin",
    ],
)
def test_database_rejects_protected_identity_mutations(protected_admin_db, statement):
    with Session(protected_admin_db) as db:
        bootstrap_super_admin(db, SecretStr("synthetic-test-only-bootstrap-secret"))
        with pytest.raises(IntegrityError):
            db.execute(text(statement))
            db.commit()
        db.rollback()
        admin = db.scalar(select(User).where(User.is_protected_system_admin))
        assert admin.email == SUPER_ADMIN_EMAIL
        assert admin.system_role == "super_admin"
        assert admin.is_active


def test_database_denies_alternate_super_admin_creation(protected_admin_db):
    with Session(protected_admin_db) as db:
        with pytest.raises(IntegrityError):
            db.execute(text(
                "INSERT INTO users(email,password_hash,is_active,token_version,system_role,"
                "identity_version,is_protected_system_admin) "
                "VALUES(:email,'synthetic-hash',true,0,'super_admin',1,true)"
            ), {"email": SUPER_ADMIN_EMAIL})
            db.commit()
        db.rollback()
        assert db.scalar(select(User.id)) is None


def test_database_denies_promotion_of_existing_ordinary_identity(protected_admin_db):
    with Session(protected_admin_db) as db:
        ordinary = User(
            email="ordinary@example.test", password_hash="synthetic-hash",
            is_active=True, token_version=0, identity_version=0,
        )
        db.add(ordinary)
        db.commit()
        with pytest.raises(IntegrityError):
            db.execute(text(
                "UPDATE users SET system_role='super_admin', is_protected_system_admin=true, "
                "email=:reserved WHERE id=:id"
            ), {"reserved": SUPER_ADMIN_EMAIL, "id": ordinary.id})
            db.commit()
        db.rollback()
        db.refresh(ordinary)
        assert ordinary.email == "ordinary@example.test"
        assert ordinary.system_role is None
        assert not ordinary.is_protected_system_admin


def test_database_rejects_protected_identity_with_null_system_role(protected_admin_db):
    with Session(protected_admin_db) as db:
        db.execute(text("SELECT set_config('evexia.bootstrap_super_admin', 'on', true)"))
        with pytest.raises(IntegrityError):
            db.execute(text(
                "INSERT INTO users(email,password_hash,is_active,token_version,system_role,"
                "identity_version,is_protected_system_admin) "
                "VALUES(:email,'synthetic-hash',true,0,NULL,1,true)"
            ), {"email": SUPER_ADMIN_EMAIL})
            db.commit()
        db.rollback()
        assert db.scalar(select(User.id)) is None