"""Merge portal hostname and organization retirement branches."""

revision = "0033_merge_directory_branches"
down_revision = ("0031_role_hostnames", "0031_remove_organizations")
branch_labels = depends_on = None


def upgrade():
    pass


def downgrade():
    pass
