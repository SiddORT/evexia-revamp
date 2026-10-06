"""Indexed safe event text; immutable function is versioned with its projection."""
from alembic import op

revision = "0008_activity_search"
down_revision = "0007_reporting_indexes"
branch_labels = None
depends_on = None


def upgrade():
    # pg_trgm is a PostgreSQL trusted extension. Fail explicitly if unavailable;
    # never silently substitute a different search contract.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public")
    op.execute("""
        CREATE FUNCTION evexia_activity_text_v1(
            action text, outcome text, reason text, resource text,
            session_ref text, request_ref text, resource_ref uuid
        ) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
            SELECT array_to_string(ARRAY[
                CASE WHEN length(action) <= 80 AND action ~ '^[a-z][a-z0-9_]*$'
                     THEN action ELSE 'unavailable' END,
                CASE WHEN length(outcome) <= 16 AND outcome ~ '^[a-z][a-z0-9_]*$'
                     THEN outcome ELSE 'unavailable' END,
                CASE WHEN length(reason) <= 40 AND reason ~ '^[a-z][a-z0-9_]*$'
                     THEN reason END,
                CASE WHEN length(resource) <= 60 AND resource ~ '^[a-z][a-z0-9_]*$'
                     THEN resource END,
                CASE WHEN session_ref ~ '^[A-Za-z0-9_-]{1,64}$' THEN session_ref END,
                CASE WHEN length(request_ref) <= 64 AND request_ref ~ '^[A-Za-z0-9._:\\-]+$'
                     THEN request_ref END,
                resource_ref::text
            ], '|')
        $$
    """)
    # An existing extension may live outside the application's search_path.
    # Resolve its actual namespace without moving it or changing shared objects.
    op.execute("""
        DO $ddl$
        DECLARE extension_schema text;
        BEGIN
            SELECT n.nspname INTO extension_schema
            FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
            WHERE e.extname = 'pg_trgm';
            EXECUTE format(
                'CREATE INDEX ix_audit_events_safe_text_trgm ON audit_events
                 USING gin (lower(evexia_activity_text_v1(
                     action, outcome, reason, resource_type, session_id, request_id, resource_id
                 )) %I.gin_trgm_ops)', extension_schema);
        END
        $ddl$
    """)
    op.create_index("ix_audit_events_action_created_id", "audit_events", ["action", "created_at", "id"])
    op.create_index("ix_audit_events_resource_created_id", "audit_events", ["resource_type", "created_at", "id"])
    # GIN alone does not give LIKE useful expression selectivity. Statistics let
    # broad searches use the ordered index instead of sorting a full-table scan.
    op.execute("""
        CREATE STATISTICS st_audit_events_safe_text ON
        (lower(evexia_activity_text_v1(
            action, outcome, reason, resource_type, session_id, request_id, resource_id
        ))) FROM audit_events
    """)
    op.execute("ANALYZE audit_events")


def downgrade():
    op.execute("DROP STATISTICS st_audit_events_safe_text")
    op.drop_index("ix_audit_events_resource_created_id", table_name="audit_events")
    op.drop_index("ix_audit_events_action_created_id", table_name="audit_events")
    op.drop_index("ix_audit_events_safe_text_trgm", table_name="audit_events")
    op.execute("DROP FUNCTION evexia_activity_text_v1(text, text, text, text, text, text, uuid)")
    # pg_trgm may belong to other application indexes; do not remove it.
