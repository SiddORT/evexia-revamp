"""Empty name-only Language Master with retained committed change history."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0047_languages"
down_revision = "0046_live_inventory"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "languages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.CheckConstraint("version >= 1", name="ck_languages_version"),
        sa.CheckConstraint("length(name) BETWEEN 1 AND 200 AND name = btrim(name)", name="ck_languages_name"),
        sa.CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_languages_deletion"),
    )
    op.create_index("uq_languages_live_name", "languages", [sa.text("lower(name)")], unique=True,
                    postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_table(
        "language_changes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("language_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("languages.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(6), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("before_name", sa.String(200)),
        sa.Column("after_name", sa.String(200), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("audit_events.id", ondelete="RESTRICT"), nullable=False, unique=True),
        sa.UniqueConstraint("language_id", "version", name="uq_language_changes_version"),
        sa.CheckConstraint("action IN ('create', 'edit', 'delete')", name="ck_language_changes_action"),
        sa.CheckConstraint("version >= 1", name="ck_language_changes_version"),
        sa.CheckConstraint("length(after_name) BETWEEN 1 AND 200", name="ck_language_changes_after"),
        sa.CheckConstraint("(action = 'create' AND before_name IS NULL AND version = 1) OR "
                           "(action IN ('edit', 'delete') AND before_name IS NOT NULL AND version > 1)",
                           name="ck_language_changes_before"),
    )
    op.create_index("ix_language_changes_record_version", "language_changes", ["language_id", "version"])
    op.execute("""
        CREATE FUNCTION reject_language_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Language history is append-only';
        END $$;
        CREATE TRIGGER language_history_append_only BEFORE UPDATE OR DELETE ON language_changes
        FOR EACH ROW EXECUTE FUNCTION reject_language_history_mutation();
        CREATE TRIGGER language_history_no_truncate BEFORE TRUNCATE ON language_changes
        FOR EACH STATEMENT EXECUTE FUNCTION reject_language_history_mutation();
    """)


def downgrade():
    # Retained history must not be silently discarded by an application rollback.
    if op.get_bind().execute(sa.text("SELECT EXISTS(SELECT 1 FROM languages)")).scalar():
        raise RuntimeError("Language downgrade requires an empty catalogue and history")
    op.drop_table("language_changes")
    op.execute("DROP FUNCTION reject_language_history_mutation()")
    op.drop_table("languages")
