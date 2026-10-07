"""Empty Doctor directory; references only the landed server MR directory."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0019_doctor_directory"
down_revision = "0018_mr_directory"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "doctor_directory",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        *[sa.Column(key, sa.String(size), nullable=False) for key, size in (
            ("name", 200), ("phone", 20), ("dialCountry", 2), ("alternatePhone", 20), ("email", 320),
            ("contactRequirement", 8), ("registrationNumber", 100), ("qualification", 200), ("clinicName", 200),
            ("invoiceType", 6), ("gstNumber", 20), ("drugLicenceNumber", 100), ("status", 8), ("verification", 10),
            ("pincode", 12), ("addressLine1", 300), ("addressLine2", 300), ("landmark", 200),
            ("country", 100), ("state", 100), ("city", 100))],
        sa.Column("dateOfJoining", sa.Date()),
        sa.Column("mrId", postgresql.UUID(as_uuid=True), sa.ForeignKey("mr_directory.id"), nullable=False),
        sa.Column("orderDiscount", sa.Numeric(5, 2), nullable=False),
        sa.Column("daysLimit", sa.Integer(), nullable=False),
        sa.Column("paymentLimit", sa.Numeric(15, 2), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("version >= 1", name="ck_doctor_version"),
        sa.CheckConstraint("status IN ('active','inactive')", name="ck_doctor_status"),
        sa.CheckConstraint("verification IN ('verified','unverified')", name="ck_doctor_verification"),
        sa.CheckConstraint('"contactRequirement" IN (\'required\',\'optional\')', name="ck_doctor_contact"),
        sa.CheckConstraint('"contactRequirement" = \'optional\' OR (phone <> \'\' AND email <> \'\')', name="ck_doctor_required_contact"),
        sa.CheckConstraint('"orderDiscount" BETWEEN 0 AND 100 AND "daysLimit" >= 0 AND "paymentLimit" >= 0', name="ck_doctor_limits"),
        sa.CheckConstraint('"invoiceType" IN (\'normal\',\'gst\') AND ("invoiceType" <> \'gst\' OR "gstNumber" <> \'\')', name="ck_doctor_invoice"),
        sa.CheckConstraint('"dialCountry" IN (\'IN\',\'US\',\'GB\',\'AE\')', name="ck_doctor_dial"),
    )
    op.create_index("uq_doctor_registration", "doctor_directory", [sa.text('lower(btrim("registrationNumber"))')], unique=True)
    op.create_index("ix_doctor_directory_mrId", "doctor_directory", ["mrId"])
    op.create_index("ix_doctor_directory_state", "doctor_directory", ["state"])


def downgrade():
    op.drop_table("doctor_directory")
