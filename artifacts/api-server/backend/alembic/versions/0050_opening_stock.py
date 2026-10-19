"""Physical opening sources and genuine unallocated balances in the shared ledger."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0050_opening_stock"
down_revision = "0049_product_language_merge"
branch_labels = depends_on = None


def upgrade():
    op.create_table("opening_stock",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("source_id", UUID, nullable=False, index=True),
        sa.Column("row_id", UUID, nullable=False),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("event_id", UUID, sa.ForeignKey("audit_events.id"), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=False),
        sa.UniqueConstraint("source_id", "row_id", name="uq_opening_source_row"),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_opening_cipher"))
    op.create_table("opening_stock_requests",
        sa.Column("key", UUID, primary_key=True),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=False),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_opening_request_cipher"))
    op.add_column("inventory_lots", sa.Column("opening_id", UUID, sa.ForeignKey("opening_stock.id"), unique=True))
    op.alter_column("inventory_lots", "origin_id", nullable=True)
    op.drop_constraint("ck_inventory_item_identity", "inventory_lots")
    op.create_check_constraint("ck_inventory_item_identity", "inventory_lots", """
      (opening_id IS NULL AND origin_id IS NOT NULL AND (
        (product_id IS NOT NULL AND receipt_id IS NOT NULL AND line_id IS NOT NULL AND combo_id IS NULL AND assembly_id IS NULL)
        OR (product_id IS NULL AND receipt_id IS NULL AND line_id IS NULL AND combo_id IS NOT NULL AND assembly_id IS NOT NULL
            AND accepted > 0 AND accepted = trunc(accepted))))
      OR (opening_id IS NOT NULL AND receipt_id IS NULL AND line_id IS NULL AND assembly_id IS NULL
          AND ((product_id IS NOT NULL AND combo_id IS NULL)
            OR (product_id IS NULL AND combo_id IS NOT NULL AND accepted = trunc(accepted)))
          AND accepted > 0)""")
    # A real nullable location, not a synthetic catalogue location. Surrogate
    # identity permits safe ORM updates of the NULL-location bucket.
    op.add_column("inventory_balances", sa.Column("id", UUID, server_default=sa.text("gen_random_uuid()"), nullable=False))
    op.drop_constraint("inventory_balances_pkey", "inventory_balances", type_="primary")
    op.alter_column("inventory_balances", "location_id", nullable=True)
    op.create_primary_key("inventory_balances_pkey", "inventory_balances", ["id"])
    op.execute("CREATE UNIQUE INDEX uq_inventory_balance_location ON inventory_balances (lot_id, location_id) NULLS NOT DISTINCT")
    op.alter_column("inventory_postings", "location_id", nullable=True)
    op.execute("CREATE UNIQUE INDEX uq_inventory_posting_unallocated ON inventory_postings (source_key, lot_id) WHERE location_id IS NULL")
    op.alter_column("inventory_movements", "source_id", nullable=True)
    op.drop_constraint("ck_inventory_distinct_locations", "inventory_movements")
    op.create_check_constraint("ck_inventory_distinct_locations", "inventory_movements",
                              "source_id IS DISTINCT FROM destination_id")
    for table in ("opening_stock", "opening_stock_requests"):
        op.execute(f"CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION inventory_immutable()")
        op.execute(f"CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE ON {table} FOR EACH STATEMENT EXECUTE FUNCTION inventory_immutable()")
    op.execute("""CREATE FUNCTION opening_lot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.opening_id IS NOT NULL THEN RAISE EXCEPTION 'Opening lot is immutable'; END IF;
        RETURN NEW;
      END $$""")
    op.execute("CREATE TRIGGER inventory_opening_immutable BEFORE UPDATE OR DELETE ON inventory_lots FOR EACH ROW EXECUTE FUNCTION opening_lot_immutable()")


def downgrade():
    # No historical evidence or NULL-location stock can be erased by downgrade.
    raise RuntimeError("Opening stock downgrade requires independently reviewed external recovery.")
