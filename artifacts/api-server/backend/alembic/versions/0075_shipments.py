"""Allow SPT fulfillment statuses without rewriting approval history."""
from alembic import op

revision = "0075_shipments"
down_revision = "0074_business_numbers"
branch_labels = depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_constraint("ck_spt_status", "spt_orders", type_="check")
    op.create_check_constraint("ck_spt_status", "spt_orders",
        "status IN ('Draft','Saved','Approved','In process','Shipped','Returned','Rejected')")


def downgrade():
    # A downgrade must not destroy fulfillment history or re-open shipped orders.
    op.drop_constraint("ck_spt_status", "spt_orders", type_="check")
    op.create_check_constraint("ck_spt_status", "spt_orders",
        "status IN ('Draft','Saved','In process','Rejected')")
