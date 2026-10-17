from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.development_identity import LOADED_IDENTITY

router = APIRouter(tags=["system"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/version")
def version():
    # Captured when this process loaded, never relabelled from mutable Git/files.
    return {"api": "v1", "release": LOADED_IDENTITY}


@router.get("/health/readiness")
def readiness(db: Session = Depends(get_db)):
    try:
        # Deployment health must verify the identity schema, not just a live socket.
        # Reject predecessor releases even where obsolete nullable fields would
        # let a subset of requests appear to work during an unsafe mixed rollout.
        from app.core.schema import SCHEMA_REVISION
        revisions = db.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
        # The rate normalization is separately operator-activated, never an
        # automatic upgrade target. It alters no identity/directory contracts.
        # Do not carry this predecessor exception into an unrelated future pin.
        accepted = [[SCHEMA_REVISION]]
        if SCHEMA_REVISION == "0041_location_geography":
            accepted.append(["0042_rate_hundredths"])
        if revisions not in accepted:
            raise RuntimeError("Coordinated schema release required")
        from app.services.directory_runtime import ready
        ready(db)
        from app.services.account_crypto import ready as accounts_ready
        accounts_ready(db)
        from app.core.config import get_settings
        from app.services.communication_crypto import CommunicationCrypto
        CommunicationCrypto(get_settings())
        db.execute(text("SELECT channel, version FROM communication_channels LIMIT 0"))
        db.execute(text("SELECT id, channel, type, version, is_default, payload_ciphertext, secret_ciphertext, created_by, updated_by FROM communication_configurations LIMIT 0"))
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
        db.execute(text("SELECT hostname, kind, version, active, challenge, verification_expires_at FROM domain_policies LIMIT 0"))
        db.execute(text("SELECT id, permissions, version, created_by, updated_by, deleted_at, deleted_by FROM custom_roles LIMIT 0"))
        db.execute(text(
            "SELECT user_id, name_ciphertext, email_ciphertext, phone_ciphertext, "
            "email_index, version, custom_role_id, workspace_login_enabled, designation_id, "
            "deleted_at, deleted_by FROM staff_profiles LIMIT 0"
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
            "SELECT id, name, address, pincode, country_code, state, city, status, version, created_by, updated_by, "
            "created_at, updated_at, deleted_at, deleted_by FROM storage_locations LIMIT 0"
        ))
        db.execute(text(
            'SELECT id, name, "shortName", status, version, created_by, updated_by, '
            'created_at, updated_at, deleted_at, deleted_by FROM designations LIMIT 0'
        ))
        db.execute(text(
            "SELECT id, name, state_code, status, version, created_by, updated_by, "
            "created_at, updated_at, deleted_at, deleted_by FROM headquarters LIMIT 0"
        ))
        db.execute(text('SELECT id, hq, "zoneId", designation_id, "reportingManagerId", "dialCountry_ciphertext", version, deleted_at FROM mr_directory LIMIT 0'))
        db.execute(text(
            'SELECT id, "mrId", "registrationNumber", "contactRequirement", "orderDiscount", '
            '"daysLimit", "paymentLimit", verification, version, created_by, updated_by, deleted_at, deleted_by FROM doctor_directory LIMIT 0'
        ))
        db.execute(text("SELECT identifier, user_id FROM account_identifier_reservations LIMIT 0"))
        db.execute(text(
            'SELECT id, "mrId", "startYear", "endYear", q1, q2, q3, q4, annual_target, status, version, '
            'created_by, updated_by, deleted_at, deleted_by FROM sales_targets LIMIT 0'
        ))
        db.execute(text(
            'SELECT id, code, name_ciphertext, gender_ciphertext, phone_ciphertext, "dialCountry_ciphertext", '
            'email_ciphertext, "dateOfBirth_ciphertext", "doctorId", "instructionsLanguage_ciphertext", '
            'duplicate_identity_index, status, created_by, updated_by, created_at, updated_at, '
            'deleted_at, deleted_by FROM patient_directory LIMIT 0'
        ))
    except Exception:
        raise HTTPException(status_code=503, detail="Service unavailable") from None
    return {"status": "ready"}
