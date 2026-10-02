"""Add explicit non-tenant system identities and minimal MR/patient domain.

Revision ID: 0003_system_domain
Revises: 0002_username
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0003_system_domain"
down_revision = "0002_username"
branch_labels = None
depends_on = None


def upgrade():
    # Existing organization/membership rows and old refresh organization values are
    # retained as history. Existing users deliberately remain unmapped.
    op.add_column("users", sa.Column("system_role", sa.String(20), nullable=True))
    op.add_column(
        "users",
        sa.Column("identity_version", sa.Integer(), server_default="0", nullable=False),
    )
    op.alter_column("users", "identity_version", server_default=None)
    op.create_check_constraint(
        "ck_users_system_role", "users",
        "system_role IS NULL OR system_role IN ('super_admin', 'mr')",
    )
    op.create_check_constraint("ck_users_identity_version", "users", "identity_version >= 0")

    op.alter_column("refresh_sessions", "organization_id", existing_type=UUID(as_uuid=True), nullable=True)
    op.add_column(
        "refresh_sessions",
        sa.Column("identity_version", sa.Integer(), server_default="0", nullable=False),
    )
    op.alter_column("refresh_sessions", "identity_version", server_default=None)
    op.create_check_constraint(
        "ck_refresh_sessions_identity_version", "refresh_sessions", "identity_version >= 0",
    )

    op.create_table(
        "mr_profiles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", name="uq_mr_profiles_user"),
    )
    op.create_index("ix_mr_profiles_user_id", "mr_profiles", ["user_id"])
    op.create_table(
        "patients",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("assigned_mr_id", UUID(as_uuid=True), sa.ForeignKey("mr_profiles.id"), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("version >= 1", name="ck_patients_version"),
    )
    op.create_index("ix_patients_assigned_mr_id", "patients", ["assigned_mr_id"])


def downgrade():
    connection = op.get_bind()
    system_data = connection.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM users WHERE system_role IS NOT NULL) "
        "OR EXISTS (SELECT 1 FROM mr_profiles) "
        "OR EXISTS (SELECT 1 FROM patients) "
        "OR EXISTS (SELECT 1 FROM refresh_sessions WHERE organization_id IS NULL)"
    )).scalar()
    if system_data:
        raise RuntimeError(
            "Cannot downgrade system identities/domain rows in place; export and review them first"
        )
    op.drop_index("ix_patients_assigned_mr_id", table_name="patients")
    op.drop_table("patients")
    op.drop_index("ix_mr_profiles_user_id", table_name="mr_profiles")
    op.drop_table("mr_profiles")
    op.drop_constraint("ck_refresh_sessions_identity_version", "refresh_sessions", type_="check")
    op.drop_column("refresh_sessions", "identity_version")
    op.alter_column("refresh_sessions", "organization_id", existing_type=UUID(as_uuid=True), nullable=False)
    op.drop_constraint("ck_users_identity_version", "users", type_="check")
    op.drop_constraint("ck_users_system_role", "users", type_="check")
    op.drop_column("users", "identity_version")
    op.drop_column("users", "system_role")