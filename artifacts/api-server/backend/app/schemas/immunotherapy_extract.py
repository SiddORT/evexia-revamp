"""Reuse the exact string ml contract; null is not an entered zero."""
import uuid
from pydantic import Field
from app.schemas.immunotherapy import Strict, Volume


class ImmExtractPair(Strict):
    extract: Volume | None = None
    dilution: Volume | None = None


class ImmExtractWrite(Strict):
    rows: list[ImmExtractPair] = Field(min_length=3, max_length=3)
    expected_version: int = Field(ge=0, le=2147483646, strict=True)


class ImmExtractView(Strict):
    categoryId: uuid.UUID
    version: int
    rows: list[ImmExtractPair] = Field(min_length=3, max_length=3)


class ImmExtractCategory(Strict):
    id: uuid.UUID
    name: str
    status: str


class ImmExtractCategories(Strict):
    items: list[ImmExtractCategory]
    nextOffset: int | None
