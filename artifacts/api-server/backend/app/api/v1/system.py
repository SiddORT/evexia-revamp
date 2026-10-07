from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db

router = APIRouter(tags=["system"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/version")
def version():
    return {"api": "v1"}


@router.get("/health/readiness")
def readiness(db: Session = Depends(get_db)):
    try:
        # Deployment health must verify the identity schema, not just a live socket.
        db.execute(text(
            "SELECT username, system_role, identity_version, is_protected_system_admin FROM users LIMIT 0"
        ))
        for table in ("mr_profiles", "patients", "files", "download_grants",
                      "login_attempts", "audit_events"):
            db.execute(text(f"SELECT 1 FROM {table} LIMIT 0"))
        db.execute(text(
            "SELECT family_expires_at, persistent, session_id, consumed_at, replaced_by_id "
            "FROM refresh_sessions LIMIT 0"
        ))
        db.execute(text(
            "SELECT id, status, token_version, identity_version, expires_at "
            "FROM auth_sessions LIMIT 0"
        ))
        db.execute(text("SELECT session_id, reason FROM audit_events LIMIT 0"))
        db.execute(text("SELECT id, permissions, version FROM custom_roles LIMIT 0"))
        db.execute(text(
            "SELECT user_id, name_ciphertext, email_ciphertext, phone_ciphertext, "
            "email_index, version, custom_role_id, workspace_login_enabled FROM staff_profiles LIMIT 0"
        ))
        db.execute(text(
            "SELECT id, name, status, version, created_by, updated_by, "
            "created_at, updated_at, deleted_at, deleted_by FROM zones LIMIT 0"
        ))
        db.execute(text(
            "SELECT id, name, status, version, created_by, updated_by, "
            "created_at, updated_at, deleted_at, deleted_by FROM courier_partners LIMIT 0"
        ))
        db.execute(text(
            "SELECT id, name, address, status, version, created_by, updated_by, "
            "created_at, updated_at, deleted_at, deleted_by FROM storage_locations LIMIT 0"
        ))
        db.execute(text(
            'SELECT id, name, "shortName", level, status, "basicDa", hra, "medicalAllowance", '
            '"travellingAllowance", "specialAllowance", "professionalTax", version, created_by, updated_by, '
            'created_at, updated_at, deleted_at, deleted_by FROM designations LIMIT 0'
        ))
        db.execute(text(
            "SELECT id, name, state_code, status, version, created_by, updated_by, "
            "created_at, updated_at, deleted_at, deleted_by FROM headquarters LIMIT 0"
        ))
        db.execute(text('SELECT id, hq, "zoneId", "reportingManagerId", version, deleted_at FROM mr_directory LIMIT 0'))
        db.execute(text(
            'SELECT id, "mrId", "registrationNumber", "contactRequirement", "orderDiscount", '
            '"daysLimit", "paymentLimit", verification, version, created_by, updated_by FROM doctor_directory LIMIT 0'
        ))
        db.execute(text("SELECT identifier, user_id FROM account_identifier_reservations LIMIT 0"))
    except Exception:
        raise HTTPException(status_code=503, detail="Service unavailable") from None
    return {"status": "ready"}