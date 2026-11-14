"""Preserve the separate staged branch without activating its unrelated features."""
revision = "0105_combination_staged_merge"
down_revision = ("0104_combination_pricing", "0103_tariff_staged_merge")
branch_labels = depends_on = None


def upgrade():
    pass


def downgrade():
    pass
