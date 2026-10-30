"""Exact INR lexemes are validated before any decimal coercion."""
import re
import uuid
from datetime import date
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SettlementKind = Literal["IT", "Kit", "SPT", "Lupin"]
SettlementMode = Literal["Cash", "UPI", "Bank transfer", "Cheque", "Card", "Other"]
SettlementVerification = Literal["No transactions", "Not verified", "Verified"]


def money(value, positive=False):
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?", value):
        raise ValueError("Enter a plain INR amount with at most two decimal places.")
    result = Decimal(value)
    if positive and result <= 0:
        raise ValueError("Each payment must be positive.")
    return format(result, ".2f")


class SettlementAllocation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: SettlementKind
    id: uuid.UUID
    expected_version: int = Field(strict=True, ge=1)
    expected_paid: str = Field(pattern=r"^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$")
    amount: str = Field(pattern=r"^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$")

    @field_validator("expected_paid", mode="before")
    @classmethod
    def paid_lexeme(cls, value):
        return money(value)

    @field_validator("amount", mode="before")
    @classmethod
    def amount_lexeme(cls, value):
        return money(value, positive=True)


class SettlementInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotency_key: uuid.UUID
    date: date
    mode: SettlementMode
    entries: list[SettlementAllocation] = Field(min_length=1, max_length=100)

    @field_validator("date", mode="before")
    @classmethod
    def calendar_date(cls, value):
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("Enter a calendar date in YYYY-MM-DD format.")
        return value

    @model_validator(mode="after")
    def distinct_orders(self):
        if len({(entry.kind, entry.id) for entry in self.entries}) != len(self.entries):
            raise ValueError("An order may occur only once per transaction.")
        return self


class SettlementPerson(BaseModel):
    id: str | None = None
    name: str | None = None
    code: str | None = None
    qualification: str | None = None
    phone: str | None = None
    email: str | None = None
    contactsMasked: bool = False


class SettlementTransaction(BaseModel):
    id: str
    batchId: str
    date: str
    mode: SettlementMode
    amount: str
    verification: SettlementVerification
    createdAt: str
    actorId: str


class SettlementRecord(BaseModel):
    key: str
    kind: SettlementKind
    id: str
    number: str
    date: str
    version: int
    doctor: SettlementPerson | None
    mr: SettlementPerson | None
    patients: list[SettlementPerson]
    total: str | None
    paid: str
    balance: str | None
    verification: SettlementVerification
    transactions: list[SettlementTransaction]


class SettlementPage(BaseModel):
    items: list[SettlementRecord]
    total: int
    offset: int
    limit: int


class SettlementReference(BaseModel):
    id: str
    name: str


class SettlementReferences(BaseModel):
    items: list[SettlementReference]
    total: int
    offset: int
    limit: int


class SettlementPostedAllocation(BaseModel):
    kind: SettlementKind
    id: str
    amount: str


class SettlementBatchResult(BaseModel):
    id: str
    date: str
    mode: SettlementMode
    entries: list[SettlementPostedAllocation]
    total: str


class SettlementRejectedOutcome(BaseModel):
    message: str
    code: str


class SettlementReconciliation(BaseModel):
    status: Literal["committed", "absent", "rejected"]
    batch: SettlementBatchResult | None
    rejection: SettlementRejectedOutcome | None = None
