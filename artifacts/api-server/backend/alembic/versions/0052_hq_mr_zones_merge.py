"""Reconcile independent HQ areas and MR zone assignments without rewriting history."""

revision = "0052_hq_mr_zones_merge"
down_revision = ("0051_headquarter_areas", "0051_mr_zones")
branch_labels = depends_on = None


def upgrade():
    pass


def downgrade():
    pass
