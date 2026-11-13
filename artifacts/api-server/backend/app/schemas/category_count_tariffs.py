"""Category/count money is independent of dosage/ranked clinical quantities."""
import uuid
from datetime import date, datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.schemas.pricing_rules import ItPricingReference
from app.schemas.rates import rate
import re

POLICY = "category_count_total_mrp_v1"


class CategoryCountTariffInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    categoryId: uuid.UUID
    allergenCount: int = Field(strict=True, ge=1, le=3)
    totalMrp: str = Field(max_length=64)
    effectiveFrom: date
    expected_version: int = Field(strict=True, ge=0, le=2147483646)
    idempotencyKey: uuid.UUID

    @field_validator("effectiveFrom", mode="before")
    @classmethod
    def explicit_date(cls, value):
        if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError("Effective From requires a real YYYY-MM-DD date")
        return value

    @field_validator("totalMrp", mode="before")
    @classmethod
    def exact_amount(cls, value):
        return rate(value)


class CategoryCountTariffSaved(BaseModel):
    id: uuid.UUID
    categoryId: uuid.UUID
    allergenCount: int
    totalMrp: str
    effectiveFrom: date
    version: int
    actorId: uuid.UUID
    recordedAt: datetime


class CategoryCountTariffView(BaseModel):
    categoryId: uuid.UUID
    categoryName: str
    suggestedUnitPrice: str | None
    suggestionError: str | None = None
    categoryVersion: int
    history: list[CategoryCountTariffSaved]


class CategoryCountTariffCategoryPage(BaseModel):
    items: list[ItPricingReference]
    nextOffset: int | None
