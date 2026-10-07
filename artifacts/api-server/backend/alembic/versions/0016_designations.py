"""Empty shared designation catalogue; no local or staff data migration."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0016_designations"
down_revision = "0015_zone_permissions"
branch_labels = depends_on = None

DECIMALS = ("basicDa", "hra", "medicalAllowance", "travellingAllowance", "specialAllowance", "professionalTax")


def upgrade():
    op.create_table(
        "designations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("shortName", sa.String(50), nullable=False),
        sa.Column("level", sa.Integer, nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        *(sa.Column(field, sa.Numeric(11, 2), nullable=False) for field in DECIMALS),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.CheckConstraint("version >= 1", name="ck_designation_version"),
        sa.CheckConstraint("status IN ('active', 'inactive')", name="ck_designation_status"),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 200 AND name = btrim(name)", name="ck_designation_name"),
        sa.CheckConstraint('length("shortName") BETWEEN 1 AND 50 AND "shortName" = btrim("shortName")', name="ck_designation_short_name"),
        sa.CheckConstraint("level BETWEEN 1 AND 2147483647", name="ck_designation_level"),
        *(sa.CheckConstraint(f'"{field}" >= 0 AND "{field}" <= 999999999.99', name=f"ck_designation_{field}") for field in DECIMALS),
        sa.CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_designation_deletion"),
    )
    op.create_index("uq_designation_live_name", "designations",
                    [sa.text(r"lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))")],
                    unique=True, postgresql_where=sa.text("deleted_at IS NULL"))


def downgrade():
    # A populated catalogue retains audit/tombstone evidence; use reviewed recovery.
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM designations)")):
        raise RuntimeError("Refusing to remove designation history")
    op.drop_table("designations")
