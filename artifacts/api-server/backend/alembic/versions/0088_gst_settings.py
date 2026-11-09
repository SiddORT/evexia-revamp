"""Standalone shared GST configuration. No initial business values or order writes."""
from alembic import op
import sqlalchemy as sa

revision = "0088_gst_settings"
down_revision = "0087_pricing_rule_categories"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "gst_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("cutoff_date", sa.Date(), nullable=False),
        sa.Column("before_rate", sa.Numeric(), nullable=False),
        sa.Column("on_after_rate", sa.Numeric(), nullable=False),
        sa.CheckConstraint("id = 1 AND version >= 1", name="ck_gst_settings_singleton"),
        sa.CheckConstraint("before_rate BETWEEN 0 AND 100 AND before_rate = trunc(before_rate, 2)",
                           name="ck_gst_before_rate"),
        sa.CheckConstraint("on_after_rate BETWEEN 0 AND 100 AND on_after_rate = trunc(on_after_rate, 2)",
                           name="ck_gst_on_after_rate"),
    )


def downgrade():
    raise RuntimeError("GST settings are durable business configuration; restore a reviewed backup instead.")
