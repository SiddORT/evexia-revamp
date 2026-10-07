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
        db.execute(text(
            "SELECT user_id, name_ciphertext, email_ciphertext, phone_ciphertext, "
            "email_index, version FROM staff_profiles LIMIT 0"
        ))
        db.execute(text(
            "SELECT id, name, status, version, created_by, updated_by, "
            "created_at, updated_at, deleted_at, deleted_by FROM zones LIMIT 0"
        ))
        db.execute(text(
            "SELECT id, name, status, version, created_by, updated_by, "
            "created_at, updated_at, deleted_at, deleted_by FROM courier_partners LIMIT 0"
        ))
    except Exception:
        raise HTTPException(status_code=503, detail="Service unavailable") from None
    return {"status": "ready"}