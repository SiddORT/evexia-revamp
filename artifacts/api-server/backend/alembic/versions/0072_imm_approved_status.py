"""Align the Immunotherapy status CHECK with the existing application vocabulary.

DDL only: no historical order, financial, audit, retry or occurrence data changes.
Alembic's PostgreSQL transaction keeps replacement atomic.
"""
from alembic import op

revision = "0072_imm_approved_status"
down_revision = "0071_order_review_audit"
branch_labels = depends_on = None


def upgrade():
    op.drop_constraint("ck_imm_status", "immunotherapy_orders", type_="check")
    op.create_check_constraint(
        "ck_imm_status",
        "immunotherapy_orders",
        "status IN ('Confirmed','Approved','In process','Shipped','Delivered','Rejected','Returned')",
    )


def downgrade():
    # A narrower CHECK would reject legitimately approved saved orders. Never
    # rewrite their status or discard them to make a downgrade possible.
    raise RuntimeError("Approved Immunotherapy history requires the expanded status constraint")
