"""Shared exact portal hostname assignments."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0031_role_hostnames"
down_revision = "0030_directory_crypto_retirement"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "role_hostnames",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("hostname", sa.String(253), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("hostname", name="uq_role_hostnames_hostname"),
        sa.CheckConstraint("role IN ('admin', 'mr', 'doctor')", name="ck_role_hostnames_role"),
        sa.CheckConstraint("version >= 1", name="ck_role_hostnames_version"),
        sa.CheckConstraint("hostname = lower(hostname)", name="ck_role_hostnames_canonical"),
    )


def downgrade():
    op.drop_table("role_hostnames")
