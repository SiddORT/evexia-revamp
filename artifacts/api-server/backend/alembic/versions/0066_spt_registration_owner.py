"""Bound new MR SPT registrations without inferring ownership of old records."""
from alembic import op
import sqlalchemy as sa

revision = "0066_spt_registration_owner"
down_revision = "0065_lupin_orders"
branch_labels = depends_on = None


def upgrade():
    op.add_column("spt_patients", sa.Column("owner_mr_id", sa.UUID(), nullable=True))
    op.create_foreign_key("fk_spt_patient_owner_mr", "spt_patients", "mr_directory", ["owner_mr_id"], ["id"])
    op.create_index("ix_spt_patients_owner_mr_id", "spt_patients", ["owner_mr_id"])


def downgrade():
    op.drop_index("ix_spt_patients_owner_mr_id", table_name="spt_patients")
    op.drop_constraint("fk_spt_patient_owner_mr", "spt_patients", type_="foreignkey")
    op.drop_column("spt_patients", "owner_mr_id")
