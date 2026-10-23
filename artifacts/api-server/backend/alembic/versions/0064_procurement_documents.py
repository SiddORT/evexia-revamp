"""Archive canonical documents only for future successful saves; no backfill."""
from alembic import op
import sqlalchemy as sa

revision = "0064_procurement_documents"
down_revision = "0063_spt_orders"
branch_labels = depends_on = None


def upgrade():
    op.add_column("purchase_order_audit", sa.Column("payload_ciphertext", sa.Text(), nullable=True))
    op.create_table("procurement_documents",
        sa.Column("event_id", sa.UUID(), sa.ForeignKey("audit_events.id"), primary_key=True),
        sa.Column("po_id", sa.UUID(), sa.ForeignKey("purchase_orders.id")),
        sa.Column("pr_id", sa.UUID(), sa.ForeignKey("purchase_receipts.id")),
        sa.Column("record_version", sa.Integer(), nullable=False),
        sa.Column("generated_at", sa.String(40), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.UniqueConstraint("po_id", "record_version"),
        sa.UniqueConstraint("pr_id", "record_version"),
        sa.CheckConstraint("(po_id IS NULL) <> (pr_id IS NULL)", name="ck_procurement_document_owner"),
        sa.CheckConstraint("record_version >= 1", name="ck_procurement_document_version"),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_procurement_document_ciphertext"))
    op.create_index("ix_procurement_documents_po_id", "procurement_documents", ["po_id"])
    op.create_index("ix_procurement_documents_pr_id", "procurement_documents", ["pr_id"])
    op.execute("""
        CREATE FUNCTION guard_procurement_document() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'Archived procurement documents are immutable';
        END $$;
        CREATE TRIGGER procurement_document_immutable BEFORE UPDATE OR DELETE
        ON procurement_documents FOR EACH ROW EXECUTE FUNCTION guard_procurement_document();
    """)


def downgrade():
    raise RuntimeError("Archived documents must be retained; restore a reviewed backup instead.")
