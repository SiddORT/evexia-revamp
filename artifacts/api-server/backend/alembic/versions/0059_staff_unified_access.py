"""Unify staff roles and stage collision-safe email/code aliases without inventing data."""
from alembic import op
import sqlalchemy as sa

revision = "0059_staff_unified_access"
down_revision = "0058_master_numbers"
branch_labels = depends_on = None


def upgrade():
    db = op.get_bind()
    db.execute(sa.text("SELECT pg_advisory_xact_lock(hashtextextended('evexia:zone-policy:v1',0))"))
    db.execute(sa.text("SELECT pg_advisory_xact_lock(73182451)"))
    op.add_column("staff_profiles", sa.Column("role_resolution_required", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("staff_profiles", sa.Column("login_identifiers_ready", sa.Boolean(), nullable=False, server_default="false"))
    op.create_table("staff_login_identifiers",
        sa.Column("identifier_index", sa.String(64), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.CheckConstraint("identifier_index ~ '^[0-9a-f]{64}$'", name="ck_staff_login_digest"))
    op.create_index("ix_staff_login_owner", "staff_login_identifiers", ["user_id"])
    op.create_check_constraint("ck_staff_ready_employee_code", "staff_profiles",
                               "NOT login_identifiers_ready OR employee_code IS NOT NULL")
    op.create_index("uq_staff_ready_employee_code", "staff_profiles",
                    [sa.text("lower(employee_code)")], unique=True,
                    postgresql_where=sa.text("login_identifiers_ready"))
    op.execute("""
        CREATE FUNCTION evexia_staff_alias_guard() RETURNS trigger AS $$
        BEGIN
          PERFORM pg_advisory_xact_lock(73182451);
          IF NOT EXISTS (SELECT 1 FROM account_identifier_reservations r
            WHERE r.identifier_index=NEW.identifier_index AND r.user_id=NEW.user_id)
          THEN RAISE EXCEPTION 'staff identifier reservation required'
            USING ERRCODE='23505', CONSTRAINT='uq_staff_login_namespace';
          END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER trg_staff_alias_guard BEFORE INSERT OR UPDATE ON staff_login_identifiers
          FOR EACH ROW EXECUTE FUNCTION evexia_staff_alias_guard();
    """)
    # This lock also covers encrypted account writers/reservations.
    db.execute(sa.text("""
        UPDATE staff_profiles s SET role_resolution_required = NOT EXISTS (
          SELECT 1 FROM custom_roles r WHERE r.deleted_at IS NULL
          AND lower(btrim(r.name))=lower(btrim(s.role))
          AND (s.custom_role_id IS NULL OR s.custom_role_id=r.id)
          AND (SELECT count(*) FROM custom_roles x WHERE x.deleted_at IS NULL
               AND lower(btrim(x.name))=lower(btrim(s.role)))=1)
    """))
    db.execute(sa.text("""
        WITH changed AS (
          UPDATE staff_profiles s SET custom_role_id=r.id FROM custom_roles r
          WHERE NOT s.role_resolution_required AND s.custom_role_id IS NULL
            AND r.deleted_at IS NULL AND lower(btrim(r.name))=lower(btrim(s.role))
          RETURNING s.id,s.user_id
        ), invalidated AS (
          UPDATE users u SET identity_version=u.identity_version+1 FROM changed c
          WHERE u.id=c.user_id AND u.system_role IS NULL AND NOT u.is_protected_system_admin
          RETURNING u.id
        )
        INSERT INTO audit_events(id,action,resource_type,resource_id,reason,outcome)
          SELECT gen_random_uuid(),'staff_role_reconcile','staff',id,'schema_unification','success'
          FROM changed
    """))
    # Invalidate every pre-unification form, including old Access clients.
    # Do not attribute this system migration to the last human updater.
    db.execute(sa.text("UPDATE staff_profiles SET version=version+1"))
    # Bounded staging. Larger directories stay explicitly unresolved, not a
    # startup failure or a partial unbounded scan. Administrators save corrections.
    rows = db.execute(sa.text("""
        SELECT id,user_id,email_ciphertext,employee_code FROM staff_profiles
        ORDER BY id LIMIT 10001
    """)).mappings().all()
    if len(rows) > 10000:
        return
    from app.core.config import get_settings
    from app.services.staff_crypto import StaffCrypto
    from app.services.account_crypto import AccountCrypto
    settings = get_settings()
    staff_crypto, accounts = StaffCrypto(settings), AccountCrypto(settings)
    candidates, counts = [], {}
    for row in rows:
        email = staff_crypto.decrypt(row["id"], "email", row["email_ciphertext"])
        code = row["employee_code"]
        values = (email, code)
        digests = [accounts.lookup_index(v.lower()) for v in values if v]
        candidates.append((row, values, digests))
        for digest in set(digests):
            counts[digest] = counts.get(digest, 0) + 1
    for row, values, digests in candidates:
        if (not values[1] or len(digests) != 2 or any(counts[d] != 1 for d in digests)
                or any(db.scalar(sa.select(sa.func.lower(v))) != v.lower() for v in values)
                or accounts.lookup_index("crm-admin@allergyevexia.in") in digests):
            continue
        conflicts = db.scalar(sa.text("""
            SELECT count(*) FROM account_identifier_reservations
            WHERE identifier_index IN (:email,:code) AND user_id<>:owner
        """), {"email": digests[0], "code": digests[1], "owner": row["user_id"]})
        if conflicts:
            continue
        for value, digest in zip(values, digests):
            ciphertext = accounts.encrypt(row["user_id"], "email", value)
            db.execute(sa.text("""
                INSERT INTO account_identifier_reservations(identifier_index,identifier,user_id,field)
                VALUES (:digest,:ciphertext,:owner,'email') ON CONFLICT DO NOTHING
            """), {"digest": digest, "ciphertext": ciphertext, "owner": row["user_id"]})
            db.execute(sa.text("""
                INSERT INTO staff_login_identifiers VALUES (:digest,:owner) ON CONFLICT DO NOTHING
            """), {"digest": digest, "owner": row["user_id"]})
        db.execute(sa.text("UPDATE staff_profiles SET login_identifiers_ready=true WHERE id=:id"), {"id": row["id"]})


def downgrade():
    raise RuntimeError("Staff identifier reservations and permission reconciliation require forward recovery.")
