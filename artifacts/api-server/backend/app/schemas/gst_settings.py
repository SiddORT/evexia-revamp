"""Date-only and string-decimal contract: no timestamps, floats or rounding."""
import re
from datetime import date
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Literal
from uuid import UUID

RATE_PATTERN = r"^(?:(?:0|[1-9][0-9]?)(?:\.[0-9]{1,2})?|100(?:\.0{1,2})?)$"


class GSTSettingsWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(strict=True, ge=0, le=2147483646)
    request_id: UUID
    action: Literal["adopt_approved", "add"]
    applicable_from: str | None = None
    rate: str | None = Field(default=None, pattern=RATE_PATTERN, max_length=6)

    @field_validator("applicable_from")
    @classmethod
    def calendar_date(cls, value):
        if value is None:
            return value
        # Enforce the literal calendar representation; never parse a timestamp.
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError("Use a calendar date in YYYY-MM-DD format.")
        date.fromisoformat(value)
        return value

    @field_validator("rate")
    @classmethod
    def exact_rate(cls, value):
        if value is None:
            return value
        if Decimal(value) > 100:
            raise ValueError("GST must be between 0 and 100, with up to two decimal places.")
        return format(Decimal(value), ".2f")


class GSTPeriod(BaseModel):
    applicable_from: str
    rate: str


class GSTEvidence(GSTPeriod):
    policy_revision: int
    order_date: str


class GSTOpeningBaseline(BaseModel):
    source: Literal["stored_configuration", "approved_initial"]
    legacy_version: int | None
    cutoff_date: str
    before_rate: str
    on_after_rate: str


class GSTSettingsView(BaseModel):
    configured: bool
    version: int
    baseline: GSTOpeningBaseline
    requires_confirmation: bool
    periods: list[GSTPeriod]
    current: GSTPeriod
    scheduled: list[GSTPeriod]
    business_date: str
    confirmed_request_id: UUID | None = None
    confirmed_version: int | None = None


class GSTHistoryItem(BaseModel):
    version: int
    effective_date: str | None
    prior: list[GSTPeriod]
    new: list[GSTPeriod]
    recorded_at: str
    actor_id: UUID
    actor_label: str
    action: str


class GSTHistoryPage(BaseModel):
    items: list[GSTHistoryItem]
    next_before_version: int | None
