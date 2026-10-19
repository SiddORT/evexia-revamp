"""Stock-enabled products extend the single inventory ledger; no stock seeding."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0047_stock_products"
down_revision = "0046_live_inventory"
branch_labels = depends_on = None


def upgrade():
    op.create_table("combo_products",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("name_key", sa.String(64), nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=False),
        sa.Column("created_by", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by", UUID, sa.ForeignKey("users.id")),
        sa.CheckConstraint("version >= 1 AND status IN ('active','inactive')", name="ck_combo_lifecycle"),
        sa.CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_combo_deletion"),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_combo_cipher"))
    op.create_index("uq_combo_live_name", "combo_products", ["name_key"], unique=True,
                    postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_table("combo_product_revisions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("product_id", UUID, sa.ForeignKey("combo_products.id"), nullable=False, index=True),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("event_id", UUID, sa.ForeignKey("audit_events.id"), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=False),
        sa.UniqueConstraint("product_id", "version", name="uq_combo_revision"),
        sa.CheckConstraint("version >= 1 AND payload_ciphertext LIKE 'v1:%'", name="ck_combo_revision_cipher"))
    op.create_table("combo_product_members",
        sa.Column("revision_id", UUID, sa.ForeignKey("combo_product_revisions.id"), primary_key=True),
        sa.Column("allergen_id", UUID, sa.ForeignKey("allergen_products.id"), primary_key=True),
        sa.Column("quantity", sa.Numeric(), nullable=False),
        sa.CheckConstraint("quantity > 0 AND quantity <= 1000000 AND quantity = round(quantity,3)", name="ck_combo_member_quantity"))
    op.create_table("product_assemblies",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("product_id", UUID, sa.ForeignKey("combo_products.id"), nullable=False, index=True),
        sa.Column("revision_id", UUID, sa.ForeignKey("combo_product_revisions.id"), nullable=False),
        sa.Column("location_id", UUID, sa.ForeignKey("storage_locations.id"), nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("event_id", UUID, sa.ForeignKey("audit_events.id"), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=False),
        sa.CheckConstraint("quantity BETWEEN 1 AND 1000000 AND payload_ciphertext LIKE 'v1:%'", name="ck_assembly_quantity_cipher"))
    op.create_table("product_requests",
        sa.Column("key", UUID, primary_key=True),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=False),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_product_request_cipher"))
    for column in ("receipt_id", "line_id", "product_id"):
        op.alter_column("inventory_lots", column, nullable=True)
    op.add_column("inventory_lots", sa.Column("combo_id", UUID, sa.ForeignKey("combo_products.id"), nullable=True))
    op.add_column("inventory_lots", sa.Column("assembly_id", UUID, sa.ForeignKey("product_assemblies.id"), nullable=True))
    op.create_index("ix_inventory_combo", "inventory_lots", ["combo_id"])
    op.create_index("uq_inventory_assembly", "inventory_lots", ["assembly_id"], unique=True)
    op.create_check_constraint("ck_inventory_item_identity", "inventory_lots", """
      (product_id IS NOT NULL AND receipt_id IS NOT NULL AND line_id IS NOT NULL AND combo_id IS NULL AND assembly_id IS NULL)
      OR (product_id IS NULL AND receipt_id IS NULL AND line_id IS NULL AND combo_id IS NOT NULL AND assembly_id IS NOT NULL
          AND accepted > 0 AND accepted = trunc(accepted))""")
    for table in ("combo_product_revisions", "combo_product_members", "product_assemblies", "product_requests"):
        op.execute(f"CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION inventory_immutable()")
        op.execute(f"CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE ON {table} FOR EACH STATEMENT EXECUTE FUNCTION inventory_immutable()")
    # Source lot identity is frozen after assembly consumption as well as moves.
    op.execute("""CREATE FUNCTION inventory_retained_lot() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.assembly_id IS NOT NULL THEN
          RAISE EXCEPTION 'Assembled lot identity is immutable';
        END IF;
        RETURN NEW;
      END $$""")
    op.execute("CREATE TRIGGER inventory_combo_immutable BEFORE UPDATE OR DELETE ON inventory_lots FOR EACH ROW EXECUTE FUNCTION inventory_retained_lot()")


def downgrade():
    for table in ("combo_products", "product_assemblies", "product_requests"):
        if op.get_bind().scalar(sa.text(f"SELECT EXISTS (SELECT 1 FROM {table})")):
            raise RuntimeError("Populated product history downgrade requires external recovery.")
    op.execute("DROP TRIGGER inventory_combo_immutable ON inventory_lots")
    op.execute("DROP FUNCTION inventory_retained_lot()")
    op.drop_constraint("ck_inventory_item_identity", "inventory_lots")
    op.drop_index("uq_inventory_assembly", table_name="inventory_lots")
    op.drop_index("ix_inventory_combo", table_name="inventory_lots")
    op.drop_column("inventory_lots", "assembly_id")
    op.drop_column("inventory_lots", "combo_id")
    for column in ("receipt_id", "line_id", "product_id"):
        op.alter_column("inventory_lots", column, nullable=False)
    for table in ("product_requests", "product_assemblies", "combo_product_members", "combo_product_revisions", "combo_products"):
        op.drop_table(table)
