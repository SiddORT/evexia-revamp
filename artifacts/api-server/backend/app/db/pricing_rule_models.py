"""Protected configuration and immutable retry outcomes; orders snapshot applied rules."""
import uuid
from datetime import datetime
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, Text, UniqueConstraint, String
from datetime import date
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class CombinationRequest(Base):
    # Existing encrypted outcomes are retained byte-for-byte by table rename.
    # Keep the existing encryption context so unresolved retries remain readable.
    __tablename__ = "it_combination_requests"
    __table_args__ = (
        CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_it_combination_request_cipher"),
    )
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    payload_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)


class CombinationTariff(Base):
    """Exact member/dosage total MRP revisions used by new order quotations."""
    __tablename__ = "it_combination_tariffs"
    __table_args__ = (
        UniqueConstraint("category_id", "dosage", "member_key", "effective_from", name="uq_it_combination_date"),
        UniqueConstraint("category_id", "dosage", "member_key", "version", name="uq_it_combination_version"),
        CheckConstraint("version >= 1", name="ck_it_combination_version"),
        CheckConstraint("dosage IN ('PD','DD','B1','B2','B3','B4','B5','B6','B7','B8')", name="ck_it_combination_dosage"),
        CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_it_combination_cipher"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_categories.id"))
    dosage: Mapped[str] = mapped_column(String(2))
    member_key: Mapped[str] = mapped_column(String(110))
    effective_from: Mapped[date] = mapped_column(Date)
    version: Mapped[int] = mapped_column(Integer)
    payload_ciphertext: Mapped[str] = mapped_column(Text)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class CombinationRuleStatus(Base):
    """Append-only independent configuration status; version 1 is initialization."""
    __tablename__ = "it_combination_rule_status"
    __table_args__ = (
        UniqueConstraint("category_id", "dosage", "member_key", "version", name="uq_it_combination_status_version"),
        CheckConstraint("version >= 1", name="ck_it_combination_status_version"),
        CheckConstraint("status IN ('active','inactive')", name="ck_it_combination_status"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_categories.id"))
    dosage: Mapped[str] = mapped_column(String(2))
    member_key: Mapped[str] = mapped_column(String(110))
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(8))
    revision_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("it_combination_tariffs.id"))
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
