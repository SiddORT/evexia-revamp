"""Date-only and decimal-string configuration contract."""
import re
import uuid
from datetime import date
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator
from app.schemas.rates import rate


class ItPricingRuleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    categoryId: uuid.UUID | None = None  # Original request/retry format remains supported.
    categoryIds: list[uuid.UUID] | None = Field(default=None, min_length=1, max_length=100)
    allergenIds: list[uuid.UUID] = Field(min_length=1, max_length=100)
    allergenCategoryIds: dict[uuid.UUID, uuid.UUID] | None = Field(default=None, max_length=100)
    cutoff: date
    beforeRate: str = Field(max_length=64)
    afterRate: str = Field(max_length=64)
    idempotencyKey: uuid.UUID

    @model_validator(mode="after")
    def category_selection(self):
        if (self.categoryId is None) == (self.categoryIds is None):
            raise ValueError("Provide either categoryIds or the legacy categoryId")
        if self.allergenCategoryIds is not None and set(self.allergenCategoryIds) != set(self.allergenIds):
            raise ValueError("Provide the selected category for every selected allergen")
        return self

    @field_validator("categoryIds")
    @classmethod
    def distinct_categories(cls, value):
        if value is not None:
            if len(set(value)) != len(value):
                raise ValueError("Select each category only once")
            return sorted(value, key=str)
        return value

    def selected_categories(self):
        return self.categoryIds if self.categoryIds is not None else [self.categoryId]

    def retry_body(self):
        # Preserve the exact historical canonical shape (including edit version).
        excluded = {"idempotencyKey", "categoryIds" if self.categoryId is not None else "categoryId"}
        if self.allergenCategoryIds is None:
            excluded.add("allergenCategoryIds")
        return self.model_dump(mode="json", exclude=excluded)

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
    savedCategoryId: uuid.UUID | None = None


class ItPricingRuleSaved(BaseModel):
    id: uuid.UUID
    version: int
    category: ItPricingReference
    categories: list[ItPricingReference]
    allergens: list[ItPricingAllergenReference]
    cutoff: date
    beforeRate: str
    afterRate: str

    @model_validator(mode="before")
    @classmethod
    def historical_outcome(cls, value):
        # Adapt original encrypted outcomes in memory; never rewrite retry history.
        if isinstance(value, dict) and "categories" not in value:
            value = {**value, "categories": [value["category"]],
                     "allergens": [{**a, "savedCategoryId": value["category"]["id"]}
                                   for a in value["allergens"]]}
        return value


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
    catalogueVersion: str
