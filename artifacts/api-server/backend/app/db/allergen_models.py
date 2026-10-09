"""Shared catalogue only: never used by browser-local procurement."""
import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps
from app.db.courier_models import normalized_name


class AllergenProduct(Timestamps, Base):
    __tablename__ = "allergen_products"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_allergen_version"),
        CheckConstraint("status IN ('active', 'inactive')", name="ck_allergen_status"),
        CheckConstraint("length(name) BETWEEN 1 AND 200 AND name = btrim(name)", name="ck_allergen_name"),
        CheckConstraint("length(concentration) BETWEEN 1 AND 200 AND concentration = btrim(concentration)", name="ck_allergen_concentration"),
        CheckConstraint("selling_price >= 0 AND selling_price <= 999999999999.999999", name="ck_allergen_price"),
        CheckConstraint("gst >= 0 AND gst <= 100", name="ck_allergen_gst"),
        CheckConstraint("threshold_limit >= 0 AND threshold_limit <= 999999999999.999999", name="ck_allergen_threshold"),
        CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_allergen_deletion"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_categories.id"), nullable=False, index=True)
    storage_location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("storage_locations.id"), nullable=False, index=True)
    selling_price: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))
    gst: Mapped[Decimal] = mapped_column(Numeric(9, 6), nullable=False)
    concentration: Mapped[str] = mapped_column(String(200), nullable=False)
    threshold_limit: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))
    mix: Mapped[bool] = mapped_column(Boolean, nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


Index("uq_allergen_live_name", normalized_name(AllergenProduct.name), unique=True,
      postgresql_where=AllergenProduct.deleted_at.is_(None))
Index("ix_allergen_live_order", AllergenProduct.created_at.desc(), AllergenProduct.id.desc(),
      postgresql_where=AllergenProduct.deleted_at.is_(None))
