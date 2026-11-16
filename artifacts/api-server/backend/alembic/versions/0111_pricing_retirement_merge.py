"""Retain the separate staged ancestry without activating it on development."""
revision = "0111_pricing_retirement_merge"
down_revision = ("0110_retire_legacy_pricing", "0109_mapping_staged_merge")
branch_labels = depends_on = None


def upgrade():
    pass


def downgrade():
    raise RuntimeError("Restore the reviewed pre-retirement database and application together.")
