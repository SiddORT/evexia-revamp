"""Protect the singleton system Super Admin and preserve refresh family policy."""
from alembic import op
import sqlalchemy as sa

revision = "0005_protected_admin"
down_revision = "0004_private_files"
branch_labels = None
depends_on = None

RESERVED_EMAIL = "crm-admin@allergyevexia.in"


def upgrade():
    connection = op.get_bind()
    existing_admins = connection.execute(sa.text(
        "SELECT count(*) FROM users WHERE system_role = 'super_admin'"
    )).scalar_one()
    if existing_admins:
        raise RuntimeError(
            "Existing Super Admin mappings require operator review before migration 0005; "
            "do not automatically elevate or discard identities."
        )

    op.add_column(
        "users",
        sa.Column("is_protected_system_admin", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.alter_column("users", "is_protected_system_admin", server_default=None)
    op.create_check_constraint(
        "ck_users_protected_super_admin", "users",
        "coalesce(system_role = 'super_admin', false) = is_protected_system_admin",
    )
    op.create_check_constraint(
        "ck_users_protected_super_admin_identity", "users",
        f"NOT is_protected_system_admin OR (email = '{RESERVED_EMAIL}' AND is_active)",
    )
    op.create_index(
        "uq_users_protected_system_admin", "users", ["is_protected_system_admin"],
        unique=True, postgresql_where=sa.text("is_protected_system_admin"),
    )

    op.add_column(
        "refresh_sessions",
        sa.Column("family_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "refresh_sessions",
        sa.Column("persistent", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    connection.execute(sa.text("UPDATE refresh_sessions SET family_expires_at = expires_at"))
    op.alter_column("refresh_sessions", "family_expires_at", nullable=False)
    op.alter_column("refresh_sessions", "persistent", server_default=None)
    op.create_check_constraint(
        "ck_refresh_family_expiry", "refresh_sessions", "family_expires_at >= expires_at",
    )

    op.execute(sa.text("""
        CREATE FUNCTION evexia_protect_super_admin() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'INSERT' THEN
                IF NEW.is_protected_system_admin
                   AND current_setting('evexia.bootstrap_super_admin', true) IS DISTINCT FROM 'on' THEN
                    RAISE EXCEPTION 'protected Super Admin may only be created by the bootstrap service'
                        USING ERRCODE = '23514';
                END IF;
                RETURN NEW;
            ELSIF TG_OP = 'DELETE' THEN
                IF OLD.is_protected_system_admin THEN
                    RAISE EXCEPTION 'protected Super Admin cannot be deleted'
                        USING ERRCODE = '23514';
                END IF;
                RETURN OLD;
            END IF;
            IF OLD.is_protected_system_admin AND (
                NEW.id IS DISTINCT FROM OLD.id
                OR NEW.email IS DISTINCT FROM OLD.email
                OR NEW.username IS DISTINCT FROM OLD.username
                OR NEW.system_role IS DISTINCT FROM OLD.system_role
                OR NEW.is_protected_system_admin IS DISTINCT FROM OLD.is_protected_system_admin
                OR NEW.is_active IS DISTINCT FROM OLD.is_active
                OR NEW.identity_version IS DISTINCT FROM OLD.identity_version
            ) THEN
                RAISE EXCEPTION 'protected Super Admin identity and activation are immutable'
                    USING ERRCODE = '23514';
            END IF;
            IF NEW.is_protected_system_admin AND NOT OLD.is_protected_system_admin THEN
                RAISE EXCEPTION 'ordinary identities cannot be promoted to protected Super Admin'
                    USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
    """))
    op.execute(sa.text("""
        CREATE TRIGGER trg_protect_super_admin
        BEFORE INSERT OR UPDATE OR DELETE ON users
        FOR EACH ROW EXECUTE FUNCTION evexia_protect_super_admin()
    """))


def downgrade():
    connection = op.get_bind()
    protected_exists = connection.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM users WHERE is_protected_system_admin)"
    )).scalar_one()
    if protected_exists:
        raise RuntimeError(
            "Cannot downgrade while the protected Super Admin exists; use a reviewed forward migration."
        )
    op.execute("DROP TRIGGER trg_protect_super_admin ON users")
    op.execute("DROP FUNCTION evexia_protect_super_admin()")
    op.drop_constraint("ck_refresh_family_expiry", "refresh_sessions", type_="check")
    op.drop_column("refresh_sessions", "persistent")
    op.drop_column("refresh_sessions", "family_expires_at")
    op.drop_index("uq_users_protected_system_admin", table_name="users")
    op.drop_constraint("ck_users_protected_super_admin_identity", "users", type_="check")
    op.drop_constraint("ck_users_protected_super_admin", "users", type_="check")
    op.drop_column("users", "is_protected_system_admin")