"""New initiation history only. No activity backfill or business record contents."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0013_download_logs"
down_revision = "0012_storage_locations"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "download_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("session_id", sa.String(64), sa.ForeignKey("auth_sessions.id"), nullable=False),
        sa.Column("initiation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source", sa.String(40), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("format", sa.String(4), nullable=False),
        sa.Column("provenance", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("session_id", "initiation_id", name="uq_download_initiation"),
        sa.CheckConstraint("format IN ('PDF','CSV','XLSX')", name="ck_download_format"),
        sa.CheckConstraint("provenance IN ('browser_reported','server_prepared')", name="ck_download_provenance"),
    )
    op.create_index("ix_download_created_id", "download_logs", ["created_at", "id"])
    op.create_index("ix_download_actor_created", "download_logs", ["actor_id", "created_at"])
    op.execute("""CREATE FUNCTION evexia_download_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Download history is append-only'; END $$""")
    op.execute("""CREATE TRIGGER download_append_only BEFORE UPDATE OR DELETE ON download_logs
                  FOR EACH ROW EXECUTE FUNCTION evexia_download_append_only()""")


def downgrade():
    op.drop_table("download_logs")
    op.execute("DROP FUNCTION evexia_download_append_only()")
