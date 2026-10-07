"""Empty MR business extension; no identity promotion or demo migration."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0018_mr_directory"
down_revision = "0018_product_categories"
branch_labels = depends_on = None


def upgrade():
    # Do not normalize or overwrite legacy accounts. Conflicts need operator review.
    op.execute("""
    DO $$ BEGIN
      IF EXISTS (
        SELECT lower(identifier) FROM (
          SELECT id, email AS identifier FROM users WHERE email IS NOT NULL
          UNION ALL SELECT id, username FROM users WHERE username IS NOT NULL
        ) x GROUP BY lower(identifier) HAVING count(*) > 1
      ) THEN RAISE EXCEPTION 'Account namespace conflicts require operator review'; END IF;
    END $$;
    """)
    op.create_index("uq_users_lower_email", "users", [sa.text("lower(email)")], unique=True)
    op.create_index("uq_users_lower_username", "users", [sa.text("lower(username)")], unique=True)
    op.create_table(
        "account_identifier_reservations",
        sa.Column("identifier", sa.String(320), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    )
    op.execute("""
    INSERT INTO account_identifier_reservations(identifier, user_id)
      SELECT lower(email), id FROM users WHERE email IS NOT NULL
      UNION ALL SELECT lower(username), id FROM users WHERE username IS NOT NULL;
    """)
    op.create_table(
        "mr_directory",
        sa.Column("id", postgresql.UUID(as_uuid=True), sa.ForeignKey("mr_profiles.id"), primary_key=True),
        *[sa.Column(key, sa.String(length), nullable=False) for key, length in (
            ("name", 200), ("phone", 20), ("email", 320), ("contactRequirement", 8),
            ("employeeCode", 64), ("designation", 200), ("status", 8), ("pincode", 6),
            ("addressLine1", 300), ("addressLine2", 300), ("landmark", 200),
            ("city", 100), ("state", 100), ("country", 100))],
        sa.Column("hq", postgresql.UUID(as_uuid=True), sa.ForeignKey("headquarters.id"), nullable=False),
        sa.Column("zoneId", postgresql.UUID(as_uuid=True), sa.ForeignKey("zones.id"), nullable=False),
        sa.Column("reportingManagerId", postgresql.UUID(as_uuid=True), sa.ForeignKey("mr_directory.id")),
        sa.Column("dateOfJoining", sa.Date(), nullable=False),
        sa.Column("paymentLimit", sa.Numeric(11, 2), nullable=False),
        sa.Column("doctorDaysLimit", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.CheckConstraint("version >= 1", name="ck_mr_directory_version"),
        sa.CheckConstraint("status IN ('active','inactive')", name="ck_mr_directory_status"),
        sa.CheckConstraint('"contactRequirement" IN (\'required\',\'optional\')', name="ck_mr_directory_contact"),
        sa.CheckConstraint('"contactRequirement" = \'optional\' OR (phone <> \'\' AND email <> \'\')', name="ck_mr_directory_required_contact"),
        sa.CheckConstraint('"paymentLimit" >= 0 AND "doctorDaysLimit" BETWEEN 0 AND 3650', name="ck_mr_directory_limits"),
        sa.CheckConstraint('"reportingManagerId" IS NULL OR "reportingManagerId" <> id', name="ck_mr_directory_self_manager"),
        sa.CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_mr_directory_deletion"),
        sa.CheckConstraint("length(name) >= 1 AND name = btrim(name)", name="ck_mr_directory_name"),
        sa.CheckConstraint('"employeeCode" <> \'\' AND "employeeCode" = btrim("employeeCode")', name="ck_mr_directory_employee"),
        sa.CheckConstraint("pincode ~ '^[1-9][0-9]{5}$'", name="ck_mr_directory_pin"),
        sa.CheckConstraint("phone = '' OR phone ~ '^[0-9]{10}$'", name="ck_mr_directory_phone"),
    )
    for name in ("hq", "zoneId", "reportingManagerId"):
        op.create_index(f"ix_mr_directory_{name}", "mr_directory", [name])
    op.create_index("uq_mr_directory_employee", "mr_directory", [sa.text('lower("employeeCode")')], unique=True)
    # Serialize cross-column namespace mutations, including domain/operator/staff.
    # Live and deleted credentials are equally reserved. No account changes here.
    op.execute("""
    CREATE FUNCTION evexia_account_namespace() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock(73182451);
      IF (NEW.email IS NOT NULL AND NEW.username IS NOT NULL AND lower(NEW.email) = lower(NEW.username))
        OR EXISTS (SELECT 1 FROM account_identifier_reservations r WHERE r.user_id <> NEW.id
                   AND r.identifier IN (lower(NEW.email), lower(NEW.username))) THEN
        RAISE EXCEPTION 'account identifier reserved' USING ERRCODE = '23505',
          CONSTRAINT = 'uq_users_login_namespace';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_account_namespace BEFORE INSERT OR UPDATE OF email, username ON users
    FOR EACH ROW EXECUTE FUNCTION evexia_account_namespace();
    CREATE FUNCTION evexia_account_reserve() RETURNS trigger AS $$
    BEGIN
      INSERT INTO account_identifier_reservations(identifier, user_id)
        SELECT lower(NEW.email), NEW.id WHERE NEW.email IS NOT NULL
        UNION SELECT lower(NEW.username), NEW.id WHERE NEW.username IS NOT NULL
        ON CONFLICT (identifier) DO NOTHING;
      RETURN NULL;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_account_reserve AFTER INSERT OR UPDATE OF email, username ON users
      FOR EACH ROW EXECUTE FUNCTION evexia_account_reserve();

    CREATE OR REPLACE FUNCTION evexia_staff_identity_check() RETURNS trigger AS $$
    DECLARE affected uuid;
    BEGIN
      IF TG_TABLE_NAME = 'users' THEN
        affected := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
      ELSE
        affected := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
      END IF;
      IF EXISTS (
        SELECT 1 FROM users u LEFT JOIN staff_profiles s ON s.user_id = u.id
        WHERE u.id = affected AND (
          (u.email IS NULL AND s.id IS NULL AND NOT EXISTS (
            SELECT 1 FROM mr_profiles p JOIN mr_directory d ON d.id = p.id
            WHERE p.user_id = u.id AND u.system_role = 'mr' AND u.username IS NOT NULL))
          OR (s.id IS NOT NULL AND (u.email IS NOT NULL OR u.system_role IS NOT NULL
              OR u.is_protected_system_admin OR u.username IS NULL)))
      ) THEN RAISE EXCEPTION 'invalid identity linkage' USING ERRCODE = '23514'; END IF;
      RETURN NULL;
    END; $$ LANGUAGE plpgsql;

    CREATE FUNCTION evexia_mr_directory_identity() RETURNS trigger AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM mr_directory d JOIN mr_profiles p ON p.id = d.id
        JOIN users u ON u.id = p.user_id WHERE
          ((TG_TABLE_NAME = 'users' AND p.user_id = NEW.id)
            OR (TG_TABLE_NAME <> 'users' AND d.id = NEW.id))
          AND (u.system_role IS DISTINCT FROM 'mr' OR u.is_protected_system_admin OR u.username IS NULL
          OR coalesce(u.email, '') <> d.email
          OR u.is_active <> (d.status = 'active' AND d.deleted_at IS NULL)
          OR p.is_active <> u.is_active)) THEN
        RAISE EXCEPTION 'invalid MR directory identity' USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END; $$ LANGUAGE plpgsql;
    CREATE CONSTRAINT TRIGGER trg_mr_directory_identity AFTER INSERT OR UPDATE ON mr_directory
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION evexia_mr_directory_identity();
    CREATE CONSTRAINT TRIGGER trg_mr_user_identity AFTER UPDATE ON users
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION evexia_mr_directory_identity();
    CREATE CONSTRAINT TRIGGER trg_mr_profile_identity AFTER UPDATE ON mr_profiles
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION evexia_mr_directory_identity();
    """)


def downgrade():
    # Empty-schema rollback is useful for isolated historical migration tests.
    # Once accounts have directory details, code rollback cannot undo passwords.
    if op.get_bind().execute(sa.text("SELECT EXISTS (SELECT 1 FROM mr_directory)")).scalar():
        raise RuntimeError("Populated MR directory downgrade requires a reviewed coordinated restore")
    op.execute("""
    DROP TRIGGER trg_mr_directory_identity ON mr_directory;
    DROP TRIGGER trg_mr_user_identity ON users;
    DROP TRIGGER trg_mr_profile_identity ON mr_profiles;
    DROP FUNCTION evexia_mr_directory_identity();
    DROP TRIGGER trg_account_namespace ON users;
    DROP TRIGGER trg_account_reserve ON users;
    DROP FUNCTION evexia_account_namespace();
    DROP FUNCTION evexia_account_reserve();
    CREATE OR REPLACE FUNCTION evexia_staff_identity_check() RETURNS trigger AS $$
    DECLARE affected uuid;
    BEGIN
      IF TG_TABLE_NAME = 'users' THEN
        affected := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
      ELSE
        affected := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
      END IF;
      IF EXISTS (
        SELECT 1 FROM users u LEFT JOIN staff_profiles s ON s.user_id = u.id
        WHERE u.id = affected AND ((u.email IS NULL AND s.id IS NULL)
          OR (s.id IS NOT NULL AND (u.email IS NOT NULL OR u.system_role IS NOT NULL
              OR u.is_protected_system_admin OR u.username IS NULL)))
      ) THEN RAISE EXCEPTION 'invalid staff identity linkage' USING ERRCODE = '23514'; END IF;
      RETURN NULL;
    END; $$ LANGUAGE plpgsql;
    """)
    op.drop_table("mr_directory")
    op.drop_table("account_identifier_reservations")
    op.drop_index("uq_users_lower_email", table_name="users")
    op.drop_index("uq_users_lower_username", table_name="users")
