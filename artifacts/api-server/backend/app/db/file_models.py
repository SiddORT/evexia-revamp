"""Private file metadata: never store binary contents or physical paths."""
import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FileRecord(Base):
    __tablename__ = "files"
    __table_args__ = (
        CheckConstraint("(patient_id IS NULL) <> (mr_id IS NULL)", name="file_exclusive_owner"),
        CheckConstraint("category IN ('profile','documents')", name="file_category"),
        CheckConstraint("state IN ('uploading','quarantined','verified','rejected','pending_delete','deleted')", name="file_state"),
        CheckConstraint("size >= 0 AND size <= 104857600", name="file_size"),
        CheckConstraint("version > 0", name="file_version"),
        CheckConstraint("content_type IN ('image/jpeg','image/png','application/pdf')", name="file_media"),
        CheckConstraint("category <> 'profile' OR content_type <> 'application/pdf'", name="file_profile_image"),
        CheckConstraint("checksum IS NULL OR checksum ~ '^[0-9a-f]{64}$'", name="file_checksum"),
        CheckConstraint("state <> 'verified' OR (size > 0 AND checksum IS NOT NULL AND scanner_status = 'clean')", name="file_verified"),
        CheckConstraint("scanner_status IN ('pending','clean','infected','unavailable','error')", name="file_scanner"),
        CheckConstraint("length(display_name) BETWEEN 1 AND 255", name="file_name"),
        CheckConstraint(
            "object_key ~ '^(patients|mrs)/[0-9a-f-]{36}/(profile|documents)/[0-9a-f-]{36}\\.(jpg|jpeg|png|pdf)$'"
            " AND split_part(object_key, '/', 1) = CASE WHEN patient_id IS NOT NULL THEN 'patients' ELSE 'mrs' END"
            " AND split_part(object_key, '/', 2) = COALESCE(patient_id, mr_id)::text"
            " AND split_part(object_key, '/', 3) = category"
            " AND split_part(split_part(object_key, '/', 4), '.', 1) = id::text",
            name="file_logical_key",
        ),
        Index("ix_files_recovery", "state", "updated_at"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("patients.id"), index=True)
    mr_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mr_profiles.id"), index=True)
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    object_key: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(32), nullable=False)
    size: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    checksum: Mapped[str | None] = mapped_column(String(64))
    uploader_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    state: Mapped[str] = mapped_column(String(20), default="uploading", nullable=False)
    scanner_status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    replaces_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("files.id"), index=True)
    replaces_version: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DownloadGrant(Base):
    __tablename__ = "download_grants"
    __table_args__ = (Index("ix_download_grants_expiry", "expires_at"),)
    digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("files.id"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    identity_version: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)