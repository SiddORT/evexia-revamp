"""Join staged branches without expanding HSN's declared activation target."""
revision = "0097_hsn_staged_merge"
down_revision = ("0096_hsn_master", "0095_quantity_staged_merge")
branch_labels = depends_on = None


def upgrade():
    pass


def downgrade():
    pass
