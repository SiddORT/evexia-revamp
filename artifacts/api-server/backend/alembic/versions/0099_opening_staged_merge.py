"""Keep unrelated staged branches outside opening-only activation."""

revision = "0099_opening_staged_merge"
down_revision = ("0098_opening_corrections", "0097_hsn_staged_merge")
branch_labels = depends_on = None


def upgrade():
    pass


def downgrade():
    pass
