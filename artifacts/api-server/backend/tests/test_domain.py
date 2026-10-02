import uuid
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.models import AuditEvent, AuthSession, MRProfile, Patient, RefreshSession, User
from app.db.session import session_factory
from app.schemas.domain import DomainError
from app.services.auth import Identity
from app.services.domain import (
    assign_patient, create_patient, map_existing_user_to_mr, provision_mr,
)


@pytest.fixture
def domain_db():
    if get_settings().app_env == "production":
        pytest.fail("Domain tests refuse to connect with APP_ENV=production")
    connection = session_factory().kw["bind"].connect()
    outer = connection.begin()
    db = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield db
    finally:
        db.close()
        outer.rollback()
        connection.close()


def seed_identity(db, email, role):
    if role == "super_admin":
        from app.bootstrap import bootstrap_super_admin

        result = bootstrap_super_admin(db, SecretStr("correct horse battery staple"))
        user = db.get(User, result.user_id)
        session = AuthSession(user_id=user.id, token_version=user.token_version,
                              identity_version=user.identity_version,
                              expires_at=datetime.now(timezone.utc) + timedelta(hours=1))
        db.add(session)
        db.commit()
        return Identity(user, session_id=session.id)
    user = User(
        email=email, password_hash=hash_password("correct horse battery staple"),
        system_role=role, identity_version=1,
    )
    db.add(user)
    db.flush()
    mr = None
    if role == "mr":
        mr = MRProfile(user_id=user.id, is_active=True)
        db.add(mr)
        db.flush()
    session = AuthSession(user_id=user.id, token_version=user.token_version,
                          identity_version=user.identity_version,
                          expires_at=datetime.now(timezone.utc) + timedelta(hours=1))
    db.add(session)
    db.commit()
    return Identity(user, mr, session.id)


def test_superadmin_only_provisions_mrs_and_patient_assignment(domain_db):
    db = domain_db
    admin = seed_identity(db, "admin-domain@example.com", "super_admin")
    mr = provision_mr(db, admin, "new-mr@example.com", "new.mr", "correct horse battery staple")
    assert mr.user_id
    assert db.scalar(select(User).where(User.id == mr.user_id)).system_role == "mr"

    patient = create_patient(db, admin, mr.id)
    assert patient.assigned_mr_id == mr.id
    original_version = patient.version
    reassigned = assign_patient(db, admin, patient.id, None)
    assert reassigned.assigned_mr_id is None
    assert reassigned.version == original_version + 1
    assert db.scalar(select(AuditEvent).where(AuditEvent.action == "patient_assignment")) is not None


def test_non_superadmin_cannot_provision_or_assign(domain_db):
    db = domain_db
    mr = seed_identity(db, "mr-domain@example.com", "mr")
    with pytest.raises(DomainError) as error:
        create_patient(db, mr)
    assert error.value.status_code == 403
    with pytest.raises(DomainError) as error:
        provision_mr(db, mr, "second-mr@example.com", None, "correct horse battery staple")
    assert error.value.status_code == 403


def test_mr_provisioning_cannot_claim_reserved_system_identifier(domain_db):
    from app.bootstrap import SUPER_ADMIN_EMAIL

    actor = seed_identity(domain_db, "reserved-guard@example.test", "super_admin")
    with pytest.raises(DomainError) as error:
        provision_mr(domain_db, actor, SUPER_ADMIN_EMAIL, None, "correct horse battery staple")
    assert error.value.status_code == 409


def test_mapping_legacy_user_is_explicit_and_revokes_old_credentials(domain_db):
    db = domain_db
    admin = seed_identity(db, "admin-map@example.com", "super_admin")
    legacy_user = User(
        email="legacy-map@example.com", password_hash=hash_password("correct horse battery staple"),
        system_role=None, identity_version=0,
    )
    db.add(legacy_user)
    db.flush()
    expiry = datetime.now(timezone.utc) + timedelta(days=1)
    auth_session = AuthSession(
        user_id=legacy_user.id, identity_version=0, expires_at=expiry,
    )
    db.add(auth_session)
    db.flush()
    db.add(RefreshSession(
        token_hash="a" * 64, user_id=legacy_user.id, organization_id=None,
        identity_version=0, family_id=uuid.uuid4(), session_id=auth_session.id,
        family_expires_at=expiry,
        expires_at=expiry,
    ))
    db.commit()
    old_version = legacy_user.identity_version
    profile = map_existing_user_to_mr(db, admin, legacy_user.id)
    assert profile.user_id == legacy_user.id
    assert legacy_user.system_role == "mr"
    assert legacy_user.identity_version == old_version + 1
    assert db.scalar(select(RefreshSession).where(
        RefreshSession.user_id == legacy_user.id,
    )).revoked_at is not None


def test_assignment_rejects_inactive_or_unknown_mr(domain_db):
    db = domain_db
    admin = seed_identity(db, "admin-validation@example.com", "super_admin")
    patient = create_patient(db, admin)
    with pytest.raises(DomainError) as error:
        assign_patient(db, admin, patient.id, uuid.uuid4())
    assert error.value.status_code == 404
    assert db.get(Patient, patient.id).assigned_mr_id is None