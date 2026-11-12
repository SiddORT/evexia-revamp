"""Retained-evidence hundredths boundary; normal automatic migration policy."""
from alembic import op
import sqlalchemy as sa

revision = "0092_quantity_hundredths"
# Follow the currently declared Language target, not staged Cron activation.
down_revision = "0093_language_status"
branch_labels = depends_on = None


def upgrade():
    from app.services.quantity_precision_transition import prepare, apply
    connection = op.get_bind()
    # Preflight authenticates the complete predecessor before DDL or data changes.
    prepared = prepare(connection)
    op.create_table("quantity_precision_boundary",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("policy", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("evidence_digest", sa.String(64), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.CheckConstraint("id=1", name="ck_quantity_precision_singleton"))
    op.create_table("quantity_precision_locations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("location_key", sa.String(36), nullable=False),
        sa.Column("original", sa.Numeric(), nullable=False),
        sa.Column("normalized", sa.Numeric(), nullable=False),
        sa.Column("residual", sa.Numeric(), nullable=False),
        sa.UniqueConstraint("kind", "owner_id", "location_key", name="uq_quantity_precision_location"),
        sa.CheckConstraint("kind IN ('inventory','reserve','source') AND normalized=round(normalized,2) AND normalized>=0 AND normalized<=1000000 AND normalized=original+residual",
                           name="ck_quantity_precision_location"))
    op.create_table("quantity_precision_snapshots",
        sa.Column("purpose", sa.String(80), primary_key=True),
        sa.Column("record_id", sa.Uuid(), primary_key=True),
        sa.Column("original_digest", sa.String(64), nullable=False),
        sa.Column("original_ciphertext", sa.Text(), nullable=False),
        sa.Column("normalized_ciphertext", sa.Text(), nullable=False))
    op.create_table("quantity_precision_thresholds",
        sa.Column("allergen_id", sa.Uuid(), sa.ForeignKey("allergen_products.id"), primary_key=True),
        sa.Column("original", sa.Numeric(), nullable=False),
        sa.Column("normalized", sa.Numeric(), nullable=False),
        sa.Column("residual", sa.Numeric(), nullable=False),
        sa.CheckConstraint("normalized=round(normalized,2) AND normalized=original+residual", name="ck_quantity_precision_threshold"))
    apply(connection, prepared)
    for table in ("inventory_postings", "in_house_postings"):
        op.add_column(table, sa.Column("precision_epoch", sa.Integer(), nullable=False, server_default="1"))
        op.alter_column(table, "precision_epoch", server_default="2")
        op.create_check_constraint(f"ck_{table}_precision_epoch", table, "precision_epoch IN (1,2)")
    op.drop_constraint("ck_inventory_nonnegative", "inventory_balances")
    op.create_check_constraint("ck_inventory_nonnegative", "inventory_balances",
                               "quantity>=0 AND quantity<=1000000 AND quantity=round(quantity,2)")
    # Existing immutable thousandth originals remain valid. New evidence must be
    # canonical hundredths; claiming epoch 1 cannot bypass this insertion guard.
    op.execute("""
      CREATE FUNCTION guard_quantity_hundredths() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE value numeric; name text; fields text[];
      BEGIN
        IF TG_TABLE_NAME IN ('inventory_postings','in_house_postings') THEN
          IF NEW.precision_epoch <> 2 THEN RAISE EXCEPTION 'New postings require quantity epoch 2'; END IF;
          fields := ARRAY['delta','before','after'];
        ELSIF TG_TABLE_NAME='inventory_lots' THEN
          IF TG_OP='UPDATE' AND NEW.accepted IS NOT DISTINCT FROM OLD.accepted THEN RETURN NEW; END IF;
          fields := ARRAY['accepted'];
        ELSE fields := ARRAY['quantity']; END IF;
        FOREACH name IN ARRAY fields LOOP
          value := (to_jsonb(NEW)->>name)::numeric;
          IF value IS NULL OR value <> round(value,2) THEN
            RAISE EXCEPTION 'New business quantities must be exact hundredths';
          END IF;
        END LOOP;
        RETURN NEW;
      END $$;
    """)
    for table in ("inventory_postings", "in_house_postings", "inventory_lots", "inventory_adjustments", "combo_product_members"):
        event = "INSERT OR UPDATE" if table == "inventory_lots" else "INSERT"
        op.execute(f"CREATE TRIGGER quantity_hundredths BEFORE {event} ON {table} FOR EACH ROW EXECUTE FUNCTION guard_quantity_hundredths()")
    for table in ("quantity_precision_boundary", "quantity_precision_locations", "quantity_precision_snapshots", "quantity_precision_thresholds"):
        op.execute(f"CREATE TRIGGER quantity_precision_immutable BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION inventory_immutable()")
        op.execute(f"CREATE TRIGGER quantity_precision_no_truncate BEFORE TRUNCATE ON {table} FOR EACH STATEMENT EXECUTE FUNCTION inventory_immutable()")


def downgrade():
    raise RuntimeError("Quantity precision is forward-only. Restore independently verified original recovery evidence; never rewrite immutable history.")
