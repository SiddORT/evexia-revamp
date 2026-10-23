"""Authorization shared by the four explicitly live MR order workflows."""
from sqlalchemy import select
from app.db.models import Patient
from app.db.mr_models import MRDirectory
from app.db.doctor_models import DoctorDirectory
from app.db.patient_models import PatientDirectory
from app.services.auth import revalidate_identity


def authorize(db, actor):
    from app.services.immunotherapy import ImmError
    # Match MR Doctor/master lock order: policy before identity/profile/graph.
    # This branch only acquires a lock; revalidation below grants the access.
    if actor.role == "mr":
        from app.services.zone_policy import lock_policy
        lock_policy(db)
    current = revalidate_identity(db, actor, lock=True)
    db.info["order_mr_id"] = None
    if current.role == "mr":
        from app.services import mrs, doctors
        from app.services.directory_runtime import ready
        ready(db)
        mrs.graph_lock(db)
        if not current.mr or not current.mr.is_active:
            raise ImmError("Your saved MR identity is unavailable.", 403, "mr_order_identity")
        doctors.assignment(db, current.mr.id)
        db.info["order_mr_id"] = current.mr.id
    elif not (current.user.is_protected_system_admin and current.role == "super_admin"
              and "admin.access" in current.permissions):
        raise ImmError("Access denied.", 403, "access_denied")
    return current


def scope_identity(db):
    # Helpers cannot silently default to Admin before workflow authorization.
    if "order_mr_id" not in db.info:
        from app.services.immunotherapy import ImmError
        raise ImmError("Order authorization is required.", 403, "access_denied")
    return db.info["order_mr_id"]


def scope(db, model):
    identity = scope_identity(db)
    return [model.mr_id == identity] if identity else []


def require_assignment(db, mr_id):
    """Even incomplete drafts must retain the authenticated MR identity."""
    identity = scope_identity(db)
    if identity and mr_id != identity:
        from app.services.immunotherapy import ImmError
        raise ImmError("Order MR must be your authenticated saved MR identity.", 422, "mr_order_assignment")


def retry_scope(db):
    identity = scope_identity(db)
    return str(identity) if identity else None


def check_retry_scope(db, saved):
    # Account identity alone is not sufficient if its MR assignment changed.
    identity = retry_scope(db)
    if identity and saved.get("mrScope") != identity:
        from app.services.immunotherapy import ImmError
        raise ImmError("Submission is unavailable for your current MR assignment.", 409, "mr_order_retry")


def reference_scope(db, kind):
    identity = scope_identity(db)
    if not identity or kind == "allergens":
        return []
    if kind == "mrs":
        return [MRDirectory.id == identity]
    doctors = select(DoctorDirectory.id).where(
        DoctorDirectory.mrId == identity, DoctorDirectory.deleted_at.is_(None),
        DoctorDirectory.status == "active")
    if kind == "doctors":
        return [DoctorDirectory.id.in_(doctors)]
    return [PatientDirectory.doctorId.in_(doctors), PatientDirectory.id.in_(
        select(Patient.id).where(Patient.assigned_mr_id == identity, Patient.is_active.is_(True)))]


def assignment(db, body, previous=None):
    from app.services.immunotherapy import ImmError, eligible
    identity = scope_identity(db)
    if not identity:
        return
    if body.mrId != identity:
        raise ImmError("Order MR must be your authenticated saved MR identity.", 422, "mr_order_assignment")
    # Historical unchanged snapshots remain readable/editable; changing any
    # relationship requires a currently eligible associated Doctor/Patient.
    changed = not previous or any(
        previous.get(field) != (str(getattr(body, field)) if getattr(body, field) else None)
        for field in ("doctorId", "patientId", "mrId"))
    if changed:
        eligible(db, "doctors", body.doctorId)
        if body.patientId:
            eligible(db, "patients", body.patientId)
    if previous and set(map(str, body.attachmentIds)) != {f["id"] for f in previous["attachments"]}:
        # Retain Admin-uploaded attachments; MR editing is not permission to
        # remove or replace saved files. Additional own uploads are allowed.
        if not {f["id"] for f in previous["attachments"]}.issubset(set(map(str, body.attachmentIds))):
            raise ImmError("Saved attachments must be retained.", 403, "mr_order_attachment")
