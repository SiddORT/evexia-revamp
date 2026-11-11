"""Prepared invoice configuration/history; no seeds or business-data changes."""
from alembic import op
import sqlalchemy as sa

revision = "0089_invoice_settings"
down_revision = "0088_gst_settings"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "invoice_settings_revisions",
        sa.Column("version", sa.Integer(), primary_key=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.CheckConstraint("version BETWEEN 1 AND 2147483647", name="ck_invoice_revision_version"),
    )
    op.create_table(
        "invoice_settings_requests",
        sa.Column("key", sa.Uuid(), primary_key=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("version", sa.Integer(), sa.ForeignKey("invoice_settings_revisions.version")),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("state IN ('pending','committed','cancelled')", name="ck_invoice_request_state"),
        sa.CheckConstraint("(state = 'committed' AND version IS NOT NULL) OR "
                           "(state <> 'committed' AND version IS NULL)", name="ck_invoice_request_result"),
    )
    op.create_index("ix_invoice_pending_age", "invoice_settings_requests", ["state", "created_at"])
    # Runtime roles cannot rewrite or delete history, even accidentally.
    op.execute("""
        CREATE FUNCTION protect_invoice_settings_history() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Invoice configuration history is append-only'; END $$;
        CREATE TRIGGER invoice_settings_history_immutable
        BEFORE UPDATE OR DELETE ON invoice_settings_revisions
        FOR EACH ROW EXECUTE FUNCTION protect_invoice_settings_history();
        CREATE TRIGGER invoice_settings_history_no_truncate
        BEFORE TRUNCATE ON invoice_settings_revisions
        FOR EACH STATEMENT EXECUTE FUNCTION protect_invoice_settings_history();
    """)


def downgrade():
    raise RuntimeError("Invoice history is durable; restore a reviewed backup instead.")
