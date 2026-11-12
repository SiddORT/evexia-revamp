from uuid import UUID
from typing import Literal
from datetime import date, datetime
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


class LowStockConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event: Literal["low_stock_alert"]
    frequency: Literal["daily", "weekly", "monthly"]
    weekday: int | None = Field(default=None, ge=0, le=6)
    month_day: int | None = Field(default=None, ge=1, le=31)
    start_date: date = Field(le=date(9998, 12, 31))
    local_time: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    timezone: Literal["Asia/Kolkata"]
    additional_emails: list[EmailStr] = Field(max_length=20)

    @field_validator("additional_emails", mode="before")
    @classmethod
    def emails(cls, value):
        if not isinstance(value, list) or len(value) > 20:
            raise ValueError("Use at most 20 additional email addresses.")
        result, seen = [], set()
        for item in value:
            if not isinstance(item, str) or not item.strip() or len(item.strip()) > 254:
                raise ValueError("Each email must contain 1–254 characters.")
            item = item.strip()
            if item.casefold() not in seen:
                seen.add(item.casefold())
                result.append(item)
        return result

    @model_validator(mode="after")
    def recurrence(self):
        if ((self.frequency == "weekly") != (self.weekday is not None)
                or (self.frequency == "monthly") != (self.month_day is not None)):
            raise ValueError("Choose only the weekday or day of month required by this frequency.")
        return self


class LowStockSettingsWrite(LowStockConfiguration):
    expected_version: int = Field(ge=0, le=2147483646)
    request_id: UUID


class LowStockSettingsView(LowStockConfiguration):
    version: int = Field(ge=0, le=2147483647)
    next_run_at: datetime
    runtime_status: Literal["blocked", "eligible"]
    runtime_message: str


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
