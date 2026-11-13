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
        # Reviewed Staff successors retain every predecessor capability.
        # Catalogue-only successor inherits every predecessor readiness probe.
        # Shipment status CHECK expansion retains all numbering and predecessor
        # probes; accepting this exact successor must not skip capability checks.
        if revisions == ["0102_category_count_tariffs"]:
            from app.services.category_count_tariffs import ready as tariff_ready
            tariff_ready(db)
            revisions = ["0100_applicable_gst"]
        if revisions == ["0100_applicable_gst"]:
            from app.services.gst_settings import ready as gst_ready
            gst_ready(db)
            revisions = ["0098_opening_corrections"]
        if revisions == ["0098_opening_corrections"]:
            # Opening-only ancestry deliberately excludes the staged low-stock
            # and designation branches. Retain every 0096 predecessor probe.
            db.execute(text("SELECT id,opening_id,version,actor_id,event_id,created_at,payload_ciphertext FROM opening_stock_revisions LIMIT 0"))
            db.execute(text("SELECT opening_revision FROM inventory_lots LIMIT 0"))
            if not db.scalar(text("""
                SELECT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conrelid='inventory_lots'::regclass
                      AND conname='uq_inventory_opening_revision'
                      AND contype='u'
                      AND ARRAY(
                          SELECT a.attname::text FROM unnest(conkey) WITH ORDINALITY k(attnum,position)
                          JOIN pg_attribute a ON a.attrelid=conrelid AND a.attnum=k.attnum
                          ORDER BY k.position
                      ) = ARRAY['opening_id','opening_revision']
                )
            """)):
                raise RuntimeError("Opening revision lot uniqueness required")
            for name, trigger_type in (("opening_stock_revisions_immutable", 27),
                                       ("opening_stock_revisions_no_truncate", 34)):
                if not db.scalar(text("""
                    SELECT EXISTS (
                        SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
                        WHERE t.tgrelid='opening_stock_revisions'::regclass
                          AND t.tgname=:name AND t.tgenabled='O'
                          AND t.tgtype=:trigger_type
                          AND p.proname='inventory_immutable'
                    )
                """), {"name": name, "trigger_type": trigger_type}):
                    raise RuntimeError("Opening correction history guards required")
            revisions = ["0096_hsn_master"]
        if revisions in (["0096_hsn_master"], ["0097_hsn_staged_merge"]):
            db.execute(text("SELECT id,code,gst,status,version,created_by,updated_by,created_at,updated_at FROM hsn_mappings LIMIT 0"))
            db.execute(text("SELECT mapping_id,version,actor_id,at,before_code,before_gst,before_status,after_code,after_gst,after_status FROM hsn_changes LIMIT 0"))
            db.execute(text("SELECT hsn_code FROM allergen_products LIMIT 0"))
            revisions = (["0095_quantity_staged_merge"] if revisions == ["0097_hsn_staged_merge"]
                         else ["0092_quantity_hundredths"])
        if revisions in (["0092_quantity_hundredths"], ["0095_quantity_staged_merge"]):
            quantity_successor = revisions[0]
            from app.services.quantity_precision import ready as quantity_ready
            quantity_ready(db)
            db.execute(text("SELECT kind,owner_id,location_key,original,normalized,residual FROM quantity_precision_locations LIMIT 0"))
            db.execute(text("SELECT purpose,record_id,original_digest,normalized_ciphertext FROM quantity_precision_snapshots LIMIT 0"))
            db.execute(text("SELECT allergen_id,original,normalized,residual FROM quantity_precision_thresholds LIMIT 0"))
            for table in ("inventory_postings", "in_house_postings"):
                db.execute(text(f"SELECT precision_epoch FROM {table} LIMIT 0"))
                if not db.scalar(text("""
                    SELECT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
                    WHERE t.tgrelid=CAST(:table AS regclass) AND t.tgname='quantity_hundredths'
                      AND t.tgenabled='O' AND p.proname='guard_quantity_hundredths')
                """), {"table": table}):
                    raise RuntimeError("Quantity precision insertion guards required")
            revisions = (["0093_designation_short_name"] if quantity_successor == "0095_quantity_staged_merge"
                         else ["0093_language_status"])
        if revisions == ["0093_designation_short_name"]:
            db.execute(text('SELECT "shortName" FROM designations LIMIT 0'))
            revisions = ["0094_language_low_stock_merge"]
        if revisions in (["0093_language_status"], ["0094_language_low_stock_merge"]):
            db.execute(text("SELECT status FROM languages LIMIT 0"))
            db.execute(text("SELECT before_status,after_status FROM language_changes LIMIT 0"))
            revisions = (["0092_low_stock_cron"] if revisions == ["0094_language_low_stock_merge"]
                         else ["0089_it_material_pricing"])
        if revisions == ["0092_low_stock_cron"]:
            from app.services.low_stock_settings import ready as low_stock_ready
            low_stock_ready(db)
            revisions = ["0091_low_stock_alerts"]
        if revisions == ["0091_low_stock_alerts"]:
            from app.services.low_stock_settings import ready as low_stock_ready
            low_stock_ready(db, recurring=False)
            from app.services.purchase_received_crypto import ReceiptCrypto
            ReceiptCrypto(get_settings())
            revisions = ["0089_it_material_pricing"]
        if revisions == ["0089_it_material_pricing"]:
            db.execute(text("SELECT id,product_id,request_id,request_digest,created_by FROM immunotherapy_dilution_material LIMIT 0"))
            revisions = ["0090_settlement_verification"]
        if revisions == ["0090_settlement_verification"]:
            # Retain verification and all invoice/predecessor readiness probes.
            if not db.scalar(text("""
                SELECT EXISTS (
                  SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
                  WHERE t.tgrelid='settlement_entries'::regclass
                    AND t.tgname='settlement_entries_immutable'
                    AND t.tgenabled='O'
                    AND p.proname='guard_settlement_entry_verification')
            """)):
                raise RuntimeError("Settlement verification guard required")
            revisions = ["0089_invoice_settings"]
        if revisions == ["0089_invoice_settings"]:
            from app.services.invoice_settings import ready as invoice_settings_ready
            invoice_settings_ready(db)
            from app.services.purchase_received_crypto import ReceiptCrypto
            ReceiptCrypto(get_settings())
            revisions = ["0088_gst_settings"]
        if revisions == ["0088_gst_settings"]:
            db.execute(text("SELECT id,version,cutoff_date,before_rate,on_after_rate FROM gst_settings LIMIT 0"))
            revisions = ["0087_pricing_rule_categories"]
        if revisions == ["0087_pricing_rule_categories"]:
            db.execute(text("SELECT rule_id,category_id FROM it_pricing_rule_categories LIMIT 0"))
            db.execute(text("SELECT category_id FROM it_pricing_rule_targets LIMIT 0"))
            revisions = ["0086_immunotherapy_extract"]
        if revisions == ["0086_immunotherapy_extract"]:
            db.execute(text("SELECT category_id,version,payload_ciphertext FROM immunotherapy_extract_settings LIMIT 0"))
            revisions = ["0086_it_pricing_rules"]
        if revisions == ["0086_it_pricing_rules"]:
            db.execute(text("SELECT id,category_id,version,payload_ciphertext,created_by,updated_by,created_at,updated_at FROM it_pricing_rules LIMIT 0"))
            db.execute(text("SELECT rule_id,allergen_id FROM it_pricing_rule_targets LIMIT 0"))
            db.execute(text("SELECT key,actor_id,payload_ciphertext FROM it_pricing_rule_requests LIMIT 0"))
            from app.services.purchase_received_crypto import ReceiptCrypto
            ReceiptCrypto(get_settings())
            revisions = ["0085_placement_email_details"]
        if revisions == ["0085_placement_email_details"]:
            # Content-only successor inherits every predecessor readiness probe.
            from app.services.email_templates import resolve_event
            resolve_event(db, "mr_immunotherapy_placed")
            revisions = ["0084_allergen_expiry"]
        if revisions == ["0084_allergen_expiry"]:
            db.execute(text("SELECT id,source_kind,batch_id,actor_id,created_at,payload_ciphertext FROM inventory_batch_costs LIMIT 0"))
            db.execute(text("SELECT id,source_kind,batch_id,actor_id,event_id,created_at,payload_ciphertext FROM inventory_expiry_disposals LIMIT 0"))
            db.execute(text("SELECT key,actor_id,digest,payload_ciphertext FROM inventory_expiry_requests LIMIT 0"))
            db.execute(text("SELECT source_kind,cursor,updated_at FROM inventory_expiry_scans LIMIT 0"))
            db.execute(text("SELECT source_kind,batch_id,detected_at FROM inventory_expiry_separations LIMIT 0"))
            db.execute(text("SELECT day,status,category,updated_at,lease_until,token FROM inventory_expiry_digests LIMIT 0"))
            db.execute(text("SELECT key,subject,introduction FROM inventory_expiry_templates LIMIT 0"))
            db.execute(text("SELECT disposal_id FROM in_house_postings LIMIT 0"))
            revisions = ["0083_immunotherapy_batches"]
        if revisions == ["0083_immunotherapy_batches"]:
            db.execute(text("SELECT month,last_ordinal FROM immunotherapy_batch_counters LIMIT 0"))
            revisions = ["0082_order_drafts"]
        if revisions == ["0082_order_drafts"]:
            db.execute(text("SELECT id,kind,created_by,mr_scope,version,payload_ciphertext,last_request,submitted_order_id,submitted_version,created_at,updated_at FROM order_drafts LIMIT 0"))
            db.execute(text("SELECT draft_id,file_id FROM order_draft_attachments LIMIT 0"))
            db.execute(text("SELECT key,draft_id,actor_id,response_ciphertext FROM order_draft_requests LIMIT 0"))
            revisions = ["0081_immunotherapy_alerts"]
        if revisions == ["0081_immunotherapy_alerts"]:
            from app.services.email_templates import resolve_event
            resolve_event(db, "mr_immunotherapy_placed")
            # Explicit successor inherits all earlier table/capability probes.
            revisions = ["0080_admin_email"]
        if revisions == ["0080_admin_email"]:
            revisions = ["0079_order_notifications"]
        if revisions == ["0079_order_notifications"]:
            db.execute(text("SELECT id,kind,order_id,user_id,mr_id,payload_ciphertext FROM order_notification_origins LIMIT 0"))
            db.execute(text("SELECT id,kind,order_id,source_key,event,placer_user_id,placer_mr_id,created_at,payload_ciphertext FROM order_notification_events LIMIT 0"))
            db.execute(text('SELECT id,event_id,user_id,"read",created_at FROM order_notification_alerts LIMIT 0'))
            db.execute(text("SELECT id,event_id,user_id,channel,status,category,configuration_id,configuration_version,template_id,template_version,destination_index,lease_token,lease_until,created_at,updated_at FROM order_notification_deliveries LIMIT 0"))
            db.execute(text("SELECT id,channel,event_key,name,enabled,version,subject,html,text,dlt_id,provider_template,language,parameters,created_by,updated_by FROM order_event_templates LIMIT 0"))
            revisions = ["0078_reserve_movements"]
        if revisions == ["0078_reserve_movements"]:
            db.execute(text('SELECT id,reserve_id,movement_id,location_id,delta,"before","after" FROM in_house_postings LIMIT 0'))
            db.execute(text("SELECT reserve_movement_id FROM inventory_lots LIMIT 0"))
            revisions = ["0077_settlements"]
        if revisions == ["0077_settlements"]:
            db.execute(text("SELECT id,actor_id,mr_id,date,created_at,payload_ciphertext FROM settlement_batches LIMIT 0"))
            db.execute(text("SELECT id,batch_id,kind,order_id,payload_ciphertext,verified_at,verified_by FROM settlement_entries LIMIT 0"))
            db.execute(text("SELECT id,actor_id,mr_id,created_at,payload_ciphertext FROM settlement_rejections LIMIT 0"))
            revisions = ["0076_in_house_stock"]
        if revisions == ["0076_in_house_stock"]:
            db.execute(text("SELECT id,actor_id,event_id,created_at,payload_ciphertext FROM in_house_stock LIMIT 0"))
            db.execute(text("SELECT key,actor_id,digest,payload_ciphertext FROM in_house_stock_requests LIMIT 0"))
            revisions = ["0075_shipments"]
        if revisions == ["0075_shipments"]:
            revisions = ["0074_business_numbers"]
        if revisions == ["0074_business_numbers"]:
            db.execute(text("SELECT code FROM allergen_products LIMIT 0"))
            db.execute(text("SELECT last_value,is_called FROM allergen_number_seq LIMIT 0"))
            db.execute(text("SELECT last_value,is_called FROM staff_employee_number_seq LIMIT 0"))
            revisions = ["0073_order_decisions"]
        if revisions == ["0073_order_decisions"]:
            db.execute(text("SELECT status,version,snapshot_ciphertext FROM spt_orders LIMIT 0"))
            db.execute(text("SELECT status,version,snapshot_ciphertext FROM lupin_orders LIMIT 0"))
            revisions = ["0072_imm_approved_status"]
        if revisions == ["0072_imm_approved_status"]:
            # Only the existing status CHECK vocabulary changes. Retain audit,
            # order, inventory, identity and configuration predecessor probes.
            revisions = ["0071_order_review_audit"]
        if revisions == ["0071_order_review_audit"]:
            db.execute(text("SELECT created_at,updated_at FROM immunotherapy_orders LIMIT 0"))
            revisions = ["0070_mr_account_numbers"]
        if revisions == ["0070_mr_account_numbers"]:
            db.execute(text("SELECT last_value,is_called FROM mr_login_number_seq LIMIT 0"))
            revisions = ["0069_workspace_permissions"]
        if revisions == ["0069_workspace_permissions"]:
            revisions = ["0068_category_description"]
        feature_revisions = revisions
        if revisions == ["0068_category_description"]:
            db.execute(text("SELECT description FROM product_categories LIMIT 0"))
            revisions = ["0067_inventory_adjustments"]
        if revisions == ["0067_inventory_adjustments"]:
            db.execute(text("SELECT id,product_id,location_id,direction,quantity,actor_id,event_id,payload_ciphertext FROM inventory_adjustments LIMIT 0"))
            db.execute(text("SELECT key,actor_id,digest,payload_ciphertext FROM inventory_adjustment_requests LIMIT 0"))
            db.execute(text("SELECT adjustment_id FROM inventory_lots LIMIT 0"))
            revisions = ["0066_spt_registration_owner"]
        if revisions == ["0066_spt_registration_owner"]:
            db.execute(text("SELECT owner_mr_id FROM spt_patients LIMIT 0"))
            revisions = ["0065_lupin_orders"]
        if revisions == ["0065_lupin_orders"]:
            db.execute(text("SELECT snapshot_ciphertext,version FROM lupin_orders LIMIT 0"))
            db.execute(text("SELECT patient_id,position FROM lupin_order_patients LIMIT 0"))
            db.execute(text("SELECT response_ciphertext FROM lupin_requests LIMIT 0"))
            db.execute(text("SELECT file_id FROM lupin_attachments LIMIT 0"))
            db.execute(text("SELECT lupin_owner_id,lupin_name_ciphertext FROM files LIMIT 0"))
            revisions = ["0064_procurement_documents"]
        if revisions == ["0064_procurement_documents"]:
            from app.services.procurement_documents import crypto_for
            crypto_for(db)
            db.execute(text("SELECT event_id,po_id,pr_id,record_version,payload_ciphertext FROM procurement_documents LIMIT 0"))
            db.execute(text("SELECT payload_ciphertext FROM purchase_order_audit LIMIT 0"))
            revisions = ["0063_spt_orders"]
        if revisions == ["0063_spt_orders"]:
            db.execute(text("SELECT snapshot_ciphertext,version,source_id FROM spt_orders LIMIT 0"))
            db.execute(text("SELECT snapshot_ciphertext FROM spt_patients LIMIT 0"))
            db.execute(text("SELECT response_ciphertext FROM spt_requests LIMIT 0"))
            db.execute(text("SELECT position,master_patient_id,spt_patient_id FROM spt_order_patients LIMIT 0"))
            revisions = ["0062_kits_orders"]
        if revisions == ["0062_kits_orders"]:
            db.execute(text("SELECT snapshot_ciphertext,version FROM kits_orders LIMIT 0"))
            db.execute(text("SELECT response_ciphertext FROM kits_requests LIMIT 0"))
            db.execute(text("SELECT kits_owner_id,kits_name_ciphertext FROM files LIMIT 0"))
            revisions = ["0061_immunotherapy_orders"]
        if revisions == ["0061_immunotherapy_orders"]:
            db.execute(text("SELECT snapshot_ciphertext,version FROM immunotherapy_orders LIMIT 0"))
            db.execute(text("SELECT response_ciphertext FROM immunotherapy_requests LIMIT 0"))
            db.execute(text("SELECT last_value,is_called FROM staff_account_number_seq LIMIT 0"))
            revisions = ["0059_staff_unified_access"]
            feature_revisions = revisions
        if revisions == ["0060_staff_account_numbers"]:
            db.execute(text("SELECT last_value,is_called FROM staff_account_number_seq LIMIT 0"))
            revisions = ["0059_staff_unified_access"]
            feature_revisions = revisions
        if revisions == ["0059_staff_unified_access"]:
            db.execute(text("SELECT role_resolution_required,login_identifiers_ready FROM staff_profiles LIMIT 0"))
            db.execute(text("SELECT identifier_index,user_id FROM staff_login_identifiers LIMIT 0"))
        if revisions in (["0058_master_numbers"], ["0059_staff_unified_access"]):
            db.execute(text('SELECT "doctorNumber" FROM doctor_directory LIMIT 0'))
            db.execute(text("SELECT p.last_value,d.last_value,m.last_value FROM patient_number_seq p, doctor_number_seq d, mr_login_number_seq m LIMIT 0"))
        if revisions in (["0057_staff_employee_code"], ["0058_master_numbers"], ["0059_staff_unified_access"]):
            db.execute(text("SELECT employee_code FROM staff_profiles LIMIT 0"))
        if revisions in (["0055_mr_staff_managers"], ["0056_staff_business_roles"], ["0057_staff_employee_code"], ["0058_master_numbers"], ["0059_staff_unified_access"]):
            db.execute(text('SELECT "reportingStaffId", reporting_staff_name_ciphertext FROM mr_directory LIMIT 0'))
            feature_revisions = ["0054_modern_email_tests"]
        if feature_revisions in (["0044_purchase_received"], ["0045_pr_batch_numbers"], ["0046_live_inventory"], ["0047_languages"], ["0048_language_unicode"], ["0047_stock_products"], ["0049_product_language_merge"], ["0050_opening_stock"], ["0051_headquarter_areas"], ["0051_mr_zones"], ["0052_hq_mr_zones_merge"], ["0053_email_invitations"], ["0054_modern_email_tests"]):
            from app.services.purchase_received_crypto import ReceiptCrypto
            ReceiptCrypto(get_settings())
            db.execute(text("SELECT payload_ciphertext FROM purchase_receipts LIMIT 0"))
        if feature_revisions in (["0045_pr_batch_numbers"], ["0046_live_inventory"], ["0047_languages"], ["0048_language_unicode"], ["0047_stock_products"], ["0049_product_language_merge"], ["0050_opening_stock"], ["0051_headquarter_areas"], ["0051_mr_zones"], ["0052_hq_mr_zones_merge"], ["0053_email_invitations"], ["0054_modern_email_tests"]):
            from app.services.pr_batches import settings_row, policy_data
            # Presence alone cannot establish readiness: verify the explicit
            # initial marker or a readable, valid saved policy without writing,
            # allocating numbers or issuing a policy token. Inventory retains
            # this feature and must validate it at its successor revision.
            policy_data(settings_row(db), ReceiptCrypto(get_settings()))
            db.execute(text("SELECT scope, value FROM pr_batch_counters LIMIT 0"))
            db.execute(text("SELECT key, actor_id, payload_ciphertext FROM pr_batch_allocations LIMIT 0"))
        if feature_revisions in (["0046_live_inventory"], ["0047_languages"], ["0048_language_unicode"], ["0047_stock_products"], ["0049_product_language_merge"], ["0050_opening_stock"], ["0051_headquarter_areas"], ["0051_mr_zones"], ["0052_hq_mr_zones_merge"], ["0053_email_invitations"], ["0054_modern_email_tests"]):
            db.execute(text("SELECT id, receipt_id, line_id, product_id, origin_id, accepted, payload_ciphertext FROM inventory_lots LIMIT 0"))
            db.execute(text("SELECT lot_id, location_id, quantity FROM inventory_balances LIMIT 0"))
            db.execute(text("SELECT receipt_id, version, initialized_at FROM inventory_receipt_states LIMIT 0"))
            db.execute(text("SELECT id, source_id, destination_id, actor_id, event_id, created_at, payload_ciphertext FROM inventory_movements LIMIT 0"))
            db.execute(text("SELECT id, source_key, lot_id, location_id, movement_id, actor_id, created_at, delta, before, after FROM inventory_postings LIMIT 0"))
            db.execute(text("SELECT key, actor_id, digest, payload_ciphertext FROM inventory_requests LIMIT 0"))
        db.execute(text("SELECT channel, version FROM communication_channels LIMIT 0"))
        if feature_revisions in (["0047_stock_products"], ["0049_product_language_merge"], ["0050_opening_stock"], ["0051_headquarter_areas"], ["0051_mr_zones"], ["0052_hq_mr_zones_merge"], ["0053_email_invitations"], ["0054_modern_email_tests"]):
            db.execute(text("SELECT id, payload_ciphertext, name_key, status, version, deleted_at FROM combo_products LIMIT 0"))
            db.execute(text("SELECT id, product_id, version, event_id, actor_id, created_at, payload_ciphertext FROM combo_product_revisions LIMIT 0"))
            db.execute(text("SELECT revision_id, allergen_id, quantity FROM combo_product_members LIMIT 0"))
            db.execute(text("SELECT id, product_id, revision_id, location_id, quantity, event_id, actor_id, created_at, payload_ciphertext FROM product_assemblies LIMIT 0"))
            db.execute(text("SELECT key, actor_id, digest, payload_ciphertext FROM product_requests LIMIT 0"))
            db.execute(text("SELECT combo_id, assembly_id FROM inventory_lots LIMIT 0"))
        if feature_revisions in (["0047_languages"], ["0048_language_unicode"], ["0049_product_language_merge"], ["0050_opening_stock"], ["0051_headquarter_areas"], ["0051_mr_zones"], ["0052_hq_mr_zones_merge"], ["0053_email_invitations"], ["0054_modern_email_tests"]):
            db.execute(text("SELECT id, name, version, created_by, updated_by, created_at, updated_at, deleted_at, deleted_by FROM languages LIMIT 0"))
        if feature_revisions in (["0050_opening_stock"], ["0051_headquarter_areas"], ["0051_mr_zones"], ["0052_hq_mr_zones_merge"], ["0053_email_invitations"], ["0054_modern_email_tests"]):
            db.execute(text("SELECT id, source_id, row_id, actor_id, event_id, created_at, payload_ciphertext FROM opening_stock LIMIT 0"))
            db.execute(text("SELECT key, actor_id, digest, payload_ciphertext FROM opening_stock_requests LIMIT 0"))
            db.execute(text("SELECT opening_id FROM inventory_lots LIMIT 0"))
            db.execute(text("SELECT id FROM inventory_balances LIMIT 0"))
            db.execute(text("SELECT id, language_id, version, action, actor_id, at, before_name, after_name, event_id FROM language_changes LIMIT 0"))
        # Keep the incoming MR-specific readiness probe at the reconciled head.
        if feature_revisions in (["0051_mr_zones"], ["0052_hq_mr_zones_merge"], ["0053_email_invitations"], ["0054_modern_email_tests"]):
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
        if feature_revisions in (["0053_email_invitations"], ["0054_modern_email_tests"]):
            from app.services.email_delivery import MailCrypto
            MailCrypto(get_settings())
            db.execute(text("SELECT password_setup_required FROM users LIMIT 0"))
            db.execute(text("SELECT recipient_ciphertext, recipient_index, status, template_version FROM email_attempts LIMIT 0"))
            from app.services.email_templates import resolve_event
            resolve_event(db, "password_recovery")
            resolve_event(db, "account_invitation")
            if feature_revisions == ["0054_modern_email_tests"]:
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
