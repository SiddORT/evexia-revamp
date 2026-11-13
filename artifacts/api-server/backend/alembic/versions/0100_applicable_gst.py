"""Applicable GST: append-only policy, preserving the legacy opening source."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0100_applicable_gst"
down_revision = "0098_opening_corrections"
branch_labels = depends_on = None


def upgrade():
    op.create_table("gst_policy_revisions",
        sa.Column("version", sa.Integer, primary_key=True),
        sa.Column("request_id", UUID, nullable=False, unique=True),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("actor_label", sa.String(64), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("payload", JSONB, nullable=False),
        sa.CheckConstraint("version BETWEEN 1 AND 2147483647", name="ck_gst_policy_version"))
    op.execute("CREATE TRIGGER gst_policy_immutable BEFORE UPDATE OR DELETE ON gst_policy_revisions FOR EACH ROW EXECUTE FUNCTION inventory_immutable()")
    op.execute("CREATE TRIGGER gst_policy_no_truncate BEFORE TRUNCATE ON gst_policy_revisions FOR EACH STATEMENT EXECUTE FUNCTION inventory_immutable()")
    # No policy/order seeding, legacy mutation or financial backfill.


def downgrade():
    raise RuntimeError("GST policy history is immutable; use independently reviewed recovery.")
