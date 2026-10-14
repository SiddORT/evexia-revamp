"""Exact-host ownership and explicit admission; legacy mappings remain unverified."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0037_domain_admission"
down_revision = "0036_reference_privacy"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "domain_policies",
        sa.Column("id", UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("hostname", sa.String(253), primary_key=True),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("challenge", sa.String(100)),
        *[sa.Column(name, sa.DateTime(timezone=True)) for name in (
            "challenge_expires_at", "verified_at", "verification_expires_at", "last_checked_at")],
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("version >= 1", name="ck_domain_version"),
        sa.CheckConstraint("kind IN ('primary', 'role')", name="ck_domain_kind"),
    )
    op.create_index("uq_single_primary_domain", "domain_policies", ["kind"], unique=True,
                    postgresql_where=sa.text("kind = 'primary'"))


def downgrade():
    op.drop_table("domain_policies")
