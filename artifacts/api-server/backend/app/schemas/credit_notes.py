"""Credit notes never issue an invoice or represent received money."""
import re
import uuid
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.schemas.settlement_common import SettlementKind, SettlementPerson


class CreditInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotency_key: uuid.UUID
    kind: SettlementKind
    id: uuid.UUID
    expected_version: int = Field(strict=True, ge=1)
    expected_paid: str
    expected_credited: str
    # Frozen confirmation echo, not a manual override. The service requires exact
    # persisted authority for new notes; keep the older grammar for history/replay.
    invoice_reference: str = Field(max_length=100, pattern=r"^[0-9]{2,4}-[0-9]{2}/[0-9]{1,20}$")
    amount: str = Field(pattern=r"^(?:0|[1-9][0-9]{0,11})\.[0-9]{2}$")

    @field_validator("expected_paid", "expected_credited", mode="before")
    @classmethod
    def position(cls, value):
        from app.schemas.settlements import money
        return money(value)

    @field_validator("amount", mode="before")
    @classmethod
    def exact_amount(cls, value):
        from app.schemas.settlements import money
        if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,11})\.[0-9]{2}", value):
            raise ValueError("Enter a positive INR credit with exactly two decimal places.")
        return money(value, positive=True)

    @field_validator("invoice_reference")
    @classmethod
    def invoice(cls, value):
        if not re.fullmatch(r"[0-9]{2,4}-[0-9]{2}/[0-9]{1,20}", value):
            raise ValueError("Use the saved server-owned invoice reference in year/order-number form.")
        return value


class CreditRevertInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotency_key: uuid.UUID


class CreditRecord(BaseModel):
    id: str
    number: str
    date: str
    createdAt: str
    actorId: str
    kind: SettlementKind
    orderId: str
    orderNumber: str
    orderDate: str
    doctor: SettlementPerson | None
    mr: SettlementPerson | None
    invoiceReference: str
    amount: str
    status: Literal["Active", "Reverted"]
    revertedAt: str | None
    revertedBy: str | None
    canRevert: bool


class CreditPage(BaseModel):
    items: list[CreditRecord]
    total: int
    offset: int
    limit: int


class CreditReconciliation(BaseModel):
    status: Literal["committed", "absent", "rejected"]
    note: CreditRecord | None
    rejection: dict[str, str] | None
