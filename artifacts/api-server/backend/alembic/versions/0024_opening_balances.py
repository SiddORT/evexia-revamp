"""Empty shared register; no legacy initialization or permission changes."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0024_opening_balances"
down_revision = "0023_sales_targets"
branch_labels = depends_on = None


def upgrade():
    op.create_table("opening_balances",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("startYear", sa.Integer, nullable=False),
        sa.Column("endYear", sa.Integer, nullable=False),
        sa.Column("doctorId", postgresql.UUID(as_uuid=True), sa.ForeignKey("doctor_directory.id"), nullable=False),
        sa.Column("amount", sa.Numeric(15, 2), nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.CheckConstraint("version >= 1", name="ck_opening_balance_version"),
        sa.CheckConstraint("status IN ('active','inactive')", name="ck_opening_balance_status"),
        sa.CheckConstraint('"startYear" BETWEEN 1900 AND 9998 AND "endYear" = "startYear" + 1', name="ck_opening_balance_years"),
        sa.CheckConstraint("amount BETWEEN -9999999999999.99 AND 9999999999999.99", name="ck_opening_balance_amount"),
        sa.CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_opening_balance_deletion"))
    op.create_index("uq_opening_balance_live_doctor_year", "opening_balances", ["doctorId", "startYear"],
                    unique=True, postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("ix_opening_balances_doctorId", "opening_balances", ["doctorId"])
    op.create_index("ix_opening_balance_live_order", "opening_balances",
                    [sa.text("created_at DESC"), sa.text("id DESC")], postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_table("opening_balance_import_reviews",
        sa.Column("session_id", sa.String(64), sa.ForeignKey("auth_sessions.id"), primary_key=True),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False))


def downgrade():
    op.drop_table("opening_balance_import_reviews")
    op.drop_table("opening_balances")
