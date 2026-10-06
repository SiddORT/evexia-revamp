"""Encrypted staff profiles; preserve all existing identity and reporting history."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0009_staff"
down_revision = "0008_activity_search"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("users", "email", nullable=True)
    op.create_table(
        "staff_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), unique=True, nullable=False),
        *[sa.Column(f"{field}_ciphertext", sa.Text(), nullable=False) for field in ("name", "email", "phone")],
        sa.Column("email_index", sa.String(64), unique=True, nullable=False),
        sa.Column("dial_country", sa.String(2), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("designation", sa.String(200), nullable=False),
        sa.Column("joining_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("version >= 1", name="ck_staff_version"),
        sa.CheckConstraint("status IN ('active', 'inactive')", name="ck_staff_status"),
        sa.CheckConstraint("role IN ('Staff', 'Manager', 'Accountant', 'Back End', 'Sub Admin', 'Super Admin')", name="ck_staff_role"),
    )
    # Deferred integrity permits atomic User + profile insertion, but never a
    # committed email-less legacy/MR/admin account or mapped staff identity.
    op.execute("""
    CREATE FUNCTION evexia_staff_identity_check() RETURNS trigger AS $$
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
      ) THEN
        RAISE EXCEPTION 'invalid staff identity linkage' USING ERRCODE = '23514';
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
    CREATE CONSTRAINT TRIGGER trg_staff_user_link AFTER INSERT OR UPDATE OR DELETE ON users
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION evexia_staff_identity_check();
    CREATE CONSTRAINT TRIGGER trg_staff_profile_link AFTER INSERT OR UPDATE OR DELETE ON staff_profiles
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION evexia_staff_identity_check();
    CREATE FUNCTION evexia_staff_immutable_identity() RETURNS trigger AS $$
    BEGIN
      IF TG_TABLE_NAME = 'staff_profiles' THEN
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id
           OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
          RAISE EXCEPTION 'immutable staff identity' USING ERRCODE = '23514';
        END IF;
      ELSIF EXISTS (SELECT 1 FROM staff_profiles WHERE user_id = OLD.id) THEN
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.username IS DISTINCT FROM OLD.username THEN
          RAISE EXCEPTION 'immutable staff credentials identity' USING ERRCODE = '23514';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_staff_immutable_profile BEFORE UPDATE ON staff_profiles
    FOR EACH ROW EXECUTE FUNCTION evexia_staff_immutable_identity();
    CREATE TRIGGER trg_staff_immutable_user BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION evexia_staff_immutable_identity();
    """)


def downgrade():
    if op.get_bind().execute(sa.text("SELECT EXISTS (SELECT 1 FROM staff_profiles)")).scalar_one():
        raise RuntimeError("Staff records exist; use a reviewed forward correction or coordinated restore.")
    op.execute("DROP TRIGGER trg_staff_immutable_user ON users")
    op.execute("DROP TRIGGER trg_staff_immutable_profile ON staff_profiles")
    op.execute("DROP FUNCTION evexia_staff_immutable_identity()")
    op.execute("DROP TRIGGER trg_staff_user_link ON users")
    op.execute("DROP TRIGGER trg_staff_profile_link ON staff_profiles")
    op.execute("DROP FUNCTION evexia_staff_identity_check()")
    op.drop_table("staff_profiles")
    op.alter_column("users", "email", nullable=False)
