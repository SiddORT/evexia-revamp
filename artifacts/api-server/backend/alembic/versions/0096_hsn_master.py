"""Add an empty HSN master and nullable product snapshots; no historical backfill."""
from alembic import op
import sqlalchemy as sa

revision = "0096_hsn_master"
# Follow the approved development target, not staged Cron/Designation work.
down_revision = "0092_quantity_hundredths"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "hsn_mappings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("code", sa.String(16), nullable=False, unique=True),
        sa.Column("gst", sa.Numeric(), nullable=False, unique=True),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("code ~ '^[0-9]{1,16}$'", name="ck_hsn_code"),
        sa.CheckConstraint("gst >= 0 AND gst <= 100 AND gst = round(gst, 2)", name="ck_hsn_gst"),
        sa.CheckConstraint("status IN ('active', 'inactive')", name="ck_hsn_status"),
        sa.CheckConstraint("version >= 1", name="ck_hsn_version"),
    )
    op.create_table(
        "hsn_changes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("mapping_id", sa.Uuid(), sa.ForeignKey("hsn_mappings.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("before_code", sa.String(16)),
        sa.Column("before_gst", sa.Numeric()),
        sa.Column("before_status", sa.String(8)),
        sa.Column("after_code", sa.String(16), nullable=False),
        sa.Column("after_gst", sa.Numeric(), nullable=False),
        sa.Column("after_status", sa.String(8), nullable=False),
    )
    op.add_column("allergen_products", sa.Column("hsn_code", sa.String(16)))
    op.create_check_constraint("ck_allergen_hsn", "allergen_products", "hsn_code IS NULL OR hsn_code ~ '^[0-9]{1,16}$'")


def downgrade():
    connection = op.get_bind()
    connection.execute(sa.text("LOCK TABLE hsn_mappings, hsn_changes, allergen_products IN ACCESS EXCLUSIVE MODE"))
    if connection.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM hsn_mappings) OR EXISTS (SELECT 1 FROM allergen_products WHERE hsn_code IS NOT NULL)")):
        raise RuntimeError("Saved HSN data exists; downgrade would lose records.")
    op.drop_constraint("ck_allergen_hsn", "allergen_products", type_="check")
    op.drop_column("allergen_products", "hsn_code")
    op.drop_table("hsn_changes")
    op.drop_table("hsn_mappings")
