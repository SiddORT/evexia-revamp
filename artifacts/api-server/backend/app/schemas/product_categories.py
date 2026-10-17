import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.schemas.rates import rate, source_decimal


def exact_price(value):
    """Rates accept the historical source precision and commit half-up cents."""
    return rate(value)


def exact_quantity(value):
    """Thresholds are NOT rates; retain their six-place contract."""
    return format(source_decimal(value), ".6f")


class ProductCategoryFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    unit_price: str = Field(min_length=1, max_length=64, description="Plain decimal string with up to six source fractional digits; half-up rounded to two places. Rounded maximum 999999999999.99; returned with exactly two fractional digits.")
    status: Literal["active", "inactive"]

    @field_validator("name", "description", mode="before")
    @classmethod
    def normalize(cls, value):
        return " ".join(value.split()) if isinstance(value, str) else value

    @field_validator("name", "description")
    @classmethod
    def printable(cls, value):
        if any(ord(char) < 32 or 0xD800 <= ord(char) <= 0xDFFF or char in "\ufffe\uffff" for char in value):
            raise ValueError("Unsupported characters")
        return value

    @field_validator("unit_price", mode="before")
    @classmethod
    def price(cls, value):
        return exact_price(value)


class ProductCategoryVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class ProductCategoryEdit(ProductCategoryFields, ProductCategoryVersion):
    pass


class ProductCategoryStatus(ProductCategoryVersion):
    status: Literal["active", "inactive"]


class ProductCategoryResponse(ProductCategoryFields):
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
