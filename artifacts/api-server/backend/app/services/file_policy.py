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


def staff_order_file(db, current, action, patient_id, kits_owner_id, lupin_owner_id,
                     file_id, lupin_reservation):
    """Staff file grants are order capabilities, never general Patient-file access."""
    from app.services.capability_policy import allowed
    from app.db.file_models import FileRecord
    from app.db.immunotherapy_models import ImmunotherapyAttachment
    from app.db.kits_models import KitsAttachment
    from app.db.lupin_models import LupinAttachment, LupinRequest
    links = (("immunotherapy", ImmunotherapyAttachment), ("kits", KitsAttachment), ("lupin", LupinAttachment))
    if action not in ("upload", "read", "download", "cancel_lupin_upload"):
        raise FileError(403, "access_denied", "Access denied")
    if file_id:
        row = db.get(FileRecord, file_id)
        if not row:
            raise FileError(404, "not_found", "Object unavailable")
        associated = [resource for resource, link in links
                      if db.scalar(select(link.file_id).where(link.file_id == file_id).limit(1))]
        if associated:
            if action in ("read", "download") and any(
                    allowed(current, resource, "read_attachment") for resource in associated):
                return current
            raise FileError(403, "access_denied", "Access denied")
        # Knowing a private UUID or having a Patient Master grant is not access.
        if row.uploader_id != current.user.id:
            raise FileError(404, "not_found", "Object unavailable")
    resource = "lupin" if lupin_owner_id else "kits" if kits_owner_id else "immunotherapy"
    needed = "read_attachment" if action in ("read", "download") else "upload_attachment"
    if not allowed(current, resource, needed):
        raise FileError(403, "access_denied", "Access denied")
    if lupin_owner_id:
        if lupin_owner_id != current.user.id:
            raise FileError(403, "access_denied", "Access denied")
        if file_id:
            retry = db.get(LupinRequest, file_id)
            if not retry or retry.actor_id != current.user.id:
                raise FileError(404, "not_found", "Object unavailable")
            from app.services.lupin import unseal
            from app.services.directory_runtime import crypto_scope
            with crypto_scope(db) as keys:
                saved = unseal(keys, "requests", file_id, retry.response_ciphertext)
            if (saved["request"].get("kind") != "lupin_upload"
                    or bool(saved["result"].get("cancelled")) != (action == "cancel_lupin_upload")):
                raise FileError(404, "not_found", "Object unavailable")
        elif action != "upload" or not lupin_reservation:
            raise FileError(403, "access_denied", "Access denied")
    elif kits_owner_id:
        if kits_owner_id != current.user.id or action == "cancel_lupin_upload":
            raise FileError(403, "access_denied", "Access denied")
    elif patient_id and action != "cancel_lupin_upload":
        # Own unattached drafts are still constrained to an eligible workflow
        # patient. Saved historical associations were handled independently above.
        from app.services.immunotherapy import eligible
        eligible(db, "patients", patient_id)
    else:
        raise FileError(403, "access_denied", "Access denied")
    return current


def authorize(db: Session, identity: Identity, action: str, patient_id, mr_id, *, lock=False, kits_owner_id=None, lupin_owner_id=None, file_id=None, lupin_reservation=False):
    if identity.staff is not None or (identity.role == "mr" and lupin_owner_id):
        # Same policy-before-identity lock order as order mutations.
        from app.services.zone_policy import lock_policy
        lock_policy(db)
    current = revalidate_identity(db, identity, lock=lock)
    if current.staff is not None:
        return staff_order_file(db, current, action, patient_id, kits_owner_id, lupin_owner_id,
                                file_id, lupin_reservation)
    admin_access = "admin.access" in current.permissions
    if lupin_owner_id:
        if current.role == "mr":
            from app.services.mr_orders import authorize as authorize_orders, check_retry_scope
            from app.db.lupin_models import LupinOrder, LupinAttachment, LupinRequest
            from app.db.file_models import FileRecord
            current = authorize_orders(db, current)
            if file_id and action in ("read", "download"):
                if db.scalar(select(LupinAttachment.file_id).join(
                        LupinOrder, LupinOrder.id == LupinAttachment.order_id).where(
                        LupinAttachment.file_id == file_id, LupinOrder.mr_id == current.mr.id).limit(1)):
                    return current
            if lupin_owner_id != current.user.id or action not in (*MR_FILE_ACTIONS, "cancel_lupin_upload"):
                raise FileError(403, "access_denied", "Access denied")
            if file_id:
                row = db.get(FileRecord, file_id)
                attached = db.scalar(select(LupinAttachment.file_id).where(LupinAttachment.file_id == file_id))
                if not row or row.uploader_id != current.user.id or attached:
                    raise FileError(404, "not_found", "Object unavailable")
                # Unattached uploads are recoverable only in their original MR
                # assignment. A cancellation is a dedicated tombstoned operation,
                # never generic MR delete/replace permission.
                retry = db.get(LupinRequest, file_id)
                if not retry or retry.actor_id != current.user.id:
                    raise FileError(404, "not_found", "Object unavailable")
                from app.services.lupin import unseal
                from app.services.directory_runtime import crypto_scope
                with crypto_scope(db) as keys:
                    saved = unseal(keys, "requests", file_id, retry.response_ciphertext)
                check_retry_scope(db, saved)
                if (saved["request"].get("kind") != "lupin_upload"
                        or (action == "cancel_lupin_upload" and not saved["result"].get("cancelled"))
                        or (action != "cancel_lupin_upload" and saved["result"].get("cancelled"))):
                    raise FileError(404, "not_found", "Object unavailable")
            elif action != "upload" or not lupin_reservation:
                # Only Lupin's digest-bound, actor-bound reservation may create
                # MR uploads; generic /files must not bypass its retry record.
                raise FileError(403, "access_denied", "Access denied")
            return current
        if (not admin_access or not current.user.is_protected_system_admin
                or current.role != "super_admin" or action not in (*ADMIN_FILE_ACTIONS, "cancel_lupin_upload")):
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