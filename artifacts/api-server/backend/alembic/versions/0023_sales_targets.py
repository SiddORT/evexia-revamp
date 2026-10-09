"""Empty Sales Target Master; never migrate or seed browser records."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0023_sales_targets"
down_revision = "0022_allergen_catalogue"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "sales_targets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("mrId", postgresql.UUID(as_uuid=True), sa.ForeignKey("mr_directory.id"), nullable=False),
        sa.Column("startYear", sa.Integer, nullable=False),
        sa.Column("endYear", sa.Integer, nullable=False),
        *(sa.Column(key, sa.Numeric(), nullable=False) for key in ("q1", "q2", "q3", "q4")),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.CheckConstraint("version >= 1", name="ck_sales_target_version"),
        sa.CheckConstraint("status IN ('active','inactive')", name="ck_sales_target_status"),
        sa.CheckConstraint('"startYear" BETWEEN 1 AND 9998 AND "endYear" = "startYear" + 1',
                           name="ck_sales_target_period"),
        sa.CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_sales_target_deletion"),
        *(sa.CheckConstraint(f'{key} >= 0 AND {key} <= 999999999999.99 AND {key} = trunc({key}, 2)',
                             name=f"ck_sales_target_{key}") for key in ("q1", "q2", "q3", "q4")),
    )
    op.create_index("uq_sales_target_live_period", "sales_targets", ["mrId", "startYear"],
                    unique=True, postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("ix_sales_target_live_created", "sales_targets",
                    [sa.text("created_at DESC"), sa.text("id DESC")],
                    postgresql_where=sa.text("deleted_at IS NULL"))


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT EXISTS (SELECT 1 FROM sales_targets)")):
        raise RuntimeError("Refusing to remove sales target history")
    op.drop_table("sales_targets")
