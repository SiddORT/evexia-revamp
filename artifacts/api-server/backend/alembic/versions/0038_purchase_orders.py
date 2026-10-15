"""Shared purchase orders and audit metadata. Operator activation required."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0038_purchase_orders"
down_revision = "0037_domain_admission"
branch_labels = depends_on = None


def upgrade():
    op.execute("CREATE SEQUENCE purchase_order_number_seq")
    op.create_table("purchase_orders",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("number", sa.String(48), nullable=False, unique=True),
        sa.Column("vendor_id", UUID, sa.ForeignKey("vendors.id"), nullable=False),
        sa.Column("location_id", UUID, sa.ForeignKey("storage_locations.id"), nullable=False),
        sa.Column("vendor_name", sa.String(200), nullable=False),
        sa.Column("location_name", sa.String(200), nullable=False),
        sa.Column("po_date", sa.Date, nullable=False),
        sa.Column("expected_date", sa.Date, nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        *[sa.Column(n, sa.BigInteger, nullable=False) for n in ("subtotal", "gst_amount", "total")],
        sa.Column("created_by", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("deleted_at", sa.String(40)),
        *[sa.Column(n, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False)
          for n in ("created_at", "updated_at")],
        sa.CheckConstraint("version >= 1", name="ck_po_version"),
        sa.CheckConstraint("status IN ('open','deleted')", name="ck_po_status"),
        sa.CheckConstraint("total >= 0 AND total <= 10000000000", name="ck_po_total"),
        sa.CheckConstraint("expected_date >= po_date", name="ck_po_dates"))
    for field in ("vendor_id", "po_date", "status"):
        op.create_index(f"ix_purchase_orders_{field}", "purchase_orders", [field])
    op.create_table("purchase_order_lines",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("order_id", UUID, sa.ForeignKey("purchase_orders.id"), nullable=False),
        sa.Column("product_id", UUID, sa.ForeignKey("allergen_products.id"), nullable=False),
        sa.Column("position", sa.Integer, nullable=False),
        sa.Column("snapshot", sa.JSON, nullable=False))
    for field in ("order_id", "product_id"):
        op.create_index(f"ix_purchase_order_lines_{field}", "purchase_order_lines", [field])
    op.create_table("purchase_order_audit",
        sa.Column("event_id", UUID, sa.ForeignKey("audit_events.id"), primary_key=True),
        sa.Column("order_id", UUID, sa.ForeignKey("purchase_orders.id"), nullable=False),
        sa.Column("number", sa.String(48), nullable=False),
        sa.Column("action", sa.String(8), nullable=False),
        sa.Column("summary", sa.String(2000), nullable=False),
        sa.Column("actor", sa.String(320), nullable=False))
    op.create_index("ix_purchase_order_audit_order_id", "purchase_order_audit", ["order_id"])
    op.create_table("purchase_order_requests",
        sa.Column("key", UUID, primary_key=True),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("response", sa.JSON, nullable=False))


def downgrade():
    for name in ("purchase_order_requests", "purchase_order_audit", "purchase_order_lines", "purchase_orders"):
        op.drop_table(name)
    op.execute("DROP SEQUENCE purchase_order_number_seq")
