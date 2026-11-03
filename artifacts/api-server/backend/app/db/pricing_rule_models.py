"""Standalone configuration, never an order-price resolver."""
import uuid
from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class PricingRule(Base):
    __tablename__ = "it_pricing_rules"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_it_pricing_rule_version"),
        CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_it_pricing_rule_cipher"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_categories.id"), index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    payload_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PricingRuleTarget(Base):
    __tablename__ = "it_pricing_rule_targets"
    __table_args__ = (
        UniqueConstraint("allergen_id", name="uq_it_pricing_rule_allergen"),
    )
    rule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("it_pricing_rules.id"), primary_key=True)
    allergen_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("allergen_products.id"), primary_key=True)


class PricingRuleRequest(Base):
    __tablename__ = "it_pricing_rule_requests"
    __table_args__ = (
        CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_it_pricing_request_cipher"),
    )
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    payload_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
