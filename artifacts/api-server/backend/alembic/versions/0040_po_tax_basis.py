"""Add nullable PO tax snapshots; no historical backfill. Separate activation approval required."""
from alembic import op
import sqlalchemy as sa

revision = "0040_po_tax_basis"
down_revision = "0039_communication"
branch_labels = depends_on = None


def upgrade():
    op.add_column("purchase_orders", sa.Column("tax_basis", sa.JSON(), nullable=True))
    op.add_column("purchase_orders", sa.Column("tax_components", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("purchase_orders", "tax_components")
    op.drop_column("purchase_orders", "tax_basis")
