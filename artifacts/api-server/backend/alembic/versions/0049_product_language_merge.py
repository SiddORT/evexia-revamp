"""Join preserved stock-product and Unicode language migration histories."""
revision = "0049_product_language_merge"
down_revision = ("0047_stock_products", "0048_language_unicode")
branch_labels = depends_on = None


def upgrade():
    # Both independent histories must be applied; neither is rewritten.
    pass


def downgrade():
    pass
