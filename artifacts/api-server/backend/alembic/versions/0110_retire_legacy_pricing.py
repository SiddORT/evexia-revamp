"""Retire material/count pricing; retain retry outcomes and saved order snapshots."""
from alembic import op
import sqlalchemy as sa

revision = "0110_retire_legacy_pricing"
down_revision = "0108_doctor_mr_mapping"
branch_labels = depends_on = None


def upgrade():
    bind = op.get_bind()
    # Same lock as configuration and quotations. DDL waits for pre-cutover
    # transactions; no CASCADE, guard disabling, key rewriting or order writes.
    bind.execute(sa.text("SELECT pg_advisory_xact_lock(5310086)"))
    bind.execute(sa.text("""
        LOCK TABLE it_pricing_rules,it_pricing_rule_targets,
          it_pricing_rule_categories,it_pricing_rule_requests,
          it_category_count_tariffs IN ACCESS EXCLUSIVE MODE
    """))
    # A rename preserves every UUID, encrypted envelope, owner and immutable
    # outcome, including delayed combination saves/status requests.
    op.rename_table("it_pricing_rule_requests", "it_combination_requests")
    op.execute("ALTER TABLE it_combination_requests RENAME CONSTRAINT it_pricing_rule_requests_pkey TO it_combination_requests_pkey")
    op.execute("ALTER TABLE it_combination_requests RENAME CONSTRAINT ck_it_pricing_request_cipher TO ck_it_combination_request_cipher")
    op.drop_table("it_pricing_rule_categories")
    op.drop_table("it_pricing_rule_targets")
    op.drop_table("it_pricing_rules")
    op.drop_table("it_category_count_tariffs")


def downgrade():
    raise RuntimeError("Retired pricing configuration cannot be reconstructed; restore a verified pre-retirement backup with its application version.")
