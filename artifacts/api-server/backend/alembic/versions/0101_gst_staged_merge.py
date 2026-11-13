"""One source head without activating unrelated staged features in development."""
revision = "0101_gst_staged_merge"
down_revision = ("0100_applicable_gst", "0099_opening_staged_merge")
branch_labels = depends_on = None


def upgrade():
    pass


def downgrade():
    pass
