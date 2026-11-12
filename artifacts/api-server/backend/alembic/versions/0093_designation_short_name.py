"""Permit optional designation short names without rewriting any saved values."""
from alembic import op
import sqlalchemy as sa

revision = "0093_designation_short_name"
down_revision = "0094_language_low_stock_merge"
branch_labels = depends_on = None


def upgrade():
    op.drop_constraint("ck_designation_short_name", "designations", type_="check")
    op.create_check_constraint(
        "ck_designation_short_name", "designations",
        'length("shortName") BETWEEN 0 AND 50 AND "shortName" = btrim("shortName")')


def downgrade():
    # Serialize with writers and refuse rather than invent abbreviations or lose
    # rows (including deleted history) that the predecessor cannot represent.
    connection = op.get_bind()
    connection.execute(sa.text("LOCK TABLE designations IN ACCESS EXCLUSIVE MODE"))
    if connection.scalar(sa.text('SELECT EXISTS (SELECT 1 FROM designations WHERE "shortName" = \'\')')):
        raise RuntimeError("Blank designation short names exist; downgrade would invalidate saved data.")
    op.drop_constraint("ck_designation_short_name", "designations", type_="check")
    op.create_check_constraint(
        "ck_designation_short_name", "designations",
        'length("shortName") BETWEEN 1 AND 50 AND "shortName" = btrim("shortName")')
