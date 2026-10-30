"""Separate encrypted manufactured concentrate reserves, never usable inventory."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0076_in_house_stock"
down_revision = "0075_shipments"
branch_labels = depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.create_table("in_house_stock",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("audit_events.id"), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_in_house_cipher"))
    op.create_index("ix_in_house_stock_created_at", "in_house_stock", ["created_at"])
    op.create_table("in_house_stock_requests",
        sa.Column("key", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_in_house_request_cipher"))
    op.execute("""
      CREATE FUNCTION guard_in_house_reserve() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Concentrate reserves and request outcomes are immutable'; END $$;
      CREATE TRIGGER in_house_reserve_immutable BEFORE UPDATE OR DELETE ON in_house_stock
        FOR EACH ROW EXECUTE FUNCTION guard_in_house_reserve();
      CREATE TRIGGER in_house_request_immutable BEFORE UPDATE OR DELETE ON in_house_stock_requests
        FOR EACH ROW EXECUTE FUNCTION guard_in_house_reserve();
    """)


def downgrade():
    raise RuntimeError("Committed concentrate reserves are append-only; destructive downgrade is unsupported.")
