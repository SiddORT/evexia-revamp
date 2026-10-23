"""Explicit permissions independent of role labels and storage identifiers."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import MRProfile, Patient
from app.services.auth import Identity, revalidate_identity

ADMIN_FILE_ACTIONS = frozenset({"upload", "read", "download", "delete", "replace", "recover"})
MR_FILE_ACTIONS = frozenset({"upload", "read", "download"})


class FileError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message
        super().__init__(message)


def authorize(db: Session, identity: Identity, action: str, patient_id, mr_id, *, lock=False, kits_owner_id=None, lupin_owner_id=None, file_id=None):
    current = revalidate_identity(db, identity, lock=lock)
    admin_access = "admin.access" in current.permissions
    # Lupin is not an MR workflow. Check this before any saved-order MR access.
    if lupin_owner_id:
        if (not admin_access or not current.user.is_protected_system_admin
                or current.role != "super_admin" or action not in ADMIN_FILE_ACTIONS):
            raise FileError(403, "access_denied", "Access denied")
        if action in ("upload", "replace") and lupin_owner_id != current.user.id:
            raise FileError(403, "access_denied", "Access denied")
        return current
    if current.role == "mr" and file_id and (patient_id or kits_owner_id) and action in ("read", "download"):
        # File UUID alone grants nothing. Saved order ownership is authoritative,
        # including historical Admin uploads after master ownership changes.
        from app.services.mr_orders import authorize as authorize_orders
        from app.db.kits_models import KitsOrder, KitsAttachment
        from app.db.immunotherapy_models import ImmunotherapyOrder, ImmunotherapyAttachment
        current = authorize_orders(db, current)
        for order, link in ((KitsOrder, KitsAttachment), (ImmunotherapyOrder, ImmunotherapyAttachment)):
            if db.scalar(select(link.file_id).join(order, order.id == link.order_id).where(
                    link.file_id == file_id, order.mr_id == current.mr.id).limit(1)):
                return current
        from app.db.file_models import FileRecord
        uploader = db.scalar(select(FileRecord.uploader_id).where(FileRecord.id == file_id))
        if uploader != current.user.id:
            raise FileError(404, "not_found", "Object unavailable")
        # Own unattached uploads may be inspected while recovering a draft.
        # Once attached elsewhere, uploader identity is not continuing access.
        for link in (KitsAttachment, ImmunotherapyAttachment):
            if db.scalar(select(link.file_id).where(link.file_id == file_id).limit(1)):
                raise FileError(404, "not_found", "Object unavailable")
    if kits_owner_id:
        if current.role == "mr" and action in MR_FILE_ACTIONS and kits_owner_id == current.user.id:
            from app.services.mr_orders import authorize as authorize_orders
            return authorize_orders(db, current)
        if not admin_access or current.user.system_role != "super_admin" or action not in ADMIN_FILE_ACTIONS:
            raise FileError(403, "access_denied", "Access denied")
        if action in ("upload", "replace") and kits_owner_id != current.user.id:
            raise FileError(403, "access_denied", "Access denied")
        return current
    if admin_access:
        allowed_actions = ADMIN_FILE_ACTIONS
    elif current.user.system_role == "mr":
        allowed_actions = MR_FILE_ACTIONS
    else:
        allowed_actions = ()
    if action not in allowed_actions:
        raise FileError(403, "access_denied", "Access denied")
    model, owner_id = (Patient, patient_id) if patient_id else (MRProfile, mr_id)
    query = select(model).where(model.id == owner_id).execution_options(populate_existing=True)
    if lock:
        query = query.with_for_update()
    owner = db.scalar(query)
    if not owner or (not owner.is_active and not admin_access):
        raise FileError(404, "not_found", "Object unavailable")
    if current.user.system_role == "mr":
        profile = current.mr
        if not profile or not profile.is_active:
            raise FileError(403, "access_denied", "Access denied")
        allowed = owner.assigned_mr_id == profile.id if patient_id else owner.id == profile.id
        if not allowed:
            raise FileError(404, "not_found", "Object unavailable")
        if patient_id and action == "upload":
            from app.services.mr_orders import authorize as authorize_orders
            from app.services.immunotherapy import eligible
            authorize_orders(db, current)
            eligible(db, "patients", patient_id)
    return current