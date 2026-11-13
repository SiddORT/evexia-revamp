"""Protected configuration and immutable retry outcomes; orders snapshot applied rules."""
import uuid
from datetime import datetime
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, Text, UniqueConstraint
from datetime import date
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
    # Immutable attribution at explicit save, not today's catalogue category.
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_categories.id"), nullable=False)


class PricingRuleCategory(Base):
    __tablename__ = "it_pricing_rule_categories"
    rule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("it_pricing_rules.id"), primary_key=True)
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_categories.id"), primary_key=True)


class PricingRuleRequest(Base):
    __tablename__ = "it_pricing_rule_requests"
    __table_args__ = (
        CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_it_pricing_request_cipher"),
    )
    key: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    payload_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)


class CategoryCountTariff(Base):
    """Append-only dated revisions; the amount is encrypted, never a live price."""
    __tablename__ = "it_category_count_tariffs"
    __table_args__ = (
        UniqueConstraint("category_id", "allergen_count", "effective_from", name="uq_it_tariff_date"),
        UniqueConstraint("category_id", "allergen_count", "version", name="uq_it_tariff_version"),
        CheckConstraint("allergen_count BETWEEN 1 AND 3 AND version >= 1", name="ck_it_tariff_count_version"),
        CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_it_tariff_cipher"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_categories.id"))
    allergen_count: Mapped[int] = mapped_column(Integer)
    effective_from: Mapped[date] = mapped_column(Date)
    version: Mapped[int] = mapped_column(Integer)
    payload_ciphertext: Mapped[str] = mapped_column(Text)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
