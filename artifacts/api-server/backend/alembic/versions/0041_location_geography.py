"""Optional structured storage geography. No address inference or backfill."""
from alembic import op
import sqlalchemy as sa

revision = "0041_location_geography"
down_revision = "0040_po_tax_basis"
branch_labels = depends_on = None


def upgrade():
    for name, length in (("pincode", 20), ("country_code", 2), ("state", 100), ("city", 100)):
        op.add_column("storage_locations", sa.Column(name, sa.String(length), nullable=False, server_default=""))
    op.create_check_constraint("ck_location_country_code", "storage_locations",
                               "country_code = '' OR country_code ~ '^[A-Z]{2}$'")


def downgrade():
    # Do not silently discard geography that may be needed for future orders.
    connection = op.get_bind()
    if connection.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM storage_locations WHERE "
        "pincode <> '' OR country_code <> '' OR state <> '' OR city <> '')"
    )).scalar_one():
        raise RuntimeError("Archive structured location geography before downgrade.")
    op.drop_constraint("ck_location_country_code", "storage_locations")
    for name in ("city", "state", "country_code", "pincode"):
        op.drop_column("storage_locations", name)
