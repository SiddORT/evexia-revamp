"""Saved business assignments and ciphertext-only Vendor contact details."""
from alembic import context, op
import sqlalchemy as sa
from app.services import reference_privacy_migration as privacy
from app.services.directory_inventory import VENDOR_FIELDS

revision = "0036_reference_privacy"
down_revision = "0035_account_identifiers"
branch_labels = depends_on = None


def upgrade():
    connection = op.get_bind()
    crypto = privacy.prepare(connection, context.get_x_argument(as_dictionary=True))
    for table, fields in (("allergen_products", ("category_name", "storage_location_name")),
                          ("mr_directory", ("hq_name", "zone_name"))):
        for field in fields:
            op.add_column(table, sa.Column(field, sa.String(200), nullable=True))
    op.add_column("mr_directory", sa.Column("reporting_manager_name_ciphertext", sa.Text(), nullable=True))
    for field in VENDOR_FIELDS:
        op.add_column("vendors", sa.Column(field + "_ciphertext", sa.Text(), nullable=True))
    privacy.backfill(connection, crypto)
    # Validate deferred identity/relationship events before following DDL.
    # Keep guards enabled and the entire conversion in this transaction.
    connection.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
    for table, fields in (("allergen_products", ("category_name", "storage_location_name")),
                          ("mr_directory", ("hq_name", "zone_name"))):
        for field in fields:
            op.alter_column(table, field, nullable=False)
    op.create_check_constraint("ck_mr_manager_snapshot", "mr_directory",
                              '("reportingManagerId" IS NULL) = (reporting_manager_name_ciphertext IS NULL)')
    for field in VENDOR_FIELDS:
        op.alter_column("vendors", field + "_ciphertext", nullable=False)
        op.drop_constraint("ck_vendor_" + field + "_length", "vendors", type_="check")
    for name in ("ck_vendor_country", "ck_vendor_phone"):
        op.drop_constraint(name, "vendors", type_="check")
    for field in VENDOR_FIELDS:
        op.drop_column("vendors", field)


def downgrade():
    # Returning populated records to plaintext is not an automatic rollback.
    # Recover the previous reviewed release from its independent full backup.
    connection = op.get_bind()
    connection.execute(sa.text(
        "LOCK TABLE vendors, allergen_products, mr_directory IN ACCESS EXCLUSIVE MODE NOWAIT"))
    if any(connection.scalar(sa.text(f"SELECT EXISTS(SELECT 1 FROM {table})"))
           for table in ("vendors", "allergen_products", "mr_directory")):
        raise RuntimeError("Populated privacy downgrade refused; use reviewed backup recovery.")
    for field, length in privacy.VENDOR_LENGTHS.items():
        op.add_column("vendors", sa.Column(field, sa.String(length), nullable=False))
        op.create_check_constraint("ck_vendor_" + field + "_length", "vendors",
            f'length("{field}") BETWEEN 1 AND {length} AND "{field}"=btrim("{field}")')
        op.drop_column("vendors", field + "_ciphertext")
    from app.schemas.vendor_phone import VENDOR_COUNTRIES
    countries = ",".join("'" + country + "'" for country in VENDOR_COUNTRIES)
    op.create_check_constraint("ck_vendor_country", "vendors", f'"dialCountry" IN ({countries})')
    op.create_check_constraint("ck_vendor_phone", "vendors",
        '("dialCountry"=\'IN\' AND "phoneNo" ~ \'^[6-9][0-9]{9}$\') OR '
        '("dialCountry" IN (\'US\',\'GB\') AND "phoneNo" ~ \'^[0-9]{10}$\') OR '
        '("dialCountry"=\'AE\' AND "phoneNo" ~ \'^[0-9]{9}$\') OR '
        '("dialCountry" NOT IN (\'IN\',\'US\',\'GB\',\'AE\') AND "phoneNo" ~ \'^[0-9]{4,15}$\')')
    op.drop_constraint("ck_mr_manager_snapshot", "mr_directory", type_="check")
    op.drop_column("mr_directory", "reporting_manager_name_ciphertext")
    for table, fields in (("allergen_products", ("category_name", "storage_location_name")),
                          ("mr_directory", ("hq_name", "zone_name"))):
        for field in fields:
            op.drop_column(table, field)
