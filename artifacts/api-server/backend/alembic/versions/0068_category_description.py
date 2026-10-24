"""Preserve free-text description whitespace accepted by the category API."""
from alembic import op
import sqlalchemy as sa

revision = "0068_category_description"
down_revision = "0067_inventory_adjustments"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint("ck_product_category_description", "product_categories", type_="check")
    op.create_check_constraint("ck_product_category_description", "product_categories",
                               "length(description) <= 2000")


def downgrade():
    if op.get_bind().scalar(sa.text(
            "SELECT EXISTS (SELECT 1 FROM product_categories WHERE description <> btrim(description))")):
        raise RuntimeError("Retain authored category descriptions before restoring the historical trim constraint")
    op.drop_constraint("ck_product_category_description", "product_categories", type_="check")
    op.create_check_constraint("ck_product_category_description", "product_categories",
                               "length(description) <= 2000 AND description = btrim(description)")
