"""Nullable Immunotherapy audit times; no historical repricing or ID issuance.

Authored for explicit later application. No upgrade-time current clock defaults.
"""
from alembic import op
import sqlalchemy as sa

revision = "0071_order_review_audit"
down_revision = "0070_mr_account_numbers"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("immunotherapy_orders", sa.Column("created_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("immunotherapy_orders", sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
    # Exactly one durable success event matching this order AND its creator.
    # Ambiguous/missing history stays unavailable, not migration time/order date.
    op.execute("""
        WITH evidence AS (
            SELECT resource_id, min(created_at) AS at, min(actor_id::text)::uuid AS actor
            FROM audit_events
            WHERE resource_type = 'immunotherapy_order'
              AND action = 'immunotherapy_created' AND outcome = 'success'
            GROUP BY resource_id HAVING count(*) = 1
        )
        UPDATE immunotherapy_orders o SET created_at = e.at
        FROM evidence e WHERE e.resource_id = o.id AND e.actor = o.created_by
    """)
    # No mutation-version evidence exists in legacy update audit events. Only a
    # never-edited row with matching paired actors can inherit creation time.
    op.execute("""
        UPDATE immunotherapy_orders o SET updated_at = created_at
        WHERE version = 1 AND created_at IS NOT NULL AND updated_by = created_by
          AND NOT EXISTS (
            SELECT 1 FROM audit_events a WHERE a.resource_id = o.id
              AND a.resource_type = 'immunotherapy_order'
              AND a.action = 'immunotherapy_updated' AND a.outcome = 'success'
          )
    """)


def downgrade():
    op.drop_column("immunotherapy_orders", "updated_at")
    op.drop_column("immunotherapy_orders", "created_at")
