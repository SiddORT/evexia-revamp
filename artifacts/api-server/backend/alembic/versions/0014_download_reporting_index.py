"""Format-filtered exact counts and stable chronological pagination."""
from alembic import op

revision = "0014_download_reporting_index"
down_revision = "0013_download_logs"
branch_labels = depends_on = None


def upgrade():
    op.create_index("ix_download_format_created_id", "download_logs", ["format", "created_at", "id"])


def downgrade():
    op.drop_index("ix_download_format_created_id", table_name="download_logs")
