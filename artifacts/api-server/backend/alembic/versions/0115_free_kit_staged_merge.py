"""Join existing staged ancestry without activating it on the free-kit path."""
revision = "0115_free_kit_staged_merge"
down_revision = ("0114_free_kit_limits", "0113_credits_staged_merge")
branch_labels = depends_on = None


def upgrade():
    pass


def downgrade():
    raise RuntimeError("Restore matching source and permanent quota evidence together.")
