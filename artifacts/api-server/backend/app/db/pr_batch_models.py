"""Batch policy/results are PR ciphertext; scopes and counters are operational."""
import uuid
from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class PRBatchSettings(Base):
    __tablename__ = "pr_batch_settings"
    __table_args__ = (
        CheckConstraint("id = 1 AND version >= 1", name="ck_pr_batch_singleton"),
        CheckConstraint("(payload_ciphertext IS NULL AND version = 1) OR payload_ciphertext LIKE 'v1:%'", name="ck_pr_batch_policy_cipher"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[int] = mapped_column(Integer)
    payload_ciphertext: Mapped[str | None] = mapped_column(Text, nullable=True)


class PRBatchCounter(Base):
    __tablename__ = "pr_batch_counters"
    __table_args__ = (CheckConstraint("value >= 1", name="ck_pr_batch_counter_positive"),)
    scope: Mapped[str] = mapped_column(String(36), primary_key=True)
    value: Mapped[int] = mapped_column(BigInteger)


class PRBatchAllocation(Base):
    __tablename__ = "pr_batch_allocations"
    __table_args__ = (CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_pr_batch_allocation_cipher"),)
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    payload_ciphertext: Mapped[str] = mapped_column(Text)
