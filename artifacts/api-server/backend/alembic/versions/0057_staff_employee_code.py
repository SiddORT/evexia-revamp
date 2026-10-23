"""Add optional manually entered Staff metadata without changing account identity."""
from alembic import op
import sqlalchemy as sa

revision = "0057_staff_employee_code"
down_revision = "0056_staff_business_roles"
branch_labels = depends_on = None


def upgrade():
    op.add_column("staff_profiles", sa.Column("employee_code", sa.String(64), nullable=True))
    op.create_check_constraint(
        "ck_staff_employee_code", "staff_profiles",
        "employee_code IS NULL OR (char_length(employee_code) BETWEEN 1 AND 64 AND employee_code = btrim(employee_code) AND employee_code !~ '[[:cntrl:]]')",
    )


def downgrade():
    raise RuntimeError("Staff Employee Codes require coordinated recovery; downgrade refused.")
