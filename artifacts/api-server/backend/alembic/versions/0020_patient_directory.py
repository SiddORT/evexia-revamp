"""Empty one-to-one Patient directory; existing owners/files are unchanged."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0020_patient_directory"
down_revision = "0019_doctor_directory"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "patient_directory",
        sa.Column("id", postgresql.UUID(as_uuid=True), sa.ForeignKey("patients.id"), primary_key=True),
        *[sa.Column(key, sa.String(size), nullable=False) for key, size in (
            ("code", 64), ("name", 200), ("gender", 17), ("phone", 20), ("dialCountry", 2), ("email", 320),
            ("instructionsLanguage", 100), ("status", 8), ("addressLine1", 300), ("addressLine2", 300),
            ("landmark", 200), ("pincode", 12), ("city", 100), ("state", 100), ("country", 100))],
        sa.Column("dateOfBirth", sa.Date(), nullable=False),
        sa.Column("doctorId", postgresql.UUID(as_uuid=True), sa.ForeignKey("doctor_directory.id"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("gender IN ('male','female','other','prefer not to say')", name="ck_patient_gender"),
        sa.CheckConstraint("status IN ('active','inactive')", name="ck_patient_directory_status"),
        sa.CheckConstraint('"dialCountry" IN (\'IN\',\'US\',\'GB\',\'AE\')', name="ck_patient_dial"),
        sa.CheckConstraint("code ~ '^PAT-[A-Z0-9][A-Z0-9-]{1,59}$'", name="ck_patient_code"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_patient_directory_doctorId", "patient_directory", ["doctorId"])
    op.create_index("uq_patient_duplicate", "patient_directory",
                    [sa.text("lower(btrim(name))"), "dialCountry", "phone", "dateOfBirth"], unique=True)


def downgrade():
    op.drop_table("patient_directory")
