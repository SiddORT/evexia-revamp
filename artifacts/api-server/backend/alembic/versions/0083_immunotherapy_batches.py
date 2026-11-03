"""Monthly final-placement counters only; no historical order backfill."""
from alembic import op
import sqlalchemy as sa

revision = "0083_immunotherapy_batches"
down_revision = "0082_order_drafts"
branch_labels = depends_on = None


def upgrade():
    op.create_table("immunotherapy_batch_counters",
        sa.Column("month", sa.Date(), primary_key=True),
        sa.Column("last_ordinal", sa.Numeric(), nullable=False),
        sa.CheckConstraint("EXTRACT(DAY FROM month) = 1", name="ck_imm_batch_month"),
        sa.CheckConstraint("last_ordinal > 0 AND last_ordinal = trunc(last_ordinal)",
                           name="ck_imm_batch_ordinal"))


def downgrade():
    raise RuntimeError("Issued batch high-water marks must not be discarded or recycled.")
