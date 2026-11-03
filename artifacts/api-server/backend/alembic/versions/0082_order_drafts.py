"""Add isolated encrypted incomplete order documents; no historical rewrites."""
from alembic import op
import sqlalchemy as sa

revision = "0082_order_drafts"
down_revision = "0081_immunotherapy_alerts"
branch_labels = depends_on = None


def upgrade():
    op.create_table("order_drafts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("mr_scope", sa.Uuid(), sa.ForeignKey("mr_directory.id")),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.Column("last_request", sa.Uuid(), nullable=False),
        sa.Column("submitted_order_id", sa.Uuid()),
        sa.Column("submitted_version", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind IN ('immunotherapy','kits','lupin')", name="ck_order_draft_kind"),
        sa.CheckConstraint("version > 0", name="ck_order_draft_version"),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_order_draft_cipher"),
        sa.CheckConstraint("(submitted_order_id IS NULL) = (submitted_version IS NULL)", name="ck_order_draft_submission"))
    op.create_index("ix_order_draft_owner_kind", "order_drafts", ["created_by", "kind", "id"])
    op.create_table("order_draft_attachments",
        sa.Column("draft_id", sa.Uuid(), sa.ForeignKey("order_drafts.id"), primary_key=True),
        sa.Column("file_id", sa.Uuid(), sa.ForeignKey("files.id"), primary_key=True, unique=True))
    op.create_table("order_draft_requests",
        sa.Column("key", sa.Uuid(), primary_key=True),
        sa.Column("draft_id", sa.Uuid(), sa.ForeignKey("order_drafts.id"), nullable=False),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("response_ciphertext", sa.Text(), nullable=False),
        sa.CheckConstraint("response_ciphertext LIKE 'v1:%'", name="ck_order_draft_request_cipher"))
    op.create_index("ix_order_draft_requests_draft_id", "order_draft_requests", ["draft_id"])


def downgrade():
    # Removing incomplete documents is destructive and requires operator custody.
    raise RuntimeError("Export/recover encrypted drafts before a separately approved downgrade.")
