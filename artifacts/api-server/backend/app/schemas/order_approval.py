import uuid
from pydantic import Field, field_validator
from app.schemas.immunotherapy import Strict


class OrderApproval(Strict):
    expected_version: int = Field(ge=1, strict=True)
    idempotencyKey: uuid.UUID


class OrderRejection(OrderApproval):
    reason: str = Field(min_length=1, max_length=2000, strict=True)

    @field_validator("reason")
    @classmethod
    def plain_reason(cls, value):
        value = value.strip()
        if not value or any(ord(c) < 32 and c not in "\n\t" for c in value):
            raise ValueError("Enter a plain-text rejection reason of 1–2000 characters")
        return value
