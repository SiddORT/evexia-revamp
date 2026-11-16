"""Join staged ancestry without activating it on the declared credit-only path."""
revision = "0113_credits_staged_merge"
down_revision = ("0112_settlement_credits", "0111_pricing_retirement_merge")
branch_labels = depends_on = None


def upgrade():
    pass


def downgrade():
    raise RuntimeError("Restore reviewed credit evidence and matching source together.")
