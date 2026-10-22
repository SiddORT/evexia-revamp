"""Real PostgreSQL ciphertext, lookup and immutable-history verification."""
import uuid
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import User, MRProfile
from app.db.mr_models import AccountIdentifierReservation
from app.services import account_crypto as encrypted
from app.services import auth


@pytest.fixture
def db():
    engine = sa.create_engine(get_settings().database_url, hide_parameters=True)
    connection = engine.connect()
    outer = connection.begin()
    try:
        # Keep protected migration seeds intact; tests may commit their own
        # writes, but cannot commit past this disposable outer transaction.
        with Session(bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint") as session:
            yield session
    finally:
        outer.rollback()
        connection.close()
        engine.dispose()


def account(db, email="Case.Person@example.test", username="case.person", password="synthetic-password-123"):
    user = User(email=email, username=username, system_role="mr",
                password_hash=hash_password(password), is_active=True)
    db.add(user)
    db.flush()
    db.add(MRProfile(user_id=user.id, is_active=True))
    db.commit()
    return user


def test_staff_business_role_successor_preserves_account_boundary(db):
    db.execute(sa.text("UPDATE alembic_version SET version_num='0056_staff_business_roles'"))
    assert encrypted.ready(db).configuration() == encrypted.crypto().configuration()
    # Review of this exact successor never admits arbitrary future revisions.
    db.execute(sa.text("UPDATE alembic_version SET version_num='0057_unreviewed'"))
    with pytest.raises(encrypted.AccountCryptoError):
        encrypted.ready(db)


def test_staff_successor_retains_full_feature_readiness(db, monkeypatch):
    from fastapi import HTTPException
    from app.api.v1.system import readiness
    from app.services import email_templates
    from app.core.schema import SCHEMA_REVISION

    assert db.scalars(sa.text("SELECT version_num FROM alembic_version")).all() == [SCHEMA_REVISION]
    assert db.scalar(sa.text(
        "SELECT character_maximum_length FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name='staff_profiles' AND column_name='role'"
    )) == 100
    readiness(db)
    original = email_templates.resolve_event
    checked = []

    def unavailable_mr_template(session, event):
        checked.append(event)
        if event == "mr_invitation":
            raise RuntimeError("Synthetic unavailable MR invitation template")
        return original(session, event)

    monkeypatch.setattr(email_templates, "resolve_event", unavailable_mr_template)
    with pytest.raises(HTTPException) as error:
        readiness(db)
    assert error.value.status_code == 503
    assert checked == ["password_recovery", "account_invitation", "mr_invitation"]


def test_randomized_authenticated_ciphertext():
    current = encrypted.crypto()
    owner = uuid.uuid4()
    a = current.encrypt(owner, "email", "Alice@example.test")
    b = current.encrypt(owner, "email", "Alice@example.test")
    assert a != b and "Alice" not in a
    assert current.decrypt(owner, "email", a) == "Alice@example.test"
    for record, field, value in [(uuid.uuid4(), "email", a), (owner, "username", a),
                                  (owner, "email", a[:-3] + "bad")]:
        with pytest.raises(encrypted.AccountCryptoError):
            current.decrypt(record, field, value)
    with pytest.raises(encrypted.AccountCryptoError):
        encrypted.read(owner, "email", a, None)

@pytest.mark.parametrize("revision", [
    "0035_account_identifiers", "0036_reference_privacy", "0037_domain_admission",
    "0038_purchase_orders", "0039_communication", "0040_po_tax_basis",
    "0041_location_geography",
])
def test_explicit_reviewed_account_boundaries(db, revision):
    # Only the revision guard is exercised at predecessor boundaries. Actual
    # current-head migration/bootstrap is covered by the production harness.
    db.execute(sa.text("UPDATE alembic_version SET version_num=:revision"), {"revision": revision})
    assert encrypted.ready(db).configuration() == encrypted.crypto().configuration()


@pytest.mark.parametrize("revision", [
    "0035_account_identifiers", "0036_reference_privacy", "0037_domain_admission",
    "0038_purchase_orders", "0039_communication", "0040_po_tax_basis",
    "0041_location_geography",
])
def test_explicit_reviewed_account_boundaries(db, revision):
    # Only the revision guard is exercised at predecessor boundaries. Actual
    # current-head migration/bootstrap is covered by the production harness.
    db.execute(sa.text("UPDATE alembic_version SET version_num=:revision"), {"revision": revision})
    assert encrypted.ready(db).configuration() == encrypted.crypto().configuration()


@pytest.mark.parametrize("revisions", [
    [], ["0034_shared_phone_countries"], ["0042_unknown"], ["unreviewed"],
    ["0040_po_tax_basis", "0041_location_geography"],
    ["0041_location_geography", "0042_unknown"],
])
def test_unsupported_or_multiple_account_revisions_fail_closed(db, revisions):
    db.execute(sa.text("DELETE FROM alembic_version"))
    for revision in revisions:
        db.execute(sa.text("INSERT INTO alembic_version VALUES (:revision)"), {"revision": revision})
    with pytest.raises(encrypted.AccountCryptoError):
        encrypted.lookup(db, "synthetic@example.test")


@pytest.mark.parametrize("anchor", ["configuration_digest", "protected_email_index", "missing"])
def test_account_anchors_fail_closed(db, anchor):
    if anchor == "missing":
        db.execute(sa.text("DELETE FROM account_crypto_state"))
    else:
        assert anchor in ("configuration_digest", "protected_email_index")
        db.execute(sa.text(f"UPDATE account_crypto_state SET {anchor}=:invalid"),
                   {"invalid": "0" * 64})
    with pytest.raises(encrypted.AccountCryptoError):
        encrypted.ready(db)


@pytest.mark.parametrize("setting", ["directory_encryption_keys", "directory_encryption_key_id",
                                    "directory_index_key"])
def test_invalid_account_configuration_fails_closed(db, monkeypatch, setting):
    from pydantic import SecretStr
    value = "missing-key" if setting.endswith("_id") else SecretStr("invalid")
    settings = get_settings().model_copy(update={setting: value})
    monkeypatch.setattr(encrypted, "get_settings", lambda: settings)
    with pytest.raises(encrypted.AccountCryptoError):
        encrypted.ready(db)


@pytest.mark.parametrize("logger_name", ["sqlalchemy.engine", "sqlalchemy.engine.Engine"])
def test_account_readiness_rejects_sql_logging(db, logger_name, monkeypatch):
    import logging
    logger = logging.getLogger(logger_name)
    monkeypatch.setattr(logger, "disabled", False)
    previous = logger.level
    try:
        logger.setLevel(logging.INFO)
        with pytest.raises(encrypted.AccountCryptoError):
            encrypted.ready(db)
    finally:
        logger.setLevel(previous)


def test_account_readiness_rejects_engine_echo(db, monkeypatch):
    monkeypatch.setattr(db.get_bind().engine, "echo", True)
    with pytest.raises(encrypted.AccountCryptoError):
        encrypted.ready(db)


def test_users_and_history_have_no_plaintext_copies(db):
    user = account(db)
    row = db.execute(sa.text("SELECT * FROM users WHERE id=:id"), {"id": user.id}).mappings().one()
    assert row["email"].startswith("v1:") and row["username"].startswith("v1:")
    assert user.email == "Case.Person@example.test" and user.username == "case.person"
    assert encrypted.read(user.id, "email", row["email"], row["email_index"]) == user.email
    assert row["email_index"] == encrypted.index(db, user.email.lower())
    assert db.scalar(sa.select(User.id).where(encrypted.lookup(db, "CASE.PERSON"))) == user.id
    assert db.scalar(sa.select(User.id).where(encrypted.lookup(db, user.email.lower()))) == user.id
    history = db.execute(sa.text("SELECT * FROM account_identifier_reservations")).mappings().all()
    assert len(history) == 2
    assert all(item["identifier"].startswith("v1:") for item in history)
    assert {record.identifier for record in db.scalars(sa.select(AccountIdentifierReservation))} == {
        user.email, user.username,
    }
    assert not any(name.endswith(("_plaintext", "_encrypted"))
                   for name in sa.inspect(db.get_bind()).get_columns("users") for name in [name["name"]])


@pytest.mark.parametrize("email,username", [
    ("CASE.PERSON@example.test", "different"),
    ("different@example.test", "CASE.PERSON"),
    ("case.person", "different"),
    ("different@example.test", "case.person@example.test"),
])
def test_normalized_cross_column_uniqueness(db, email, username):
    account(db)
    with pytest.raises(IntegrityError):
        account(db, email, username)
    db.rollback()


def test_identifier_edits_preserve_historical_reservations(db):
    user = account(db)
    user.username = "changed.person"
    db.commit()
    assert db.scalar(sa.select(User.id).where(encrypted.lookup(db, "case.person"))) is None
    assert db.scalar(sa.select(User.id).where(encrypted.lookup(db, "changed.person"))) == user.id
    with pytest.raises(IntegrityError):
        account(db, "other@example.test", "case.person")
    db.rollback()
    assert db.get(AccountIdentifierReservation, encrypted.index(db, "case.person")).user_id == user.id


def test_email_and_username_login_keep_password_and_refresh_behavior(db):
    user = account(db)
    stored_hash = user.password_hash
    settings = get_settings()
    for identifier in ("CASE.PERSON", "CASE.PERSON@EXAMPLE.TEST"):
        identity, refresh = auth.login(db, identifier, "synthetic-password-123", settings,
                                      False, "synthetic-request", "127.0.0.1")
        assert identity.user.id == user.id
        renewed, replacement = auth.rotate_refresh(db, refresh, settings, "synthetic-renewal")
        assert renewed.user.id == user.id and replacement != refresh
    assert db.get(User, user.id).password_hash == stored_hash


def test_wrong_index_key_and_bad_ciphertext_fail_closed(db, monkeypatch):
    user = account(db)
    monkeypatch.setenv("DIRECTORY_INDEX_KEY", "RkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkY=")
    get_settings.cache_clear()
    with pytest.raises(encrypted.AccountCryptoError):
        encrypted.lookup(db, user.username)
    get_settings.cache_clear()


def test_no_raw_user_identifier_predicate_in_login(db):
    account(db)
    statements = []
    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    sa.event.listen(db.get_bind(), "before_cursor_execute", capture)
    try:
        auth.login(db, "case.person", "synthetic-password-123", get_settings(),
                   False, "synthetic-request", "127.0.0.1")
    finally:
        sa.event.remove(db.get_bind(), "before_cursor_execute", capture)
    assert any("users.email_index" in statement and "users.username_index" in statement for statement in statements)
    assert not any("lower(users.email)" in statement or "lower(users.username)" in statement for statement in statements)


def test_bulk_plaintext_writes_are_rejected_not_silently_discarded(db):
    with pytest.raises(encrypted.AccountCryptoError, match="Bulk plaintext"):
        db.execute(sa.insert(User), [{
            "id": uuid.uuid4(), "email": "bulk@example.test", "username": "bulk.person",
            "password_hash": "inert", "is_active": True,
        }])
    db.rollback()
    assert db.scalar(sa.select(sa.func.count(User.id))) == 0

@pytest.mark.parametrize("revisions", [
    [], ["0034_shared_phone_countries"], ["0042_unknown"], ["unreviewed"],
    ["0040_po_tax_basis", "0041_location_geography"],
    ["0041_location_geography", "0042_unknown"],
])
def test_unsupported_or_multiple_account_revisions_fail_closed(db, revisions):
    db.execute(sa.text("DELETE FROM alembic_version"))
    for revision in revisions:
        db.execute(sa.text("INSERT INTO alembic_version VALUES (:revision)"), {"revision": revision})
    with pytest.raises(encrypted.AccountCryptoError):
        encrypted.lookup(db, "synthetic@example.test")

@pytest.mark.parametrize("anchor", ["configuration_digest", "protected_email_index", "missing"])
def test_account_anchors_fail_closed(db, anchor):
    if anchor == "missing":
        db.execute(sa.text("DELETE FROM account_crypto_state"))
    else:
        assert anchor in ("configuration_digest", "protected_email_index")
        db.execute(sa.text(f"UPDATE account_crypto_state SET {anchor}=:invalid"),
                   {"invalid": "0" * 64})
    with pytest.raises(encrypted.AccountCryptoError):
        encrypted.ready(db)

@pytest.mark.parametrize("logger_name", ["sqlalchemy.engine", "sqlalchemy.engine.Engine"])
def test_account_readiness_rejects_sql_logging(db, logger_name, monkeypatch):
    import logging
    logger = logging.getLogger(logger_name)
    monkeypatch.setattr(logger, "disabled", False)
    previous = logger.level
    try:
        logger.setLevel(logging.INFO)
        with pytest.raises(encrypted.AccountCryptoError):
            encrypted.ready(db)
    finally:
        logger.setLevel(previous)

@pytest.mark.parametrize("setting", ["directory_encryption_keys", "directory_encryption_key_id",
                                    "directory_index_key"])
def test_invalid_account_configuration_fails_closed(db, monkeypatch, setting):
    from pydantic import SecretStr
    value = "missing-key" if setting.endswith("_id") else SecretStr("invalid")
    settings = get_settings().model_copy(update={setting: value})
    monkeypatch.setattr(encrypted, "get_settings", lambda: settings)
    with pytest.raises(encrypted.AccountCryptoError):
        encrypted.ready(db)

def test_account_readiness_rejects_engine_echo(db, monkeypatch):
    monkeypatch.setattr(db.get_bind().engine, "echo", True)
    with pytest.raises(encrypted.AccountCryptoError):
        encrypted.ready(db)
