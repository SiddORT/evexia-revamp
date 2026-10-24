"""Reasoned append-only adjustments in the authoritative inventory ledger."""
from alembic import op
import sqlalchemy as sa

revision = "0067_inventory_adjustments"
down_revision = "0066_spt_registration_owner"
branch_labels = depends_on = None


def upgrade():
    op.create_table("inventory_adjustments",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("product_id", sa.UUID(), sa.ForeignKey("allergen_products.id"), nullable=False),
        sa.Column("location_id", sa.UUID(), sa.ForeignKey("storage_locations.id")),
        sa.Column("direction", sa.String(6), nullable=False),
        sa.Column("quantity", sa.Numeric(), nullable=False),
        sa.Column("actor_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("event_id", sa.UUID(), sa.ForeignKey("audit_events.id"), nullable=False, unique=True),
        sa.Column("correction_of", sa.UUID(), sa.ForeignKey("inventory_adjustments.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.CheckConstraint("direction IN ('add','reduce')", name="ck_adjustment_direction"),
        sa.CheckConstraint("quantity > 0 AND quantity <= 1000000 AND quantity = round(quantity,3)", name="ck_adjustment_quantity"))
    op.create_index("ix_inventory_adjustments_product_id", "inventory_adjustments", ["product_id"])
    op.add_column("inventory_lots", sa.Column("adjustment_id", sa.UUID(), sa.ForeignKey("inventory_adjustments.id"), unique=True))
    op.drop_constraint("ck_inventory_item_identity", "inventory_lots")
    op.create_check_constraint("ck_inventory_item_identity", "inventory_lots", """
      (adjustment_id IS NOT NULL AND product_id IS NOT NULL AND origin_id IS NOT NULL
        AND receipt_id IS NULL AND line_id IS NULL AND combo_id IS NULL AND assembly_id IS NULL
        AND opening_id IS NULL AND accepted > 0)
      OR (adjustment_id IS NULL AND (
        (opening_id IS NULL AND origin_id IS NOT NULL AND (
          (product_id IS NOT NULL AND receipt_id IS NOT NULL AND line_id IS NOT NULL AND combo_id IS NULL AND assembly_id IS NULL)
          OR (product_id IS NULL AND receipt_id IS NULL AND line_id IS NULL AND combo_id IS NOT NULL AND assembly_id IS NOT NULL
              AND accepted > 0 AND accepted = trunc(accepted))))
        OR (opening_id IS NOT NULL AND receipt_id IS NULL AND line_id IS NULL AND assembly_id IS NULL
            AND ((product_id IS NOT NULL AND combo_id IS NULL)
              OR (product_id IS NULL AND combo_id IS NOT NULL AND accepted = trunc(accepted)))
            AND accepted > 0)))""")
    op.create_check_constraint("ck_inventory_adjustment_origin", "inventory_lots",
        "adjustment_id IS NULL OR (receipt_id IS NULL AND line_id IS NULL AND opening_id IS NULL AND assembly_id IS NULL AND combo_id IS NULL AND product_id IS NOT NULL AND origin_id IS NOT NULL)")
    op.create_table("inventory_adjustment_requests",
        sa.Column("key", sa.UUID(), primary_key=True),
        sa.Column("actor_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False))
    op.execute("""
      CREATE FUNCTION evexia_adjustment_guard() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' OR ROW(NEW.id,NEW.product_id,NEW.location_id,NEW.direction,
          NEW.quantity,NEW.actor_id,NEW.event_id,NEW.correction_of,NEW.created_at)
          IS DISTINCT FROM ROW(OLD.id,OLD.product_id,OLD.location_id,OLD.direction,
          OLD.quantity,OLD.actor_id,OLD.event_id,OLD.correction_of,OLD.created_at)
          OR NEW.payload_ciphertext IS DISTINCT FROM OLD.payload_ciphertext
        THEN RAISE EXCEPTION 'inventory adjustment is immutable' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_inventory_adjustment_guard BEFORE UPDATE OR DELETE ON inventory_adjustments
        FOR EACH ROW EXECUTE FUNCTION evexia_adjustment_guard();
    """)
    for table in ("inventory_adjustments", "inventory_adjustment_requests"):
        op.execute(f"CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE ON {table} FOR EACH STATEMENT EXECUTE FUNCTION inventory_immutable()")
    op.execute("CREATE TRIGGER inventory_adjustment_requests_immutable BEFORE UPDATE OR DELETE ON inventory_adjustment_requests FOR EACH ROW EXECUTE FUNCTION inventory_immutable()")
    op.execute("""
      CREATE FUNCTION adjustment_lot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.adjustment_id IS NOT NULL OR (TG_OP <> 'DELETE' AND NEW.adjustment_id IS NOT NULL)
        THEN RAISE EXCEPTION 'Adjustment lot is immutable'; END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER inventory_adjustment_lot_immutable BEFORE UPDATE OR DELETE ON inventory_lots
        FOR EACH ROW EXECUTE FUNCTION adjustment_lot_immutable();
    """)


def downgrade():
    raise RuntimeError("Committed inventory adjustments cannot be discarded")
