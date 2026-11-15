"""Explicit MR responsibility and exact Doctor location; no historical adoption."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, ARRAY

revision = "0106_territory_assignments"
down_revision = "0106_combination_rule_status"
branch_labels = depends_on = None


def upgrade():
    op.alter_column("mr_directory", "hq", existing_type=UUID(), nullable=True)
    op.add_column("mr_directory", sa.Column("coverageScope", sa.String(4), nullable=True))
    for name in ("hqIds", "areaIds"):
        op.add_column("mr_directory", sa.Column(name, ARRAY(UUID(as_uuid=True)), server_default="{}", nullable=False))
    op.create_check_constraint("ck_mr_coverage_shape", "mr_directory", """
        ("coverageScope" IS NULL AND cardinality("hqIds")=0 AND cardinality("areaIds")=0)
        OR ("coverageScope" IS NOT NULL AND (
          ("coverageScope"='zone' AND hq IS NULL AND cardinality("hqIds")=0 AND cardinality("areaIds")=0)
          OR ("coverageScope"='hq' AND hq IS NOT NULL AND hq="hqIds"[1] AND cardinality("hqIds")>0 AND cardinality("areaIds")=0)
          OR ("coverageScope"='area' AND hq IS NOT NULL AND hq="hqIds"[1] AND cardinality("hqIds")>0 AND cardinality("areaIds")>0)))
    """)
    for name, target in (("zoneId", "zones"), ("hqId", "headquarters"), ("areaId", "headquarter_areas")):
        op.add_column("doctor_directory", sa.Column(name, UUID(as_uuid=True), sa.ForeignKey(f"{target}.id"), nullable=True))
        op.create_index(f"ix_doctor_directory_{name}", "doctor_directory", [name])
    op.create_check_constraint("ck_doctor_location_complete", "doctor_directory",
        '("zoneId" IS NULL AND "hqId" IS NULL AND "areaId" IS NULL) OR '
        '("zoneId" IS NOT NULL AND "hqId" IS NOT NULL AND "areaId" IS NOT NULL)')
    # NULL scope/location is retained legacy evidence, never intentional breadth.


def downgrade():
    raise RuntimeError("Territory adoption cannot be discarded; use reviewed recovery.")
