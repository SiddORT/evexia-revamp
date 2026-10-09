"""Empty shared Allergen catalogue; no legacy browser migration or grants."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0022_allergen_catalogue"
down_revision = "0022_vendors"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "allergen_products",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("product_categories.id"), nullable=False),
        sa.Column("storage_location_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("storage_locations.id"), nullable=False),
        sa.Column("selling_price", sa.Numeric(18, 6)),
        sa.Column("gst", sa.Numeric(9, 6), nullable=False),
        sa.Column("concentration", sa.String(200), nullable=False),
        sa.Column("threshold_limit", sa.Numeric(18, 6)),
        sa.Column("mix", sa.Boolean, nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.CheckConstraint("version >= 1", name="ck_allergen_version"),
        sa.CheckConstraint("status IN ('active', 'inactive')", name="ck_allergen_status"),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 200 AND name = btrim(name)", name="ck_allergen_name"),
        sa.CheckConstraint("length(concentration) BETWEEN 1 AND 200 AND concentration = btrim(concentration)", name="ck_allergen_concentration"),
        sa.CheckConstraint("selling_price >= 0 AND selling_price <= 999999999999.999999", name="ck_allergen_price"),
        sa.CheckConstraint("gst >= 0 AND gst <= 100", name="ck_allergen_gst"),
        sa.CheckConstraint("threshold_limit >= 0 AND threshold_limit <= 999999999999.999999", name="ck_allergen_threshold"),
        sa.CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_allergen_deletion"),
    )
    op.create_index("uq_allergen_live_name", "allergen_products",
                    [sa.text(r"lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))")],
                    unique=True, postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("ix_allergen_live_order", "allergen_products",
                    [sa.text("created_at DESC"), sa.text("id DESC")], postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("ix_allergen_products_category_id", "allergen_products", ["category_id"])
    op.create_index("ix_allergen_products_storage_location_id", "allergen_products", ["storage_location_id"])


def downgrade():
    op.drop_table("allergen_products")
