"""Explicit multi-category membership; retain original target attribution."""
from alembic import op
import sqlalchemy as sa

revision = "0087_pricing_rule_categories"
down_revision = "0086_immunotherapy_extract"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "it_pricing_rule_categories",
        sa.Column("rule_id", sa.Uuid(), sa.ForeignKey("it_pricing_rules.id"), primary_key=True),
        sa.Column("category_id", sa.Uuid(), sa.ForeignKey("product_categories.id"), primary_key=True),
    )
    op.execute("""INSERT INTO it_pricing_rule_categories (rule_id, category_id)
                  SELECT id, category_id FROM it_pricing_rules""")
    op.add_column("it_pricing_rule_targets", sa.Column("category_id", sa.Uuid(), nullable=True))
    # Never infer historical attribution from a possibly moved master.
    op.execute("""UPDATE it_pricing_rule_targets t SET category_id = r.category_id
                  FROM it_pricing_rules r WHERE r.id = t.rule_id""")
    op.alter_column("it_pricing_rule_targets", "category_id", nullable=False)
    op.create_foreign_key("fk_it_pricing_target_category", "it_pricing_rule_targets",
                          "product_categories", ["category_id"], ["id"])


def downgrade():
    raise RuntimeError("Multi-category rules require reviewed forward recovery.")
