"""Forward indexes for global and user-filtered read-only histories."""
from alembic import op

revision = "0007_reporting_indexes"
down_revision = "0006_auth_sessions"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index("ix_auth_sessions_created_id", "auth_sessions", ["created_at", "id"])
    op.create_index("ix_auth_sessions_user_created_id", "auth_sessions", ["user_id", "created_at", "id"])
    op.create_index("ix_audit_events_created_id", "audit_events", ["created_at", "id"])
    op.create_index("ix_audit_events_actor_created_id", "audit_events", ["actor_id", "created_at", "id"])


def downgrade():
    # Index-only rollback never deletes or reactivates history.
    op.drop_index("ix_audit_events_actor_created_id", table_name="audit_events")
    op.drop_index("ix_audit_events_created_id", table_name="audit_events")
    op.drop_index("ix_auth_sessions_user_created_id", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_created_id", table_name="auth_sessions")
