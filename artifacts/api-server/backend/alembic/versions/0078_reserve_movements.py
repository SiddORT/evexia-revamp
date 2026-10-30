"""Reviewed reserve transfers and explicit inventory conversions."""
from alembic import op
import sqlalchemy as sa

revision = "0078_reserve_movements"
down_revision = "0077_settlements"
branch_labels = depends_on = None


def upgrade():
    op.create_table("in_house_postings",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("reserve_id", sa.UUID(), sa.ForeignKey("in_house_stock.id"), nullable=False),
        sa.Column("movement_id", sa.UUID(), sa.ForeignKey("inventory_movements.id"), nullable=False),
        sa.Column("location_id", sa.UUID(), sa.ForeignKey("storage_locations.id"), nullable=False),
        sa.Column("delta", sa.Numeric(), nullable=False),
        sa.Column("before", sa.Numeric(), nullable=False),
        sa.Column("after", sa.Numeric(), nullable=False),
        sa.UniqueConstraint("movement_id", "reserve_id", "location_id", name="uq_reserve_posting"),
        sa.CheckConstraint("delta <> 0 AND abs(delta) <= 1000000 AND delta = round(delta,3)", name="ck_reserve_delta"),
        sa.CheckConstraint("before >= 0 AND after >= 0 AND before <= 1000000 AND after <= 1000000 AND before = round(before,3) AND after = round(after,3) AND after = before + delta", name="ck_reserve_balance"))
    for column in ("reserve_id", "movement_id"):
        op.create_index(f"ix_in_house_postings_{column}", "in_house_postings", [column])
    for action in ("UPDATE OR DELETE", "TRUNCATE"):
        name = "immutable" if action != "TRUNCATE" else "no_truncate"
        scope = "ROW" if action != "TRUNCATE" else "STATEMENT"
        op.execute(f"CREATE TRIGGER in_house_postings_{name} BEFORE {action} ON in_house_postings FOR EACH {scope} EXECUTE FUNCTION inventory_immutable()")
    op.add_column("inventory_lots", sa.Column("reserve_movement_id", sa.UUID(), sa.ForeignKey("inventory_movements.id")))
    op.create_index("ix_inventory_lots_reserve_movement_id", "inventory_lots", ["reserve_movement_id"])
    # Preserve the exact predecessor predicate; allow only a separate new origin.
    predicate = op.get_bind().execute(sa.text(
        "SELECT pg_get_expr(conbin,conrelid) FROM pg_constraint WHERE conrelid='inventory_lots'::regclass AND conname='ck_inventory_item_identity'")).scalar_one()
    op.drop_constraint("ck_inventory_item_identity", "inventory_lots")
    op.create_check_constraint("ck_inventory_item_identity", "inventory_lots",
        f"(reserve_movement_id IS NULL AND ({predicate})) OR "
        "(reserve_movement_id IS NOT NULL AND product_id IS NOT NULL AND origin_id IS NOT NULL "
        "AND receipt_id IS NULL AND line_id IS NULL AND combo_id IS NULL AND assembly_id IS NULL "
        "AND opening_id IS NULL AND adjustment_id IS NULL AND accepted > 0)")
    op.execute("""
      CREATE FUNCTION reserve_lot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.reserve_movement_id IS NOT NULL OR (TG_OP <> 'DELETE' AND NEW.reserve_movement_id IS NOT NULL)
        THEN RAISE EXCEPTION 'Converted reserve lot is immutable'; END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER inventory_reserve_lot_immutable BEFORE UPDATE OR DELETE ON inventory_lots
      FOR EACH ROW EXECUTE FUNCTION reserve_lot_immutable();
    """)


def downgrade():
    raise RuntimeError("Committed reserve movements cannot be discarded")
