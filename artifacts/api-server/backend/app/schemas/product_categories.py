import re
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


PRICE = re.compile(r"^(?:0|[0-9]+)(?:\.[0-9]{1,6})?$")


def exact_price(value):
    """Plain decimal strings only: never accept or round a binary float."""
    if not isinstance(value, str) or len(value) > 64 or not PRICE.fullmatch(value.strip()):
        raise ValueError("Use a non-negative decimal string with at most six fractional digits")
    value = value.strip()
    if len(value.split(".")[0].lstrip("0")) > 12:
        raise ValueError("At most twelve integer digits")
    return format(Decimal(value), ".6f")


class ProductCategoryFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    unit_price: str = Field(min_length=1, max_length=64, description="Exact plain decimal string; 0–999999999999.999999, at most six fractional digits.")
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
