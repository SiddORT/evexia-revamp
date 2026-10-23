"""Encrypted historical immunotherapy orders and durable atomic requests."""
from alembic import op
import sqlalchemy as sa

revision = "0061_immunotherapy_orders"
down_revision = "0060_staff_account_numbers"
branch_labels = depends_on = None


def upgrade():
    op.drop_constraint("file_media", "files")
    op.create_check_constraint("file_media", "files", "content_type IN ('image/jpeg','image/png','application/pdf','image/webp')")
    op.drop_constraint("file_logical_key", "files")
    op.create_check_constraint("file_logical_key", "files",
        "object_key ~ '^(patients|mrs)/[0-9a-f-]{36}/(profile|documents)/[0-9a-f-]{36}\\.(jpg|jpeg|png|pdf|webp)$'"
        " AND split_part(object_key, '/', 1) = CASE WHEN patient_id IS NOT NULL THEN 'patients' ELSE 'mrs' END"
        " AND split_part(object_key, '/', 2) = COALESCE(patient_id, mr_id)::text"
        " AND split_part(object_key, '/', 3) = category"
        " AND split_part(split_part(object_key, '/', 4), '.', 1) = id::text")
    op.execute("CREATE SEQUENCE immunotherapy_order_number_seq")
    op.create_table("immunotherapy_orders",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("number", sa.String(48), nullable=False, unique=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("patient_id", sa.UUID(), sa.ForeignKey("patient_directory.id"), nullable=False),
        sa.Column("doctor_id", sa.UUID(), sa.ForeignKey("doctor_directory.id"), nullable=False),
        sa.Column("mr_id", sa.UUID(), sa.ForeignKey("mr_directory.id"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("snapshot_ciphertext", sa.Text(), nullable=False),
        sa.Column("created_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.CheckConstraint("version > 0", name="ck_imm_version"),
        sa.CheckConstraint("status IN ('Confirmed','In process','Shipped','Delivered','Rejected','Returned')", name="ck_imm_status"))
    for field in ("patient_id", "doctor_id", "mr_id", "status", "date"):
        op.create_index(f"ix_immunotherapy_orders_{field}", "immunotherapy_orders", [field])
    op.create_table("immunotherapy_items",
        sa.Column("order_id", sa.UUID(), sa.ForeignKey("immunotherapy_orders.id"), primary_key=True),
        sa.Column("bottle", sa.Integer(), primary_key=True),
        sa.Column("allergen_id", sa.UUID(), sa.ForeignKey("allergen_products.id"), primary_key=True))
    op.create_table("immunotherapy_attachments",
        sa.Column("order_id", sa.UUID(), sa.ForeignKey("immunotherapy_orders.id"), primary_key=True),
        sa.Column("file_id", sa.UUID(), sa.ForeignKey("files.id"), primary_key=True))
    op.create_index("ix_imm_attachment_file", "immunotherapy_attachments", ["file_id"])
    op.create_table("immunotherapy_requests",
        sa.Column("key", sa.UUID(), primary_key=True),
        sa.Column("actor_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("response_ciphertext", sa.Text(), nullable=False))
    # Protect order-linked bytes even from cleanup/replacement outside this UI.
    op.execute("""
      CREATE FUNCTION evexia_imm_file_guard() RETURNS trigger AS $$
      BEGIN
        IF (NEW.state <> 'verified' OR NEW.object_key <> OLD.object_key
            OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
            OR NEW.checksum IS DISTINCT FROM OLD.checksum)
           AND EXISTS (SELECT 1 FROM immunotherapy_attachments WHERE file_id=OLD.id)
        THEN RAISE EXCEPTION 'file is referenced by a saved order' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_imm_file_guard BEFORE UPDATE ON files
        FOR EACH ROW EXECUTE FUNCTION evexia_imm_file_guard();
    """)


def downgrade():
    raise RuntimeError("Historical clinical orders must not be discarded by downgrade")
