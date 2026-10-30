"""Append-only settlements, initially empty regardless of order payment flags."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0077_settlements"
down_revision = "0076_in_house_stock"
branch_labels = depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    uid = postgresql.UUID(as_uuid=True)
    op.create_table("settlement_batches",
        sa.Column("id", uid, primary_key=True),
        sa.Column("actor_id", uid, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("mr_id", uid, sa.ForeignKey("mr_directory.id"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_settlement_batch_cipher"))
    op.create_index("ix_settlement_batches_date", "settlement_batches", ["date"])
    op.create_table("settlement_entries",
        sa.Column("id", uid, primary_key=True),
        sa.Column("batch_id", uid, sa.ForeignKey("settlement_batches.id"), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("order_id", uid, nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True)),
        sa.Column("verified_by", uid, sa.ForeignKey("users.id")),
        sa.UniqueConstraint("batch_id", "kind", "order_id", name="uq_settlement_batch_order"),
        sa.CheckConstraint("kind IN ('IT','Kit','SPT','Lupin')", name="ck_settlement_kind"),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_settlement_entry_cipher"),
        sa.CheckConstraint("(verified_at IS NULL) = (verified_by IS NULL)", name="ck_settlement_verification"))
    op.create_index("ix_settlement_entries_batch_id", "settlement_entries", ["batch_id"])
    op.create_index("ix_settlement_order", "settlement_entries", ["kind", "order_id"])
    op.create_table("settlement_rejections",
        sa.Column("id", uid, primary_key=True),
        sa.Column("actor_id", uid, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("mr_id", uid, sa.ForeignKey("mr_directory.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_settlement_rejection_cipher"))
    op.execute("""
      CREATE FUNCTION guard_settlement_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Settlement transactions are immutable'; END $$;
      CREATE TRIGGER settlement_batches_immutable BEFORE UPDATE OR DELETE ON settlement_batches
        FOR EACH ROW EXECUTE FUNCTION guard_settlement_immutable();
      CREATE TRIGGER settlement_entries_immutable BEFORE UPDATE OR DELETE ON settlement_entries
        FOR EACH ROW EXECUTE FUNCTION guard_settlement_immutable();
      CREATE TRIGGER settlement_rejections_immutable BEFORE UPDATE OR DELETE ON settlement_rejections
        FOR EACH ROW EXECUTE FUNCTION guard_settlement_immutable();
      CREATE FUNCTION guard_settlement_reference() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE source_table text; found_id uuid;
      BEGIN
        source_table := CASE NEW.kind WHEN 'IT' THEN 'immunotherapy_orders'
          WHEN 'Kit' THEN 'kits_orders' WHEN 'SPT' THEN 'spt_orders'
          WHEN 'Lupin' THEN 'lupin_orders' END;
        IF source_table IS NULL THEN RAISE EXCEPTION 'Invalid settlement order type'; END IF;
        EXECUTE format('SELECT id FROM %I WHERE id=$1 FOR KEY SHARE', source_table)
          INTO found_id USING NEW.order_id;
        IF found_id IS NULL THEN RAISE EXCEPTION 'Settlement order is missing'; END IF;
        IF NEW.verified_at IS NOT NULL OR NEW.verified_by IS NOT NULL THEN
          RAISE EXCEPTION 'Settlement verification requires a separately approved workflow';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER settlement_reference BEFORE INSERT ON settlement_entries
        FOR EACH ROW EXECUTE FUNCTION guard_settlement_reference();
    """)


def downgrade():
    raise RuntimeError("Settlement payment history is immutable; destructive downgrade is unsupported.")
