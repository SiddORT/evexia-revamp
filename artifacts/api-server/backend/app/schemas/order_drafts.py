"""Draft payloads are bounded JSON entry state, not relaxed order inputs."""
import json
import uuid
from typing import Any, Literal
from pydantic import Field, field_validator
from app.schemas.immunotherapy import Strict

DraftKind = Literal["immunotherapy", "kits", "lupin"]


class DraftWrite(Strict):
    expected_version: int | None = Field(default=None, ge=1, strict=True)
    idempotencyKey: uuid.UUID
    payload: dict[str, Any]

    @field_validator("payload")
    @classmethod
    def bounded(cls, value):
        if len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode()) > 262144:
            raise ValueError("Draft entry data must be at most 256 KiB")
        def visit(item, depth=0):
            if depth > 16:
                raise ValueError("Draft nesting is too deep")
            if isinstance(item, (dict, list)):
                if len(item) > 1000:
                    raise ValueError("Draft collection is too large")
                for child in item.values() if isinstance(item, dict) else item:
                    visit(child, depth + 1)
            elif isinstance(item, str) and len(item) > 8000:
                raise ValueError("Draft text is too long")
        visit(value)
        return value


class DraftSubmit(Strict):
    expected_version: int = Field(ge=1, strict=True)
    order: dict[str, Any]

    @field_validator("order")
    @classmethod
    def bounded(cls, value):
        return DraftWrite.bounded(value)


class DraftRecord(Strict):
    id: uuid.UUID
    kind: DraftKind
    version: int
    updatedAt: str
    payload: dict[str, Any]


class DraftPage(Strict):
    items: list[DraftRecord]
    nextCursor: uuid.UUID | None
