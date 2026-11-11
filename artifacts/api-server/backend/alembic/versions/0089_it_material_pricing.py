"""Explicit Dilution identity. No material, rate, clinical default or stock seed."""
from alembic import op
import sqlalchemy as sa

revision = "0089_it_material_pricing"
down_revision = "0090_settlement_verification"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "immunotherapy_dilution_material",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("product_id", sa.Uuid(), sa.ForeignKey("allergen_products.id"), nullable=False, unique=True),
        sa.Column("request_id", sa.Uuid(), nullable=False, unique=True),
        sa.Column("request_digest", sa.String(64), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_it_dilution_singleton"),
    )


def downgrade():
    raise RuntimeError("Durable material identity must not be removed from saved order history.")
