"""Save-only, record-once external metadata; not an e-invoice contract."""
import unicodedata
import uuid
from pydantic import BaseModel, ConfigDict, Field, field_validator


class OrderIRNInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)
    idempotencyKey: uuid.UUID
    number: str = Field(min_length=1, max_length=256, strict=True)

    @field_validator("number", mode="before")
    @classmethod
    def plain_number(cls, value):
        if not isinstance(value, str):
            raise ValueError("Enter an IRN of 1–256 plain-text characters")
        # Match JavaScript String.trim exactly at the UI/API boundary.
        value = value.strip(" \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004"
                            "\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
        if not value or any(unicodedata.category(c) in {"Cc", "Cf", "Cs", "Zl", "Zp"} or c in "<>" for c in value):
            raise ValueError("Enter an IRN of 1–256 plain-text characters without controls or markup")
        return value


class OrderIRN(BaseModel):
    number: str
    recordedAt: str
    recordedBy: uuid.UUID
    recordVersion: int
