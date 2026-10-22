"""Separate Staff assignments from preserved historical MR manager links."""
from alembic import op
import sqlalchemy as sa

revision = "0055_mr_staff_managers"
down_revision = "0054_modern_email_tests"
branch_labels = depends_on = None


def upgrade():
    # No inferred mappings, no backfill and no changes to historical contacts.
    op.add_column("mr_directory", sa.Column("reportingStaffId", sa.Uuid(), nullable=True))
    op.add_column("mr_directory", sa.Column("reporting_staff_name_ciphertext", sa.Text(), nullable=True))
    op.create_foreign_key("fk_mr_reporting_staff", "mr_directory", "staff_profiles",
                          ["reportingStaffId"], ["id"], ondelete="RESTRICT")
    op.create_index("ix_mr_directory_reportingStaffId", "mr_directory", ["reportingStaffId"])
    op.create_check_constraint("ck_mr_staff_snapshot", "mr_directory",
                               '("reportingStaffId" IS NULL) = (reporting_staff_name_ciphertext IS NULL)')
    op.create_check_constraint("ck_mr_manager_kind", "mr_directory",
                               '"reportingManagerId" IS NULL OR "reportingStaffId" IS NULL')


def downgrade():
    raise RuntimeError("Staff assignment history requires coordinated recovery; downgrade refused.")
