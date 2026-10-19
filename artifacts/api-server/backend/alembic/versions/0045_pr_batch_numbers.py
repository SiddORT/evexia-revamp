"""Add PR batch policy, scoped counters and durable retries. Operator-only."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0045_pr_batch_numbers"
down_revision = "0044_purchase_received"
branch_labels = depends_on = None


def upgrade():
    op.create_table("pr_batch_settings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=True),
        sa.CheckConstraint("id = 1 AND version >= 1", name="ck_pr_batch_singleton"),
        sa.CheckConstraint("(payload_ciphertext IS NULL AND version = 1) OR payload_ciphertext LIKE 'v1:%'", name="ck_pr_batch_policy_cipher"))
    # Explicit initial Manual marker, not a fallback for missing schema/rows.
    op.execute("INSERT INTO pr_batch_settings (id, version) VALUES (1, 1)")
    op.create_table("pr_batch_counters",
        sa.Column("scope", sa.String(36), primary_key=True),
        sa.Column("value", sa.BigInteger, nullable=False),
        sa.CheckConstraint("value >= 1", name="ck_pr_batch_counter_positive"))
    op.create_table("pr_batch_allocations",
        sa.Column("key", UUID, primary_key=True),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=False),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_pr_batch_allocation_cipher"))


def downgrade():
    connection = op.get_bind()
    for table in ("pr_batch_allocations", "pr_batch_counters"):
        if connection.scalar(sa.text(f"SELECT EXISTS (SELECT 1 FROM {table})")):
            raise RuntimeError("Batch allocation history cannot be discarded. Restore reviewed external recovery instead.")
    if connection.scalar(sa.text("SELECT version FROM pr_batch_settings WHERE id=1")) != 1:
        raise RuntimeError("Saved batch settings require reviewed external recovery.")
    for table in ("pr_batch_allocations", "pr_batch_counters", "pr_batch_settings"):
        op.drop_table(table)
