"""Empty server vendors, separate from browser procurement IDs."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0022_vendors"
down_revision = "0021_master_permissions"
branch_labels = depends_on = None
LENGTHS = {"vendorName": 200, "gstNo": 15, "registeredAddress": 2000,
           "contactPersonName": 200, "emailId": 320, "phoneNo": 10, "dialCountry": 2}


def upgrade():
    op.create_table(
        "vendors",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        *(sa.Column(field, sa.String(length), nullable=False) for field, length in LENGTHS.items()),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.CheckConstraint("version >= 1", name="ck_vendor_version"),
        sa.CheckConstraint("status IN ('active', 'inactive')", name="ck_vendor_status"),
        sa.CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_vendor_deletion"),
        *(sa.CheckConstraint(f'length("{field}") BETWEEN 1 AND {length} AND "{field}" = btrim("{field}")',
                            name=f"ck_vendor_{field}_length") for field, length in LENGTHS.items()),
        sa.CheckConstraint('"gstNo" ~ \'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$\'', name="ck_vendor_gst"),
        sa.CheckConstraint(
            '("dialCountry" = \'IN\' AND "phoneNo" ~ \'^[6-9][0-9]{9}$\') OR '
            '("dialCountry" IN (\'US\', \'GB\') AND "phoneNo" ~ \'^[0-9]{10}$\') OR '
            '("dialCountry" = \'AE\' AND "phoneNo" ~ \'^[0-9]{9}$\')', name="ck_vendor_phone"),
    )
    op.create_index("uq_vendor_live_name", "vendors",
                    [sa.text(r"""lower(btrim(regexp_replace("vendorName", '\s+', ' ', 'g')))""")],
                    unique=True, postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("uq_vendor_live_gst", "vendors", ["gstNo"],
                    unique=True, postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("ix_vendor_live_created", "vendors",
                    [sa.text("created_at DESC"), sa.text("id DESC")],
                    postgresql_where=sa.text("deleted_at IS NULL"))


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM vendors)")):
        raise RuntimeError("Refusing to remove vendor history")
    op.drop_table("vendors")
