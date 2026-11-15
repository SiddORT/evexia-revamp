"""Keep staged ancestry separate from the approved mapping-only path."""
revision = "0109_mapping_staged_merge"
down_revision = ("0108_doctor_mr_mapping", "0107_territory_staged_merge")
branch_labels = depends_on = None


def upgrade():
    pass


def downgrade():
    pass
