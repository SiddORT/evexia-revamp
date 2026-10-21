"""Optional legacy HQ zones and retained, ordered per-HQ areas."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0051_headquarter_areas"
down_revision = "0050_opening_stock"
branch_labels = depends_on = None


def upgrade():
    op.add_column("headquarters", sa.Column("zone_id", UUID, sa.ForeignKey("zones.id")))
    op.add_column("headquarters", sa.Column("next_area_sequence", sa.Integer, nullable=False, server_default="1"))
    op.create_check_constraint("ck_headquarter_area_sequence", "headquarters", "next_area_sequence BETWEEN 1 AND 2147483647")
    op.create_table("headquarter_areas",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("headquarter_id", UUID, sa.ForeignKey("headquarters.id"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("position", sa.Integer, nullable=False),
        sa.Column("sequence", sa.Integer),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by", UUID, sa.ForeignKey("users.id")),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 200 AND name = btrim(name)", name="ck_hq_area_name"),
        sa.CheckConstraint("length(code) BETWEEN 1 AND 32 AND code = btrim(code) AND code = upper(code)", name="ck_hq_area_code"),
        sa.CheckConstraint("position BETWEEN 0 AND 199", name="ck_hq_area_position"),
        sa.CheckConstraint("sequence IS NULL OR sequence BETWEEN 1 AND 2147483646", name="ck_hq_area_sequence"),
        sa.CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_hq_area_deletion"))
    op.create_index("ix_headquarter_areas_headquarter_id", "headquarter_areas", ["headquarter_id"])
    # Same Unicode whitespace/lower normalization as the existing HQ live name.
    for field in ("name", "code"):
        op.execute(f"""CREATE UNIQUE INDEX uq_hq_area_live_{field} ON headquarter_areas
          (headquarter_id, lower(btrim(regexp_replace({field}, '\\s+', ' ', 'g'))))
          WHERE deleted_at IS NULL""")


def downgrade():
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT EXISTS(SELECT 1 FROM headquarter_areas) OR EXISTS(SELECT 1 FROM headquarters WHERE zone_id IS NOT NULL OR next_area_sequence <> 1)")):
        raise RuntimeError("Headquarter zone/area history exists; use a reviewed forward fix.")
    op.drop_table("headquarter_areas")
    op.drop_constraint("ck_headquarter_area_sequence", "headquarters")
    op.drop_column("headquarters", "next_area_sequence")
    op.drop_column("headquarters", "zone_id")
