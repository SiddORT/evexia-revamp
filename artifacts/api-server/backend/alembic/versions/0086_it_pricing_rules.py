"""Standalone IT pricing configuration; no order consumers or data changes."""
from alembic import op
import sqlalchemy as sa

revision = "0086_it_pricing_rules"
down_revision = "0085_placement_email_details"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "it_pricing_rules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("category_id", sa.Uuid(), sa.ForeignKey("product_categories.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("version >= 1", name="ck_it_pricing_rule_version"),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_it_pricing_rule_cipher"),
    )
    op.create_index("ix_it_pricing_rules_category_id", "it_pricing_rules", ["category_id"])
    op.create_table(
        "it_pricing_rule_targets",
        sa.Column("rule_id", sa.Uuid(), sa.ForeignKey("it_pricing_rules.id"), primary_key=True),
        sa.Column("allergen_id", sa.Uuid(), sa.ForeignKey("allergen_products.id"), primary_key=True),
        sa.UniqueConstraint("allergen_id", name="uq_it_pricing_rule_allergen"),
    )
    op.create_table(
        "it_pricing_rule_requests",
        sa.Column("key", sa.Uuid(), primary_key=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_it_pricing_request_cipher"),
    )


def downgrade():
    raise RuntimeError("Pricing Rules require reviewed forward recovery; do not discard saved configuration.")
