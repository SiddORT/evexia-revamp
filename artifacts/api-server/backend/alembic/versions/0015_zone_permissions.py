"""Opt-in staff workspace identities and empty custom-role Zone grants."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0015_zone_permissions"
down_revision = "0014_download_reporting_index"
branch_labels = depends_on = None


def upgrade():
    op.add_column("custom_roles", sa.Column("permissions", postgresql.ARRAY(sa.String(32)),
                                          nullable=False, server_default=sa.text("'{}'")))
    op.create_check_constraint("ck_custom_roles_permissions", "custom_roles",
        "permissions <@ ARRAY['zone.add','zone.edit','zone.delete','zone.export','zone.import']::varchar[] "
        "AND cardinality(permissions) <= 5 AND array_position(permissions, NULL) IS NULL")
    op.add_column("staff_profiles", sa.Column("custom_role_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("staff_profiles", sa.Column("workspace_login_enabled", sa.Boolean(), nullable=False,
                                             server_default=sa.false()))
    op.create_foreign_key("fk_staff_custom_role", "staff_profiles", "custom_roles",
                         ["custom_role_id"], ["id"], ondelete="RESTRICT")
    op.create_index("ix_staff_custom_role", "staff_profiles", ["custom_role_id"])


def downgrade():
    # A downgrade must never silently remove active authorization configuration.
    op.execute("""DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM staff_profiles WHERE workspace_login_enabled OR custom_role_id IS NOT NULL)
         OR EXISTS (SELECT 1 FROM custom_roles WHERE cardinality(permissions) > 0)
      THEN RAISE EXCEPTION 'Explicitly clear staff access and role grants before downgrade'; END IF;
    END $$""")
    op.drop_index("ix_staff_custom_role", table_name="staff_profiles")
    op.drop_constraint("fk_staff_custom_role", "staff_profiles", type_="foreignkey")
    op.drop_column("staff_profiles", "workspace_login_enabled")
    op.drop_column("staff_profiles", "custom_role_id")
    op.drop_constraint("ck_custom_roles_permissions", "custom_roles", type_="check")
    op.drop_column("custom_roles", "permissions")
