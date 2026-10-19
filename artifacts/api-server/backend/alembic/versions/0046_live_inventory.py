"""Authoritative receipt-lot inventory. Operator-only additive successor."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0046_live_inventory"
down_revision = "0045_pr_batch_numbers"
branch_labels = depends_on = None


def upgrade():
    op.create_table("inventory_lots",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("receipt_id", UUID, sa.ForeignKey("purchase_receipts.id"), nullable=False, index=True),
        sa.Column("line_id", UUID, sa.ForeignKey("purchase_order_lines.id"), nullable=False),
        sa.Column("product_id", UUID, sa.ForeignKey("allergen_products.id"), nullable=False, index=True),
        sa.Column("origin_id", UUID, sa.ForeignKey("storage_locations.id"), nullable=False),
        sa.Column("accepted", sa.Numeric(), nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=False),
        sa.UniqueConstraint("receipt_id", "line_id", name="uq_inventory_receipt_line"),
        sa.CheckConstraint("accepted >= 0 AND accepted <= 1000000 AND accepted = round(accepted,3)", name="ck_inventory_accepted"),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_inventory_lot_cipher"))
    op.create_table("inventory_balances",
        sa.Column("lot_id", UUID, sa.ForeignKey("inventory_lots.id"), primary_key=True),
        sa.Column("location_id", UUID, sa.ForeignKey("storage_locations.id"), primary_key=True),
        sa.Column("quantity", sa.Numeric(), nullable=False),
        sa.CheckConstraint("quantity >= 0 AND quantity <= 1000000 AND quantity = round(quantity,3)", name="ck_inventory_nonnegative"))
    op.create_table("inventory_receipt_states",
        sa.Column("receipt_id", UUID, sa.ForeignKey("purchase_receipts.id"), primary_key=True),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("initialized_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("inventory_movements",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("source_id", UUID, sa.ForeignKey("storage_locations.id"), nullable=False, index=True),
        sa.Column("destination_id", UUID, sa.ForeignKey("storage_locations.id"), nullable=False, index=True),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("event_id", UUID, sa.ForeignKey("audit_events.id"), unique=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=False),
        sa.CheckConstraint("source_id <> destination_id", name="ck_inventory_distinct_locations"),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_inventory_movement_cipher"))
    op.create_table("inventory_postings",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("source_key", sa.String(100), nullable=False),
        sa.Column("lot_id", UUID, sa.ForeignKey("inventory_lots.id"), nullable=False, index=True),
        sa.Column("location_id", UUID, sa.ForeignKey("storage_locations.id"), nullable=False),
        sa.Column("movement_id", UUID, sa.ForeignKey("inventory_movements.id"), nullable=True, index=True),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("delta", sa.Numeric(), nullable=False),
        sa.Column("before", sa.Numeric(), nullable=False),
        sa.Column("after", sa.Numeric(), nullable=False),
        sa.UniqueConstraint("source_key", "lot_id", "location_id", name="uq_inventory_posting_source"),
        sa.CheckConstraint("delta <> 0 AND delta BETWEEN -1000000 AND 1000000 AND delta = round(delta,3)", name="ck_inventory_delta"),
        sa.CheckConstraint("before BETWEEN 0 AND 1000000 AND after BETWEEN 0 AND 1000000 AND before = round(before,3) AND after = round(after,3) AND after = before + delta", name="ck_inventory_posting_balance"))
    op.create_table("inventory_requests",
        sa.Column("key", UUID, primary_key=True),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=False),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_inventory_request_cipher"))
    # Business history and saved before/after evidence are append-only.
    op.execute("""CREATE FUNCTION inventory_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Inventory history is append-only'; END $$""")
    for table in ("inventory_movements", "inventory_postings", "inventory_requests"):
        op.execute(f"CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION inventory_immutable()")
        op.execute(f"CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE ON {table} FOR EACH STATEMENT EXECUTE FUNCTION inventory_immutable()")


def downgrade():
    for table in ("inventory_requests", "inventory_movements", "inventory_postings", "inventory_receipt_states", "inventory_balances", "inventory_lots"):
        if op.get_bind().scalar(sa.text(f"SELECT EXISTS (SELECT 1 FROM {table})")):
            raise RuntimeError("Inventory history requires reviewed external recovery; populated downgrade is refused.")
    for table in ("inventory_requests", "inventory_postings", "inventory_movements", "inventory_receipt_states", "inventory_balances", "inventory_lots"):
        op.drop_table(table)
    op.execute("DROP FUNCTION inventory_immutable()")
