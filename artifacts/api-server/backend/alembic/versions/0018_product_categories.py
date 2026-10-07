"""Empty live catalogue, independent of all browser-local inventory."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0018_product_categories"
down_revision = "0017_headquarters"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "product_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.String(2000), nullable=False),
        sa.Column("unit_price", sa.Numeric(18, 6), nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.CheckConstraint("version >= 1", name="ck_product_category_version"),
        sa.CheckConstraint("status IN ('active', 'inactive')", name="ck_product_category_status"),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 200 AND name = btrim(name)", name="ck_product_category_name"),
        sa.CheckConstraint("length(description) <= 2000 AND description = btrim(description)", name="ck_product_category_description"),
        sa.CheckConstraint("unit_price >= 0 AND unit_price <= 999999999999.999999", name="ck_product_category_price"),
        sa.CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_product_category_deletion"),
    )
    op.create_index("uq_product_category_live_name", "product_categories",
                    [sa.text(r"lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))")],
                    unique=True, postgresql_where=sa.text("deleted_at IS NULL"))


def downgrade():
    op.drop_table("product_categories")
