"""Forward-only current catalogue normalization; no historical snapshots touched."""
from alembic import op
import sqlalchemy as sa

revision = "0042_rate_hundredths"
down_revision = "0041_location_geography"
branch_labels = depends_on = None


def upgrade():
    connection = op.get_bind()
    # Operator must stop ALL writers first. Locks and transactional DDL protect
    # the final preflight and rewrite; no identities or human actors are invented.
    connection.execute(sa.text("LOCK TABLE product_categories, allergen_products IN ACCESS EXCLUSIVE MODE"))
    for table, expression in (
        ("product_categories", "unit_price < 0 OR unit_price > 999999999999.999999 OR round(unit_price, 2) > 999999999999.99"),
        ("allergen_products", "selling_price < 0 OR selling_price > 999999999999.999999 OR round(selling_price, 2) > 999999999999.99 OR gst < 0 OR gst > 100"),
    ):
        if connection.execute(sa.text(
            f"SELECT count(*) FROM {table} WHERE ({expression}) OR version >= 2147483647"
        )).scalar_one():
            raise RuntimeError("Rate preflight failed: out-of-range rounded rates or exhausted concurrency versions. Resolve under separate approval.")
    # Use unconstrained NUMERIC so CHECKs see the original precision of future
    # direct writes, rather than PostgreSQL silently coercing NUMERIC(p,2).
    op.drop_constraint("ck_product_category_price", "product_categories")
    op.drop_constraint("ck_allergen_price", "allergen_products")
    op.drop_constraint("ck_allergen_gst", "allergen_products")
    op.alter_column("product_categories", "unit_price", type_=sa.Numeric(), postgresql_using="unit_price::numeric")
    op.alter_column("allergen_products", "selling_price", type_=sa.Numeric(), postgresql_using="selling_price::numeric")
    op.alter_column("allergen_products", "gst", type_=sa.Numeric(), postgresql_using="gst::numeric")
    # PostgreSQL numeric round rounds positive halfway cases away from zero:
    # exactly HALF_UP for these nonnegative values. All versions advance,
    # including unchanged/tombstoned rows, invalidating every predecessor draft.
    connection.execute(sa.text(
        "UPDATE product_categories SET unit_price = round(unit_price, 2), version = version + 1, updated_at = CURRENT_TIMESTAMP"))
    connection.execute(sa.text(
        "UPDATE allergen_products SET selling_price = round(selling_price, 2), gst = round(gst, 2), "
        "version = version + 1, updated_at = CURRENT_TIMESTAMP"))
    op.create_check_constraint("ck_product_category_price", "product_categories",
                               "unit_price >= 0 AND unit_price <= 999999999999.99 AND unit_price = round(unit_price, 2)")
    op.create_check_constraint("ck_allergen_price", "allergen_products",
                               "selling_price >= 0 AND selling_price <= 999999999999.99 AND selling_price = round(selling_price, 2)")
    op.create_check_constraint("ck_allergen_gst", "allergen_products",
                               "gst >= 0 AND gst <= 100 AND gst = round(gst, 2)")


def downgrade():
    raise RuntimeError("Rate rounding is irreversible. Restore the approved external backup with coordinated predecessor code; never reconstruct discarded digits.")
