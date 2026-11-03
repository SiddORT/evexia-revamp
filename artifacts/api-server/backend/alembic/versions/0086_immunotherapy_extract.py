"""Empty category-rank configuration; no clinical defaults or order backfills."""
from alembic import op
import sqlalchemy as sa

revision = "0086_immunotherapy_extract"
down_revision = "0086_it_pricing_rules"
branch_labels = depends_on = None


def upgrade():
    op.create_table("immunotherapy_extract_settings",
        sa.Column("category_id", sa.Uuid(), sa.ForeignKey("product_categories.id"), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.CheckConstraint("version >= 1", name="ck_imm_extract_version"),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_imm_extract_cipher"))


def downgrade():
    raise RuntimeError("Clinical configuration requires a reviewed forward change.")
