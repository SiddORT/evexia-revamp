import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.schemas.product_categories import exact_price

BUSINESS_FIELDS = ("name", "category_id", "storage_location_id", "selling_price", "gst",
                   "concentration", "threshold_limit", "status", "mix")


class AllergenFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    category_id: uuid.UUID
    storage_location_id: uuid.UUID
    selling_price: str | None = Field(default=None, max_length=64)
    gst: str = Field(min_length=1, max_length=64)
    concentration: str = Field(min_length=1, max_length=200)
    threshold_limit: str | None = Field(default=None, max_length=64)
    status: Literal["active", "inactive"]
    mix: bool = Field(strict=True, description="True means Mix; false means No Mix. Catalogue metadata, not a stock operation.")

    @field_validator("name", "concentration", mode="before")
    @classmethod
    def normalize(cls, value):
        return " ".join(value.split()) if isinstance(value, str) else value

    @field_validator("name", "concentration")
    @classmethod
    def printable(cls, value):
        if any(ord(char) < 32 or 0xD800 <= ord(char) <= 0xDFFF or char in "\ufffe\uffff" for char in value):
            raise ValueError("Unsupported characters")
        return value

    @field_validator("selling_price", "threshold_limit", mode="before")
    @classmethod
    def optional_decimal(cls, value):
        return None if value is None else exact_price(value)

    @field_validator("gst", mode="before")
    @classmethod
    def tax(cls, value):
        result = exact_price(value)
        if Decimal(result) > 100:
            raise ValueError("GST must be between zero and 100")
        return result


class AllergenVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class AllergenEdit(AllergenFields, AllergenVersion):
    pass


class AllergenStatus(AllergenVersion):
    status: Literal["active", "inactive"]


class AllergenResponse(AllergenFields):
    id: uuid.UUID
    version: int
    category_name: str
    storage_location_name: str
    category_status: Literal["active", "inactive", "deleted"]
    storage_location_status: Literal["active", "inactive", "deleted"]
    createdBy: str
    updatedBy: str
    createdAt: datetime
    updatedAt: datetime


class AllergenPage(BaseModel):
    items: list[AllergenResponse]
    total: int
    filtered: int
    limit: int
    offset: int


class AllergenReference(BaseModel):
    id: uuid.UUID
    name: str
    status: Literal["active", "inactive", "deleted"]


class AllergenReferencePage(BaseModel):
    items: list[AllergenReference]
    total: int
    limit: int
    offset: int


class AllergenImportRow(BaseModel):
    row: int
    name: str
    category_name: str
    storage_location_name: str
    selling_price: str | None
    gst: str
    concentration: str
    threshold_limit: str | None
    status: str
    mix: str
    errors: list[str]


class AllergenReview(BaseModel):
    rows: list[AllergenImportRow]
    valid: bool
    digest: str


class AllergenImportResult(BaseModel):
    imported: int
