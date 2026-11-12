"""Staged only: immutable opening corrections and revision-specific lots."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0098_opening_corrections"
down_revision = "0097_hsn_staged_merge"
branch_labels = depends_on = None


def upgrade():
    op.create_table("opening_stock_revisions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("opening_id", UUID, sa.ForeignKey("opening_stock.id"), nullable=False, index=True),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("event_id", UUID, sa.ForeignKey("audit_events.id"), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=False),
        sa.UniqueConstraint("opening_id", "version", name="uq_opening_revision"),
        sa.CheckConstraint("version >= 2", name="ck_opening_revision_version"),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_opening_revision_cipher"))
    # Constraint names can differ on independently restored databases.
    for constraint in sa.inspect(op.get_bind()).get_unique_constraints("inventory_lots"):
        if constraint["column_names"] == ["opening_id"]:
            op.drop_constraint(constraint["name"], "inventory_lots", type_="unique")
    op.add_column("inventory_lots", sa.Column("opening_revision", sa.Integer, nullable=False, server_default="1"))
    op.create_unique_constraint("uq_inventory_opening_revision", "inventory_lots", ["opening_id", "opening_revision"])
    op.execute("CREATE TRIGGER opening_stock_revisions_immutable BEFORE UPDATE OR DELETE ON opening_stock_revisions FOR EACH ROW EXECUTE FUNCTION inventory_immutable()")
    op.execute("CREATE TRIGGER opening_stock_revisions_no_truncate BEFORE TRUNCATE ON opening_stock_revisions FOR EACH STATEMENT EXECUTE FUNCTION inventory_immutable()")


def downgrade():
    raise RuntimeError("Opening corrections retain immutable evidence; use independently reviewed recovery.")
