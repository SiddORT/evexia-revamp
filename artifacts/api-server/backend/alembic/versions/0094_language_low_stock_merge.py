"""Reconcile staged low-stock and Language status ancestry without executing DDL."""

revision = "0094_language_low_stock_merge"
down_revision = ("0092_low_stock_cron", "0093_language_status")
branch_labels = depends_on = None


def upgrade():
    pass


def downgrade():
    pass
