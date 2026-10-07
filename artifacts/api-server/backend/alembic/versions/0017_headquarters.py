"""Empty HQ catalogue; no seeding, relationships or identity changes."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0017_headquarters"
down_revision = "0016_designations"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "headquarters",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("state_code", sa.String(16), nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.CheckConstraint("version >= 1", name="ck_headquarter_version"),
        sa.CheckConstraint("status IN ('active', 'inactive')", name="ck_headquarter_status"),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 200 AND name = btrim(name)", name="ck_headquarter_name"),
        sa.CheckConstraint("length(state_code) BETWEEN 1 AND 16 AND state_code = btrim(state_code) AND state_code = upper(state_code)", name="ck_headquarter_code"),
        sa.CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_headquarter_deletion"),
    )
    op.create_index("uq_headquarter_live_name", "headquarters",
                    [sa.text(r"lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))")],
                    unique=True, postgresql_where=sa.text("deleted_at IS NULL"))


def downgrade():
    op.drop_table("headquarters")
