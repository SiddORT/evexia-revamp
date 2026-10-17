"""Add encrypted receipt persistence. Operator approval required; no data import."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0044_purchase_received"
down_revision = "0043_email_templates"
branch_labels = depends_on = None


def upgrade():
    op.execute("CREATE SEQUENCE purchase_receipt_number_seq")
    op.create_table("purchase_receipts",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("number", sa.String(48), unique=True, nullable=False),
        *[sa.Column(name, UUID, sa.ForeignKey(target), nullable=nullable) for name, target, nullable in [
            ("po_id", "purchase_orders.id", False), ("vendor_id", "vendors.id", False),
            ("location_id", "storage_locations.id", False), ("staff_id", "staff_profiles.id", True)]],
        sa.Column("receiver_mode", sa.String(8), nullable=False),
        sa.Column("received_date", sa.Date, nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=False),
        *[sa.Column(f, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False) for f in ("created_at", "updated_at")],
        sa.CheckConstraint("status IN ('active','deleted') AND version >= 1", name="ck_pr_lifecycle"),
        sa.CheckConstraint("(receiver_mode = 'staff' AND staff_id IS NOT NULL) OR (receiver_mode = 'other' AND staff_id IS NULL)", name="ck_pr_receiver"),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_pr_ciphertext"))
    op.create_index("ix_pr_po", "purchase_receipts", ["po_id"])
    op.create_table("purchase_receipt_sources",
        sa.Column("receipt_id", UUID, sa.ForeignKey("purchase_receipts.id"), primary_key=True),
        sa.Column("line_id", UUID, sa.ForeignKey("purchase_order_lines.id"), primary_key=True),
        sa.Column("product_id", UUID, sa.ForeignKey("allergen_products.id"), nullable=False))
    op.create_table("purchase_receipt_history",
        sa.Column("event_id", UUID, sa.ForeignKey("audit_events.id"), primary_key=True),
        sa.Column("receipt_id", UUID, sa.ForeignKey("purchase_receipts.id"), nullable=False, index=True),
        sa.Column("payload_ciphertext", sa.Text, nullable=False))
    op.create_table("purchase_receipt_requests",
        sa.Column("key", UUID, primary_key=True),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=False))


def downgrade():
    for table in ("purchase_receipt_requests", "purchase_receipt_history", "purchase_receipt_sources", "purchase_receipts"):
        op.drop_table(table)
    op.execute("DROP SEQUENCE purchase_receipt_number_seq")
