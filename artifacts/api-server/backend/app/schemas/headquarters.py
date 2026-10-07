import uuid
import unicodedata
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def abbreviation(name):
    """NFC letter runs; marks stay within words but are not initials."""
    words, word = [], []
    for char in unicodedata.normalize("NFC", name):
        category = unicodedata.category(char)
        if category.startswith("L"):
            word.append(char)
        elif category.startswith("M") and word:
            continue
        elif word:
            words.append(word)
            word = []
    if word:
        words.append(word)
    letters = words[0][:2] if len(words) == 1 else [word[0] for word in words]
    return "".join(letters).upper()[:16]


class HeadquarterFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    state_code: str | None = Field(default=None, min_length=1, max_length=16)
    status: Literal["active", "inactive"]

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value):
        return " ".join(value.split()) if isinstance(value, str) else value

    @field_validator("state_code", mode="before")
    @classmethod
    def normalize_code(cls, value):
        return value.strip().upper() if isinstance(value, str) else value

    @field_validator("name", "state_code")
    @classmethod
    def printable(cls, value):
        if value is None:
            raise ValueError("Explicit null is not a code; omit to generate or preserve")
        if any(unicodedata.category(char).startswith("C") or char in "\ufffe\uffff" for char in value):
            raise ValueError("Unsupported characters")
        return value

    @model_validator(mode="after")
    def generation_available(self):
        if self.state_code is None and not isinstance(self, HeadquarterEdit) and not abbreviation(self.name):
            raise ValueError("A name without letters requires a manually supplied code")
        return self


class HeadquarterEdit(HeadquarterFields):
    expected_version: int = Field(ge=1, strict=True)


class HeadquarterVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class HeadquarterStatus(HeadquarterVersion):
    status: Literal["active", "inactive"]


class HeadquarterResponse(HeadquarterFields):
    state_code: str
    id: uuid.UUID
    version: int
    createdBy: str
    updatedBy: str
    createdAt: datetime
    updatedAt: datetime


class HeadquarterPage(BaseModel):
    items: list[HeadquarterResponse]
    total: int
    filtered: int
    limit: int
    offset: int


class HeadquarterImportRow(BaseModel):
    row: int
    name: str
    state_code: str
    status: str
    errors: list[str]


class HeadquarterReview(BaseModel):
    rows: list[HeadquarterImportRow]
    valid: bool
    digest: str


class HeadquarterImportResult(BaseModel):
    imported: int
