"""Explicit server-owned classification, independent of nullable pricing."""
import uuid
from typing import Literal
from pydantic import Field
from app.schemas.immunotherapy import Strict

Period = Literal["financial_year", "month"]


class FreeKitCaps(Strict):
    mrCap: int = Field(ge=0, le=2147483647, strict=True)
    mrPeriod: Period
    doctorCap: int = Field(ge=0, le=2147483647, strict=True)
    doctorPeriod: Period


class FreeKitSettingsWrite(FreeKitCaps):
    expected_version: int = Field(ge=0, strict=True)
    idempotencyKey: uuid.UUID


class FreeKitSettingsView(Strict):
    configured: bool
    version: int
    caps: FreeKitCaps | None
    recordedAt: str | None = None
    recordedBy: uuid.UUID | None = None
    confirmedRequest: uuid.UUID | None = None


class FreeKitMark(Strict):
    expected_version: int = Field(ge=1, strict=True)
    settingsVersion: int = Field(ge=1, strict=True)
    idempotencyKey: uuid.UUID
    confirmPermanent: Literal[True]


class FreeKitWindow(Strict):
    cap: int
    period: Period
    dateFrom: str
    dateTo: str
    timezone: Literal["Asia/Kolkata"] = "Asia/Kolkata"
    used: int
    remaining: int


class FreeKitPreview(Strict):
    eligible: bool
    reason: str
    orderVersion: int
    settingsVersion: int
    mr: FreeKitWindow | None
    doctor: FreeKitWindow | None


class FreeKitEvidence(Strict):
    classification: Literal["Free kit"]
    actorId: uuid.UUID
    markedAt: str
    orderVersion: int
    policyVersion: int
    mrId: uuid.UUID
    doctorId: uuid.UUID
    orderDate: str
    mr: FreeKitWindow
    doctor: FreeKitWindow
