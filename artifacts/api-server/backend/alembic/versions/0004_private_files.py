"""Private file ownership, lifecycle metadata and expiring local grants."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0004_private_files"
down_revision = "0003_system_domain"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "files",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("patient_id", UUID(as_uuid=True), sa.ForeignKey("patients.id")),
        sa.Column("mr_id", UUID(as_uuid=True), sa.ForeignKey("mr_profiles.id")),
        sa.Column("category", sa.String(16), nullable=False),
        sa.Column("object_key", sa.String(160), nullable=False, unique=True),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(32), nullable=False),
        sa.Column("size", sa.Integer, nullable=False),
        sa.Column("checksum", sa.String(64)),
        sa.Column("uploader_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("state", sa.String(20), nullable=False),
        sa.Column("scanner_status", sa.String(16), nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("replaces_id", UUID(as_uuid=True), sa.ForeignKey("files.id")),
        sa.Column("replaces_version", sa.Integer),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("(patient_id IS NULL) <> (mr_id IS NULL)", name="file_exclusive_owner"),
        sa.CheckConstraint("category IN ('profile','documents')", name="file_category"),
        sa.CheckConstraint("state IN ('uploading','quarantined','verified','rejected','pending_delete','deleted')", name="file_state"),
        sa.CheckConstraint("size >= 0 AND size <= 104857600", name="file_size"),
        sa.CheckConstraint("version > 0", name="file_version"),
        sa.CheckConstraint("content_type IN ('image/jpeg','image/png','application/pdf')", name="file_media"),
        sa.CheckConstraint("category <> 'profile' OR content_type <> 'application/pdf'", name="file_profile_image"),
        sa.CheckConstraint("checksum IS NULL OR checksum ~ '^[0-9a-f]{64}$'", name="file_checksum"),
        sa.CheckConstraint("state <> 'verified' OR (size > 0 AND checksum IS NOT NULL AND scanner_status = 'clean')", name="file_verified"),
        sa.CheckConstraint("scanner_status IN ('pending','clean','infected','unavailable','error')", name="file_scanner"),
        sa.CheckConstraint("length(display_name) BETWEEN 1 AND 255", name="file_name"),
        sa.CheckConstraint(
            "object_key ~ '^(patients|mrs)/[0-9a-f-]{36}/(profile|documents)/[0-9a-f-]{36}\\.(jpg|jpeg|png|pdf)$'"
            " AND split_part(object_key, '/', 1) = CASE WHEN patient_id IS NOT NULL THEN 'patients' ELSE 'mrs' END"
            " AND split_part(object_key, '/', 2) = COALESCE(patient_id, mr_id)::text"
            " AND split_part(object_key, '/', 3) = category"
            " AND split_part(split_part(object_key, '/', 4), '.', 1) = id::text", name="file_logical_key",
        ),
    )
    for column in ("patient_id", "mr_id", "replaces_id"):
        op.create_index(f"ix_files_{column}", "files", [column])
    op.create_index("ix_files_recovery", "files", ["state", "updated_at"])
    op.create_table(
        "download_grants",
        sa.Column("digest", sa.String(64), primary_key=True),
        sa.Column("file_id", UUID(as_uuid=True), sa.ForeignKey("files.id"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("identity_version", sa.Integer, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_download_grants_expiry", "download_grants", ["expires_at"])


def downgrade():
    # Deliberately do not delete external objects. Operators must back up metadata
    # and objects together before rollback; otherwise objects become orphaned.
    op.drop_table("download_grants")
    op.drop_table("files")