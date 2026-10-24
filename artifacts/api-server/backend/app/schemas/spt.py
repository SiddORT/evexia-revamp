"""SPT contracts. Amounts remain bounded decimal text, never binary floats."""
import re
import uuid
from datetime import date
from typing import Literal
from pydantic import Field, model_validator
from app.schemas.immunotherapy import Strict

Status = Literal["Draft", "Saved"]
Gender = Literal["Male", "Female", "Other", "Prefer not to say"]


class SptPatientInput(Strict):
    id: uuid.UUID
    source: Literal["master", "spt"]
    amount: str = Field(default="", max_length=16, strict=True)

    @model_validator(mode="after")
    def money(self):
        if self.amount and not re.fullmatch(r"\d{1,9}(?:\.\d{1,2})?", self.amount):
            raise ValueError("Amount must be nonnegative INR text with at most nine whole digits and two decimal places")
        return self


class SptInput(Strict):
    doctorId: uuid.UUID | None = None
    mrId: uuid.UUID | None = None
    patients: list[SptPatientInput] = Field(default_factory=list, max_length=200)
    remarks: str = Field(default="", max_length=4000)
    status: Status = "Draft"
    orderDate: date | None = None

    @model_validator(mode="after")
    def membership(self):
        if len({p.id for p in self.patients}) != len(self.patients):
            raise ValueError("Each patient may appear only once")
        if self.status == "Saved" and (not self.doctorId or not self.mrId or not self.patients or any(not p.amount for p in self.patients)):
            raise ValueError("Save requires Doctor, MR, at least one patient and a valid amount for every patient")
        return self


class SptWrite(SptInput):
    idempotencyKey: uuid.UUID
    expected_version: int | None = Field(default=None, ge=1, strict=True)


class SptRegistration(Strict):
    name: str = Field(min_length=1, max_length=100)
    gender: Gender
    age: int = Field(ge=0, le=120, strict=True)
    idempotencyKey: uuid.UUID

    @model_validator(mode="after")
    def nonblank(self):
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("Patient name is required")
        return self


class SptPatient(Strict):
    id: uuid.UUID
    source: Literal["master", "spt"]
    code: str
    name: str
    gender: str
    age: int


class SptPatientSnapshot(SptPatient):
    amount: str


class SptRecord(Strict):
    audit: dict | None = None
    id: uuid.UUID
    sourceId: uuid.UUID
    number: str
    date: str
    version: int
    doctorId: uuid.UUID | None
    mrId: uuid.UUID | None
    doctor: dict | None
    mr: dict | None
    doctorName: str
    mrName: str
    patients: list[SptPatientSnapshot]
    remarks: str
    status: Status
    total: str


class SptPage(Strict):
    items: list[SptRecord]
    total: int
    filtered: int | None
    nextCursor: uuid.UUID | None


class SptImportEntry(Strict):
    id: uuid.UUID | None = None
    sourceId: uuid.UUID
    number: str = Field(default="", max_length=48)
    expected_version: int | None = Field(default=None, ge=1, strict=True)
    values: SptInput


class SptImport(Strict):
    entries: list[SptImportEntry] = Field(min_length=1, max_length=500)
    idempotencyKey: uuid.UUID
    reviewToken: str = Field(default="", max_length=256)
    confirmUpdates: bool = False


class SptImportResult(Strict):
    imported: int
    orders: list[SptRecord]
