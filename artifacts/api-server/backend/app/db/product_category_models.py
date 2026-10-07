import uuid
from datetime import datetime
from decimal import Decimal
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps
from app.db.courier_models import normalized_name


class ProductCategory(Timestamps, Base):
    __tablename__ = "product_categories"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_product_category_version"),
        CheckConstraint("status IN ('active', 'inactive')", name="ck_product_category_status"),
        CheckConstraint("length(name) BETWEEN 1 AND 200 AND name = btrim(name)", name="ck_product_category_name"),
        CheckConstraint("length(description) <= 2000 AND description = btrim(description)", name="ck_product_category_description"),
        CheckConstraint("unit_price >= 0 AND unit_price <= 999999999999.999999", name="ck_product_category_price"),
        CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_product_category_deletion"),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(String(2000), nullable=False, default="")
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


Index("uq_product_category_live_name", normalized_name(ProductCategory.name), unique=True,
      postgresql_where=ProductCategory.deleted_at.is_(None))
