"""Add recurring low-stock occurrence claims; retain all weekly history."""
from alembic import op
import sqlalchemy as sa

revision = "0092_low_stock_cron"
down_revision = "0091_low_stock_alerts"
branch_labels = depends_on = None


def upgrade():
    op.create_table("low_stock_schedule",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_low_stock_schedule_singleton"))
    op.create_table("low_stock_occurrences",
        sa.Column("scheduled_at", sa.DateTime(timezone=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("low_stock_occurrence_deliveries",
        sa.Column("scheduled_at", sa.DateTime(timezone=True),
                  sa.ForeignKey("low_stock_occurrences.scheduled_at"), primary_key=True),
        sa.Column("recipient", sa.String(32), primary_key=True),
        sa.Column("token", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("destination_index", sa.String(64)),
        sa.Column("payload_ciphertext", sa.Text()),
        sa.Column("category", sa.String(64)),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('preparing','sending','accepted','unknown','failed','blocked','empty','duplicate')",
                           name="ck_low_stock_occurrence_delivery_status"))


def downgrade():
    raise RuntimeError("Occurrence and legacy claims must be retained to prevent resends.")
