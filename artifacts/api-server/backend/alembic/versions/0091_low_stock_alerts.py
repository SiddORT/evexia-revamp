"""Weekly low-stock recipient settings and durable delivery claims. No data seeds."""
from alembic import op
import sqlalchemy as sa

revision = "0091_low_stock_alerts"
down_revision = "0089_it_material_pricing"
branch_labels = depends_on = None


def upgrade():
    op.create_table("low_stock_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.CheckConstraint("id = 1 AND version > 0", name="ck_low_stock_singleton"))
    op.create_table("low_stock_settings_requests",
        sa.Column("key", sa.Uuid(), primary_key=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("version", sa.Integer()),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.CheckConstraint("state IN ('committed','cancelled')", name="ck_low_stock_request_state"))
    op.create_table("low_stock_weeks",
        sa.Column("week", sa.Date(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("low_stock_deliveries",
        sa.Column("week", sa.Date(), sa.ForeignKey("low_stock_weeks.week"), primary_key=True),
        sa.Column("recipient", sa.String(16), primary_key=True),
        sa.Column("token", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("destination_index", sa.String(64)),
        sa.Column("payload_ciphertext", sa.Text()),
        sa.Column("category", sa.String(64)),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('preparing','sending','accepted','unknown','failed','blocked','empty','duplicate')",
                           name="ck_low_stock_delivery_status"))


def downgrade():
    raise RuntimeError("Weekly claims must be retained to prevent duplicate deliveries.")
