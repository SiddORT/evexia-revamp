"""Reuse the exact string ml contract; null is not an entered zero."""
import uuid
from typing import Literal
from pydantic import Field, model_validator
from app.schemas.immunotherapy import Strict, Volume

Dosage = Literal["PD", "DD", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"]
DOSAGES = ("PD", "DD", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8")
POLICY = "category_dosage_count_rank_v2"
POSITIONS = ((1, 1), (2, 1), (2, 2), (3, 1), (3, 2), (3, 3))


class ImmExtractPair(Strict):
    extract: Volume | None = None
    dilution: Volume | None = None


class ImmExtractRankedPair(ImmExtractPair):
    compositionSize: int = Field(ge=1, le=3, strict=True)
    rank: int = Field(ge=1, le=3, strict=True)


class ImmExtractRows(Strict):
    rows: list[ImmExtractRankedPair] = Field(min_length=6, max_length=6)

    @model_validator(mode="after")
    def positions(self):
        if tuple((r.compositionSize, r.rank) for r in self.rows) != POSITIONS:
            raise ValueError("Supply Single rank 1, Double ranks 1–2 and Triple ranks 1–3 in order")
        return self


class ImmExtractWrite(ImmExtractRows):
    policy: Literal["category_dosage_count_rank_v2"]
    dosage: Dosage
    expected_version: int = Field(ge=0, le=2147483646, strict=True)

    @model_validator(mode="after")
    def normalized_volumes(self):
        from app.schemas.immunotherapy import volume
        for row in self.rows:
            for field in ("extract", "dilution"):
                value = getattr(row, field)
                if value is not None:
                    setattr(row, field, volume(value))
        return self


class ImmExtractBlock(ImmExtractRows):
    version: int = Field(ge=1, le=2147483647, strict=True)


class ImmExtractPayload(Strict):
    schemaVersion: Literal[2]
    dosages: dict[Dosage, ImmExtractBlock | None]
    legacyRows: list[ImmExtractPair] | None = Field(default=None, min_length=3, max_length=3)
    legacyVersion: int | None = Field(default=None, ge=1, strict=True)

    @model_validator(mode="after")
    def complete(self):
        if set(self.dosages) != set(DOSAGES):
            raise ValueError("All canonical dosage slots must be explicit")
        if (self.legacyRows is None) != (self.legacyVersion is None):
            raise ValueError("Legacy evidence requires its original version")
        return self


class ImmExtractView(ImmExtractRows):
    categoryId: uuid.UUID
    policy: Literal["category_dosage_count_rank_v2"]
    dosage: Dosage
    version: int = Field(ge=0, strict=True)
    legacyRows: list[ImmExtractPair] | None = Field(default=None, min_length=3, max_length=3)
    legacyVersion: int | None = None


class ImmExtractCategory(Strict):
    id: uuid.UUID
    name: str
    status: str


class ImmExtractCategories(Strict):
    items: list[ImmExtractCategory]
    nextOffset: int | None
