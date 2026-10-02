"""Explicit permissions independent of role labels and storage identifiers."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import MRProfile, Patient
from app.services.auth import Identity, revalidate_identity

PERMISSIONS = {
    "super_admin": frozenset({"upload", "read", "download", "delete", "replace", "recover"}),
    "mr": frozenset({"upload", "read", "download"}),
}


class FileError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message
        super().__init__(message)


def authorize(db: Session, identity: Identity, action: str, patient_id, mr_id, *, lock=False):
    current = revalidate_identity(db, identity, lock=lock)
    if action not in PERMISSIONS.get(current.user.system_role, ()):
        raise FileError(403, "access_denied", "Access denied")
    model, owner_id = (Patient, patient_id) if patient_id else (MRProfile, mr_id)
    query = select(model).where(model.id == owner_id).execution_options(populate_existing=True)
    if lock:
        query = query.with_for_update()
    owner = db.scalar(query)
    if not owner or (not owner.is_active and current.user.system_role != "super_admin"):
        raise FileError(404, "not_found", "Object unavailable")
    if current.user.system_role == "mr":
        profile = current.mr
        if not profile or not profile.is_active:
            raise FileError(403, "access_denied", "Access denied")
        allowed = owner.assigned_mr_id == profile.id if patient_id else owner.id == profile.id
        if not allowed:
            raise FileError(404, "not_found", "Object unavailable")
    return current