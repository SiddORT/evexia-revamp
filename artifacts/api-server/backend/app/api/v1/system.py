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
        if SCHEMA_REVISION == "0043_email_templates":
            # PR is an explicit additive successor, not an automatic migration
            # target or authorization to activate it on a managed database.
            accepted.append(["0044_purchase_received"])
        if SCHEMA_REVISION == "0044_purchase_received":
            # Explicit additive batch successor, never automatic activation.
            accepted.append(["0045_pr_batch_numbers"])
        if revisions not in accepted:
            raise RuntimeError("Coordinated schema release required")
        from app.services.directory_runtime import ready
        ready(db)
        from app.services.account_crypto import ready as accounts_ready
        accounts_ready(db)
        from app.core.config import get_settings
        from app.services.communication_crypto import CommunicationCrypto
        CommunicationCrypto(get_settings())
        if revisions in (["0044_purchase_received"], ["0045_pr_batch_numbers"], ["0046_live_inventory"], ["0047_languages"], ["0048_language_unicode"], ["0047_stock_products"], ["0049_product_language_merge"], ["0050_opening_stock"], ["0051_headquarter_areas"], ["0051_mr_zones"], ["0052_hq_mr_zones_merge"], ["0053_email_invitations"], ["0054_modern_email_tests"]):
            from app.services.purchase_received_crypto import ReceiptCrypto
            ReceiptCrypto(get_settings())
            db.execute(text("SELECT payload_ciphertext FROM purchase_receipts LIMIT 0"))
        if revisions in (["0045_pr_batch_numbers"], ["0046_live_inventory"], ["0047_languages"], ["0048_language_unicode"], ["0047_stock_products"], ["0049_product_language_merge"], ["0050_opening_stock"], ["0051_headquarter_areas"], ["0051_mr_zones"], ["0052_hq_mr_zones_merge"], ["0053_email_invitations"], ["0054_modern_email_tests"]):
            from app.services.pr_batches import settings_row, policy_data
            # Presence alone cannot establish readiness: verify the explicit
            # initial marker or a readable, valid saved policy without writing,
            # allocating numbers or issuing a policy token. Inventory retains
            # this feature and must validate it at its successor revision.
            policy_data(settings_row(db), ReceiptCrypto(get_settings()))
            db.execute(text("SELECT scope, value FROM pr_batch_counters LIMIT 0"))
            db.execute(text("SELECT key, actor_id, payload_ciphertext FROM pr_batch_allocations LIMIT 0"))
        if revisions in (["0046_live_inventory"], ["0047_languages"], ["0048_language_unicode"], ["0047_stock_products"], ["0049_product_language_merge"], ["0050_opening_stock"], ["0051_headquarter_areas"], ["0051_mr_zones"], ["0052_hq_mr_zones_merge"], ["0053_email_invitations"], ["0054_modern_email_tests"]):
            db.execute(text("SELECT id, receipt_id, line_id, product_id, origin_id, accepted, payload_ciphertext FROM inventory_lots LIMIT 0"))
            db.execute(text("SELECT lot_id, location_id, quantity FROM inventory_balances LIMIT 0"))
            db.execute(text("SELECT receipt_id, version, initialized_at FROM inventory_receipt_states LIMIT 0"))
            db.execute(text("SELECT id, source_id, destination_id, actor_id, event_id, created_at, payload_ciphertext FROM inventory_movements LIMIT 0"))
            db.execute(text("SELECT id, source_key, lot_id, location_id, movement_id, actor_id, created_at, delta, before, after FROM inventory_postings LIMIT 0"))
            db.execute(text("SELECT key, actor_id, digest, payload_ciphertext FROM inventory_requests LIMIT 0"))
        db.execute(text("SELECT channel, version FROM communication_channels LIMIT 0"))
        if revisions in (["0047_stock_products"], ["0049_product_language_merge"], ["0050_opening_stock"], ["0051_headquarter_areas"], ["0051_mr_zones"], ["0052_hq_mr_zones_merge"], ["0053_email_invitations"], ["0054_modern_email_tests"]):
            db.execute(text("SELECT id, payload_ciphertext, name_key, status, version, deleted_at FROM combo_products LIMIT 0"))
            db.execute(text("SELECT id, product_id, version, event_id, actor_id, created_at, payload_ciphertext FROM combo_product_revisions LIMIT 0"))
            db.execute(text("SELECT revision_id, allergen_id, quantity FROM combo_product_members LIMIT 0"))
            db.execute(text("SELECT id, product_id, revision_id, location_id, quantity, event_id, actor_id, created_at, payload_ciphertext FROM product_assemblies LIMIT 0"))
            db.execute(text("SELECT key, actor_id, digest, payload_ciphertext FROM product_requests LIMIT 0"))
            db.execute(text("SELECT combo_id, assembly_id FROM inventory_lots LIMIT 0"))
        if revisions in (["0047_languages"], ["0048_language_unicode"], ["0049_product_language_merge"], ["0050_opening_stock"], ["0051_headquarter_areas"], ["0051_mr_zones"], ["0052_hq_mr_zones_merge"], ["0053_email_invitations"], ["0054_modern_email_tests"]):
            db.execute(text("SELECT id, name, version, created_by, updated_by, created_at, updated_at, deleted_at, deleted_by FROM languages LIMIT 0"))
        if revisions in (["0050_opening_stock"], ["0051_headquarter_areas"], ["0051_mr_zones"], ["0052_hq_mr_zones_merge"], ["0053_email_invitations"], ["0054_modern_email_tests"]):
            db.execute(text("SELECT id, source_id, row_id, actor_id, event_id, created_at, payload_ciphertext FROM opening_stock LIMIT 0"))
            db.execute(text("SELECT key, actor_id, digest, payload_ciphertext FROM opening_stock_requests LIMIT 0"))
            db.execute(text("SELECT opening_id FROM inventory_lots LIMIT 0"))
            db.execute(text("SELECT id FROM inventory_balances LIMIT 0"))
            db.execute(text("SELECT id, language_id, version, action, actor_id, at, before_name, after_name, event_id FROM language_changes LIMIT 0"))
        # Keep the incoming MR-specific readiness probe at the reconciled head.
        if revisions in (["0051_mr_zones"], ["0052_hq_mr_zones_merge"], ["0053_email_invitations"], ["0054_modern_email_tests"]):
            db.execute(text("SELECT mr_id, zone_id, position, zone_name FROM mr_zone_assignments LIMIT 0"))
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
        if revisions in (["0053_email_invitations"], ["0054_modern_email_tests"]):
            from app.services.email_delivery import MailCrypto
            MailCrypto(get_settings())
            db.execute(text("SELECT password_setup_required FROM users LIMIT 0"))
            db.execute(text("SELECT recipient_ciphertext, recipient_index, status, template_version FROM email_attempts LIMIT 0"))
            from app.services.email_templates import resolve_event
            resolve_event(db, "password_recovery")
            resolve_event(db, "account_invitation")
            if revisions == ["0054_modern_email_tests"]:
                resolve_event(db, "mr_invitation")
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
