"""Encrypted communication configuration; operator-approved activation only."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0039_communication"
down_revision = "0038_purchase_orders"
branch_labels = depends_on = None


def upgrade():
    op.create_table("communication_channels",
        sa.Column("channel", sa.String(8), primary_key=True),
        sa.Column("version", sa.Integer, nullable=False),
        sa.CheckConstraint("channel IN ('email','sms','waba')", name="ck_comm_channel"),
        sa.CheckConstraint("version >= 1", name="ck_comm_channel_version"))
    op.execute("INSERT INTO communication_channels VALUES ('email',1),('sms',1),('waba',1)")
    op.create_table("communication_configurations",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("channel", sa.String(8), sa.ForeignKey("communication_channels.channel"), nullable=False),
        sa.Column("type", sa.String(8), nullable=False),
        sa.Column("is_default", sa.Boolean, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=False),
        sa.Column("secret_ciphertext", sa.Text, nullable=False),
        *[sa.Column(f, UUID, sa.ForeignKey("users.id"), nullable=False) for f in ("created_by", "updated_by")],
        *[sa.Column(f, sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False) for f in ("created_at", "updated_at")],
        sa.CheckConstraint("version >= 1", name="ck_comm_version"),
        sa.CheckConstraint("(channel = 'email' AND type IN ('smtp','api','platform')) OR (channel IN ('sms','waba') AND type = 'api')", name="ck_comm_type"),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%' AND secret_ciphertext LIKE 'v1:%'", name="ck_comm_encrypted"))
    op.create_index("uq_comm_default", "communication_configurations", ["channel"], unique=True, postgresql_where=sa.text("is_default"))


def downgrade():
    op.drop_table("communication_configurations")
    op.drop_table("communication_channels")
