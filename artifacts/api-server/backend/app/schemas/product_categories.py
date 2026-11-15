import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from app.schemas.rates import rate, source_decimal
from app.schemas.master_validation import MasterWriteFields


def exact_price(value):
    """Rates accept the historical source precision and commit half-up cents."""
    return rate(value)


def exact_quantity(value):
    """Retain bounded source parsing; operational thresholds use hundredths."""
    return rate(value)


class ProductCategoryFields(MasterWriteFields):
    master_names = {"name": ("product category name", False)}
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    # No schema-level default: generated edit parsers must retain omission too.
    unit_price: str = Field(default_factory=lambda: "0.00", max_length=64, description="Optional on writes; omitted or blank creates use zero. Omitted or blank edits preserve the saved price. Supplied decimals accept six source places, round half-up to two places, maximum 999999999999.99.")
    status: Literal["active", "inactive"]

    @field_validator("name", "description", mode="before")
    @classmethod
    def normalize(cls, value):
        # Names are normalized by the write-only base; descriptions are free
        # text, not business keys. Keep their whitespace and line breaks.
        return value

    @field_validator("name", "description")
    @classmethod
    def printable(cls, value, info):
        allowed = "\n\r\t" if info.field_name == "description" else ""
        if any((ord(char) < 32 and char not in allowed) or 0xD800 <= ord(char) <= 0xDFFF or char in "\ufffe\uffff" for char in value):
            raise ValueError("Unsupported characters")
        return value

    @field_validator("unit_price", mode="before")
    @classmethod
    def price(cls, value):
        return exact_price("0" if not cls.master_read and isinstance(value, str) and not value.strip() else value)


class ProductCategoryVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class ProductCategoryEdit(ProductCategoryFields, ProductCategoryVersion):
    @model_validator(mode="before")
    @classmethod
    def retain_blank_price(cls, values):
        # Blank is absence, not an instruction to zero an existing record.
        if isinstance(values, dict) and isinstance(values.get("unit_price"), str) and not values["unit_price"].strip():
            return {key: value for key, value in values.items() if key != "unit_price"}
        return values


class ProductCategoryStatus(ProductCategoryVersion):
    status: Literal["active", "inactive"]


class ProductCategoryResponse(ProductCategoryFields):
    master_read = True
    unit_price: str = Field(min_length=1, max_length=64, description="Saved catalogue price, returned with exactly two fractional digits.")
    id: uuid.UUID
    version: int
    createdBy: str
    updatedBy: str
    createdAt: datetime
    updatedAt: datetime


class ProductCategoryPage(BaseModel):
    items: list[ProductCategoryResponse]
    total: int
    filtered: int
    limit: int
    offset: int


class ProductCategoryImportRow(BaseModel):
    row: int
    name: str
    description: str
    unit_price: str
    status: str
    errors: list[str]


class ProductCategoryReview(BaseModel):
    rows: list[ProductCategoryImportRow]
    valid: bool
    digest: str


class ProductCategoryImportResult(BaseModel):
    imported: int
