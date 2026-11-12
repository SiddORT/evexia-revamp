import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.schemas.rates import rate


class HsnFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(pattern=r"^[0-9]{1,16}$")
    gst: str = Field(min_length=1, max_length=64)
    status: Literal["active", "inactive"]

    @field_validator("gst", mode="before")
    @classmethod
    def tax(cls, value):
        return rate(value, Decimal("100"))


class HsnVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class HsnEdit(HsnFields, HsnVersion):
    pass


class HsnStatus(HsnVersion):
    status: Literal["active", "inactive"]


class HsnResponse(HsnFields):
    id: uuid.UUID
    version: int
    createdBy: str
    updatedBy: str
    createdAt: datetime
    updatedAt: datetime


class HsnPage(BaseModel):
    items: list[HsnResponse]
    total: int
    filtered: int
    limit: int
    offset: int
