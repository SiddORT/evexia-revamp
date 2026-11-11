"""Typed eligibility previews use the same untrusted inputs as final saves."""
import uuid
from typing import Literal
from pydantic import BaseModel, model_validator
from app.schemas.immunotherapy import Strict, ImmWrite
from app.schemas.kits import KitsWrite, KitsUpdate
from app.schemas.spt import SptWrite
from app.schemas.lupin import LupinWrite, LupinUpdate
from app.schemas.order_approval import OrderApproval


class PreviewBase(Strict):
    orderId: uuid.UUID | None = None
    resubmit: bool = False

    @model_validator(mode="after")
    def operation(self):
        if self.resubmit != isinstance(self.values, OrderApproval):
            raise ValueError("Resubmission requires a version-bound resubmit body; ordinary previews require full order values")
        if self.resubmit and not self.orderId:
            raise ValueError("Resubmission requires a saved order")
        return self


class ImmEligibilityInput(PreviewBase):
    values: ImmWrite | OrderApproval


class KitsEligibilityInput(PreviewBase):
    values: KitsUpdate | KitsWrite | OrderApproval


class SptEligibilityInput(PreviewBase):
    values: SptWrite | OrderApproval


class LupinEligibilityInput(PreviewBase):
    values: LupinUpdate | LupinWrite | OrderApproval


class EligibilityReason(BaseModel):
    code: str
    message: str
    limit: str
    balance: str
    proposed: str | None = None
    ageDays: int | None = None


class AllergenStockAdvice(BaseModel):
    allergenId: uuid.UUID
    name: str
    state: Literal["unavailable_stock", "low_stock", "healthy", "unavailable_check"]
    quantity: str | None = None
    threshold: str | None = None
    message: str


class EligibilityPreview(BaseModel):
    doctorPendingBalance: str | None = None
    oldestDoctorUnpaidAgeDays: int | None = None
    oldestDoctorUnpaidDate: str | None = None
    quoteToken: str | None = None
    priceQuote: dict | None = None
    eligible: bool
    reasons: list[EligibilityReason]
    stockAdvice: list[AllergenStockAdvice]
    paymentLimit: str | None = None
    doctorDaysLimit: int | None = None
    outstanding: str | None = None
    proposedBalance: str | None = None
    resultingOutstanding: str | None = None
    businessDate: str | None = None
    replay: bool = False
