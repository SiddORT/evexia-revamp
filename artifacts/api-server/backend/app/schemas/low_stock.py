from uuid import UUID
from typing import Literal
from datetime import datetime
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class LowStockSettingsWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=0, le=2147483646)
    request_id: UUID
    additional_email: EmailStr | None = None

    @field_validator("additional_email", mode="before")
    @classmethod
    def blank(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return None
            if len(value) > 254:
                raise ValueError("Email must not exceed 254 characters.")
        return value


class LowStockSettingsView(BaseModel):
    version: int = Field(ge=0, le=2147483647)
    additional_email: EmailStr | None


class LowStockSaveOutcome(BaseModel):
    outcome: Literal["committed", "cancelled"]
    committed_version: int | None
    saved: LowStockSettingsView


class LowStockAlertRow(BaseModel):
    productId: UUID
    name: str
    category: str
    quantity: str
    unit: str
    thresholdLimit: str | None
    reason: str


class LowStockAlertPage(BaseModel):
    items: list[LowStockAlertRow]
    total: int = Field(ge=0)
    filtered: int = Field(ge=0)
    asOf: datetime
    offset: int
    limit: int
