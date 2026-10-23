"""SPT orders and SPT-owned patients. No fictional fixture migration."""
from alembic import op
import sqlalchemy as sa

revision = "0063_spt_orders"
down_revision = "0062_kits_orders"
branch_labels = depends_on = None


def upgrade():
    op.execute("CREATE SEQUENCE spt_order_number_seq")
    op.execute("CREATE SEQUENCE spt_patient_number_seq")
    op.create_table("spt_patients",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("code", sa.String(48), unique=True, nullable=False),
        sa.Column("snapshot_ciphertext", sa.Text(), nullable=False),
        sa.Column("created_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_table("spt_orders",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("source_id", sa.UUID(), unique=True, nullable=False),
        sa.Column("number", sa.String(48), unique=True, nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("doctor_id", sa.UUID(), sa.ForeignKey("doctor_directory.id")),
        sa.Column("mr_id", sa.UUID(), sa.ForeignKey("mr_directory.id")),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("snapshot_ciphertext", sa.Text(), nullable=False),
        sa.Column("created_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("version > 0", name="ck_spt_version"),
        sa.CheckConstraint("status IN ('Draft','Saved')", name="ck_spt_status"),
        sa.CheckConstraint("status <> 'Saved' OR (doctor_id IS NOT NULL AND mr_id IS NOT NULL)", name="ck_spt_saved_people"))
    op.create_table("spt_order_patients",
        sa.Column("order_id", sa.UUID(), sa.ForeignKey("spt_orders.id"), primary_key=True),
        sa.Column("position", sa.Integer(), primary_key=True),
        sa.Column("master_patient_id", sa.UUID(), sa.ForeignKey("patient_directory.id")),
        sa.Column("spt_patient_id", sa.UUID(), sa.ForeignKey("spt_patients.id")),
        sa.CheckConstraint("position >= 0 AND position < 200", name="ck_spt_position"),
        sa.CheckConstraint("(master_patient_id IS NULL) <> (spt_patient_id IS NULL)", name="ck_spt_patient_source"),
        sa.UniqueConstraint("order_id", "master_patient_id"),
        sa.UniqueConstraint("order_id", "spt_patient_id"))
    op.create_table("spt_requests",
        sa.Column("key", sa.UUID(), primary_key=True),
        sa.Column("actor_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("response_ciphertext", sa.Text(), nullable=False))
    for column in ("date", "doctor_id", "mr_id", "status"):
        op.create_index(f"ix_spt_orders_{column}", "spt_orders", [column])
    for column in ("master_patient_id", "spt_patient_id"):
        op.create_index(f"ix_spt_order_patients_{column}", "spt_order_patients", [column])


def downgrade():
    raise RuntimeError("SPT orders contain protected history; restore a reviewed backup instead of destructive downgrade")
