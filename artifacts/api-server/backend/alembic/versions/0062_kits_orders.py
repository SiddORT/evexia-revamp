"""Persist supply orders and independent private Kits files; no fictional backfill."""
from alembic import op
import sqlalchemy as sa

revision = "0062_kits_orders"
down_revision = "0061_immunotherapy_orders"
branch_labels = depends_on = None


def upgrade():
    op.execute("CREATE SEQUENCE kits_order_number_seq")
    op.create_table("kits_orders",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("number", sa.String(48), nullable=False, unique=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("doctor_id", sa.UUID(), sa.ForeignKey("doctor_directory.id"), nullable=False),
        sa.Column("mr_id", sa.UUID(), sa.ForeignKey("mr_directory.id")),
        sa.Column("patient_id", sa.UUID(), sa.ForeignKey("patient_directory.id")),
        sa.Column("order_for", sa.String(8), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("payment_status", sa.String(16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("snapshot_ciphertext", sa.Text(), nullable=False),
        sa.Column("created_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("version > 0", name="ck_kits_version"),
        sa.CheckConstraint("order_for IN ('doctor','mr') AND (order_for <> 'mr' OR mr_id IS NOT NULL)", name="ck_kits_order_for"),
        sa.CheckConstraint("status IN ('Confirmed','In process','Shipped','Delivered','Rejected','Returned')", name="ck_kits_status"),
        sa.CheckConstraint("payment_status IN ('Unpaid','Paid','Partial')", name="ck_kits_payment"))
    for field in ("date", "doctor_id", "mr_id", "patient_id", "order_for", "status", "payment_status"):
        op.create_index(f"ix_kits_orders_{field}", "kits_orders", [field])
    op.create_table("kits_requests",
        sa.Column("key", sa.UUID(), primary_key=True),
        sa.Column("actor_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("response_ciphertext", sa.Text(), nullable=False))
    op.add_column("files", sa.Column("kits_owner_id", sa.UUID(), sa.ForeignKey("users.id")))
    op.add_column("files", sa.Column("kits_name_ciphertext", sa.Text()))
    op.create_index("ix_files_kits_owner_id", "files", ["kits_owner_id"])
    op.drop_constraint("file_exclusive_owner", "files")
    op.create_check_constraint("file_exclusive_owner", "files", "num_nonnulls(patient_id, mr_id, kits_owner_id) = 1")
    op.create_check_constraint("file_kits_document", "files",
        "kits_owner_id IS NULL OR (category = 'documents' AND kits_name_ciphertext IS NOT NULL AND display_name ~ '^attachment\\.(jpg|jpeg|png|pdf|webp)$')")
    op.drop_constraint("file_logical_key", "files")
    op.create_check_constraint("file_logical_key", "files",
        "object_key ~ '^(patients|mrs|kits)/[0-9a-f-]{36}/(profile|documents)/[0-9a-f-]{36}\\.(jpg|jpeg|png|pdf|webp)$'"
        " AND split_part(object_key, '/', 1) = CASE WHEN patient_id IS NOT NULL THEN 'patients' WHEN mr_id IS NOT NULL THEN 'mrs' ELSE 'kits' END"
        " AND split_part(object_key, '/', 2) = COALESCE(patient_id, mr_id, kits_owner_id)::text"
        " AND split_part(object_key, '/', 3) = category"
        " AND split_part(split_part(object_key, '/', 4), '.', 1) = id::text")
    op.create_table("kits_attachments",
        sa.Column("order_id", sa.UUID(), sa.ForeignKey("kits_orders.id"), primary_key=True),
        sa.Column("file_id", sa.UUID(), sa.ForeignKey("files.id"), primary_key=True, unique=True))
    op.execute("""
      CREATE FUNCTION evexia_kits_file_guard() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM kits_attachments WHERE file_id=OLD.id)
           AND (TG_OP = 'DELETE' OR NEW.state <> 'verified'
            OR NEW.object_key IS DISTINCT FROM OLD.object_key
            OR NEW.kits_owner_id IS DISTINCT FROM OLD.kits_owner_id
            OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
            OR NEW.mr_id IS DISTINCT FROM OLD.mr_id
            OR NEW.category IS DISTINCT FROM OLD.category
            OR NEW.content_type IS DISTINCT FROM OLD.content_type
            OR NEW.size IS DISTINCT FROM OLD.size
            OR NEW.uploader_id IS DISTINCT FROM OLD.uploader_id
            OR NEW.checksum IS DISTINCT FROM OLD.checksum)
        THEN RAISE EXCEPTION 'file is referenced by a saved Kits order' USING ERRCODE='23514';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_kits_file_guard BEFORE UPDATE OR DELETE ON files
        FOR EACH ROW EXECUTE FUNCTION evexia_kits_file_guard();
    """)


def downgrade():
    raise RuntimeError("Saved supply order history and private file custody cannot be discarded")
