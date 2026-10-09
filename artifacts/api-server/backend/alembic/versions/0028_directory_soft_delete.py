"""Retain Doctor and Patient directory deletion evidence without changing identities."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0028_directory_soft_delete"
down_revision = "0027_mr_designation_identity"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("doctor_directory", "patient_directory"):
        op.add_column(table, sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
        op.add_column(table, sa.Column("deleted_by", postgresql.UUID(as_uuid=True), nullable=True))
        op.create_foreign_key(f"fk_{table}_deleted_by_users", table, "users", ["deleted_by"], ["id"])


def downgrade():
    # Removes deletion metadata only; all records and their relationships survive.
    for table in ("patient_directory", "doctor_directory"):
        op.drop_constraint(f"fk_{table}_deleted_by_users", table, type_="foreignkey")
        op.drop_column(table, "deleted_by")
        op.drop_column(table, "deleted_at")
