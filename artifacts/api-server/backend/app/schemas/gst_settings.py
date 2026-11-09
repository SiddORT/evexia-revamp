"""Date-only and string-decimal contract: no timestamps, floats or rounding."""
import re
from datetime import date
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, field_validator

RATE_PATTERN = r"^(?:(?:0|[1-9][0-9]?)(?:\.[0-9]{1,2})?|100(?:\.0{1,2})?)$"


class GSTSettingsWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(strict=True, ge=0, le=2147483646)
    cutoff_date: str = Field(pattern=r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
    before_rate: str = Field(pattern=RATE_PATTERN, max_length=6)
    on_after_rate: str = Field(pattern=RATE_PATTERN, max_length=6)

    @field_validator("cutoff_date")
    @classmethod
    def calendar_date(cls, value):
        # Enforce the literal calendar representation; never parse a timestamp.
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError("Use a calendar date in YYYY-MM-DD format.")
        date.fromisoformat(value)
        return value

    @field_validator("before_rate", "on_after_rate")
    @classmethod
    def exact_rate(cls, value):
        if Decimal(value) > 100:
            raise ValueError("GST must be between 0 and 100, with up to two decimal places.")
        return format(Decimal(value), ".2f")


class GSTSettingsView(BaseModel):
    configured: bool
    version: int
    cutoff_date: str | None
    before_rate: str | None
    on_after_rate: str | None
