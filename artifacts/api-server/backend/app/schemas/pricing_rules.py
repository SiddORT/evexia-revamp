"""Date-only and decimal-string configuration contract."""
import re
import uuid
from datetime import date
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator
from app.schemas.rates import rate


class ItPricingRuleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    categoryId: uuid.UUID
    allergenIds: list[uuid.UUID] = Field(min_length=1, max_length=100)
    cutoff: date
    beforeRate: str = Field(max_length=64)
    afterRate: str = Field(max_length=64)
    idempotencyKey: uuid.UUID

    @field_validator("cutoff", mode="before")
    @classmethod
    def date_only(cls, value):
        if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError("Order Date Cutoff must be a real date in YYYY-MM-DD format")
        return value

    @field_validator("beforeRate", "afterRate", mode="before")
    @classmethod
    def exact_rate(cls, value):
        return rate(value)

    @field_validator("allergenIds")
    @classmethod
    def distinct(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Select each allergen only once")
        return sorted(value, key=str)


class ItPricingRuleEdit(ItPricingRuleInput):
    expected_version: StrictInt = Field(ge=1, le=2147483646)


class ItPricingReference(BaseModel):
    id: uuid.UUID
    name: str
    status: str


class ItPricingAllergenReference(ItPricingReference):
    categoryId: uuid.UUID


class ItPricingRuleSaved(BaseModel):
    id: uuid.UUID
    version: int
    category: ItPricingReference
    allergens: list[ItPricingAllergenReference]
    cutoff: date
    beforeRate: str
    afterRate: str


class ItPricingRulePage(BaseModel):
    items: list[ItPricingRuleSaved]
    total: int
    offset: int
    limit: int


class ItPricingReferencePage(BaseModel):
    items: list[ItPricingAllergenReference | ItPricingReference]
    total: int
    offset: int
    limit: int
