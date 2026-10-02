import re
import uuid

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import hash_password, utcnow
from app.db.models import AuditEvent, MRProfile, Patient, RefreshSession, User
from app.schemas.domain import DomainError
from app.services.auth import AuthError, Identity, revalidate_identity


def _require_super_admin(db: Session, actor: Identity) -> Identity:
    try:
        current = revalidate_identity(db, actor, lock=True)
    except AuthError:
        raise DomainError("Access denied", 403) from None
    if current.role != "super_admin":
        raise DomainError("Access denied", 403)
    return current


def _audit(db: Session, actor: Identity, action: str, resource_type: str, resource_id: uuid.UUID) -> None:
    db.add(AuditEvent(
        action=action, outcome="success", actor_id=actor.user.id,
        resource_type=resource_type, resource_id=resource_id,
        request_id=db.info.get("request_id"),
    ))


def provision_mr(
    db: Session, actor: Identity, email: str, username: str | None, password: str,
) -> MRProfile:
    actor = _require_super_admin(db, actor)
    email = email.strip().lower()
    username = username.strip().lower() if username else None
    if username and not re.fullmatch(r"[a-z][a-z0-9._-]{2,31}", username):
        raise DomainError("Invalid username")
    if db.scalar(select(User.id).where(User.email == email)):
        raise DomainError("Account already exists", 409)
    try:
        user = User(
            email=email, username=username, password_hash=hash_password(password),
            system_role="mr", identity_version=1,
        )
        db.add(user)
        db.flush()
        profile = MRProfile(user_id=user.id, is_active=True)
        db.add(profile)
        db.flush()
        _audit(db, actor, "mr_provision", "mr", profile.id)
        db.commit()
        return profile
    except IntegrityError:
        db.rollback()
        raise DomainError("Account could not be provisioned", 409) from None


def map_existing_user_to_mr(db: Session, actor: Identity, user_id: uuid.UUID) -> MRProfile:
    """Explicitly map a legacy login to MR, revoking credentials from prior semantics."""
    actor = _require_super_admin(db, actor)
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if not user or not user.is_active:
        raise DomainError("User not found or inactive", 404)
    if user.system_role not in (None, "mr"):
        raise DomainError("User already has a different system role", 409)
    profile = db.scalar(select(MRProfile).where(MRProfile.user_id == user.id).with_for_update())
    if profile and profile.is_active and user.system_role == "mr":
        raise DomainError("User is already mapped as an MR", 409)
    if profile is None:
        profile = MRProfile(user_id=user.id, is_active=True)
        db.add(profile)
        db.flush()
    else:
        profile.is_active = True
    user.system_role = "mr"
    user.identity_version += 1
    user.token_version += 1
    db.execute(update(RefreshSession).where(
        RefreshSession.user_id == user.id, RefreshSession.revoked_at.is_(None),
    ).values(revoked_at=utcnow()))
    _audit(db, actor, "mr_mapping", "mr", profile.id)
    db.commit()
    return profile


def _lock_mrs(db: Session, mr_ids: set[uuid.UUID], *, require_active=True) -> list[MRProfile]:
    if not mr_ids:
        return []
    ordered = sorted(mr_ids, key=str)
    # Lock User rows first, then MR profiles, matching file-operation lock order.
    users = list(db.scalars(select(User).where(
        User.id.in_(select(MRProfile.user_id).where(MRProfile.id.in_(ordered)))
    ).order_by(User.id).with_for_update()))
    if len(users) != len(mr_ids):
        raise DomainError("MR profile not found", 404)
    profiles = list(db.scalars(select(MRProfile).where(
        MRProfile.id.in_(ordered),
    ).order_by(MRProfile.id).with_for_update()))
    if len(profiles) != len(mr_ids) or (require_active and any(not profile.is_active for profile in profiles)):
        raise DomainError("MR profile is inactive or unavailable", 409)
    if require_active and any(not user.is_active or user.system_role != "mr" for user in users):
        raise DomainError("MR profile is inactive or unavailable", 409)
    return profiles


def create_patient(db: Session, actor: Identity, assigned_mr_id: uuid.UUID | None = None) -> Patient:
    actor = _require_super_admin(db, actor)
    if assigned_mr_id is not None:
        _lock_mrs(db, {assigned_mr_id})
    patient = Patient(assigned_mr_id=assigned_mr_id, is_active=True, version=1)
    db.add(patient)
    db.flush()
    _audit(db, actor, "patient_create", "patient", patient.id)
    db.commit()
    return patient


def assign_patient(
    db: Session, actor: Identity, patient_id: uuid.UUID, assigned_mr_id: uuid.UUID | None,
) -> Patient:
    """Serialize reassignment on Patient after User -> MR locks; never change file keys."""
    actor = _require_super_admin(db, actor)
    snapshot = db.get(Patient, patient_id)
    if not snapshot:
        raise DomainError("Patient not found", 404)
    before = snapshot.assigned_mr_id
    lock_ids = {mr_id for mr_id in (before, assigned_mr_id) if mr_id is not None}
    profiles = _lock_mrs(db, lock_ids, require_active=False)
    if assigned_mr_id is not None:
        target = next(profile for profile in profiles if profile.id == assigned_mr_id)
        user = db.get(User, target.user_id)
        if not target.is_active or not user.is_active or user.system_role != "mr":
            raise DomainError("Assigned MR is inactive or unavailable", 409)
    patient = db.scalar(select(Patient).where(
        Patient.id == patient_id,
    ).execution_options(populate_existing=True).with_for_update())
    if not patient:
        raise DomainError("Patient not found", 404)
    if patient.assigned_mr_id != before:
        # A competing assignment won while we acquired owner locks; retry against fresh state.
        raise DomainError("Patient assignment changed concurrently; retry", 409)
    if not patient.is_active:
        raise DomainError("Patient is inactive", 409)
    if patient.assigned_mr_id != assigned_mr_id:
        patient.assigned_mr_id = assigned_mr_id
        patient.version += 1
        _audit(db, actor, "patient_assignment", "patient", patient.id)
    db.commit()
    return patient