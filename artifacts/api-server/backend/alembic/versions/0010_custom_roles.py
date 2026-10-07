"""Non-tenant custom role metadata, without permissions or seed data."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0010_custom_roles"
down_revision = "0010_zones"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "custom_roles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("normalized_name", sa.String(100), sa.Computed("lower(btrim(name))", persisted=True)),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("normalized_name", name="uq_custom_roles_name"),
        sa.CheckConstraint("length(btrim(name)) BETWEEN 1 AND 100", name="ck_custom_roles_name"),
        sa.CheckConstraint("length(description) <= 1000", name="ck_custom_roles_description"),
        sa.CheckConstraint("version >= 1", name="ck_custom_roles_version"),
    )


def downgrade():
    raise RuntimeError("Custom roles migration is forward-only; restore an operator backup instead")
