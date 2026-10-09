"""Retire designation payroll metadata and store exact generated annual budgets.

Destructive: take a verified backup and coordinate application/schema rollout.
Populated downgrades are refused: discarded values cannot be reconstructed.
"""
from alembic import op
import sqlalchemy as sa

revision = "0026_designation_target"
down_revision = "0025_vendor_phone"
branch_labels = depends_on = None

RETIRED = ("level", "basicDa", "hra", "medicalAllowance",
           "travellingAllowance", "specialAllowance", "professionalTax")


def upgrade():
    for field in RETIRED:
        op.drop_constraint(f"ck_designation_{field}", "designations", type_="check")
        op.drop_column("designations", field)
    op.add_column("sales_targets", sa.Column(
        "annual_target", sa.Numeric(),
        sa.Computed("q1 + q2 + q3 + q4", persisted=True), nullable=False))


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM designations)")):
        raise RuntimeError(
            "Irreversible designation column removal: use a reviewed forward fix or "
            "a coordinated verified backup restore; downgrade cannot restore discarded values.")
    # An empty catalogue can regain the old contract without inventing values.
    # No defaults/backfill: this never reconstructs removed historical data.
    op.drop_column("sales_targets", "annual_target")
    for field in RETIRED:
        op.add_column("designations", sa.Column(
            field, sa.Integer() if field == "level" else sa.Numeric(11, 2), nullable=False))
        condition = ("level BETWEEN 1 AND 2147483647" if field == "level" else
                     f'"{field}" >= 0 AND "{field}" <= 999999999.99')
        op.create_check_constraint(f"ck_designation_{field}", "designations", condition)
