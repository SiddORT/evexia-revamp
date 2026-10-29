"""Shipment-only contracts. Ordinary order input contracts remain unchanged."""
import uuid
from datetime import date
from typing import Any
from typing import Literal
from pydantic import Field, field_validator
from app.schemas.immunotherapy import Strict

ShipmentType = Literal["Kit", "IT", "Lupin", "SPT"]
ShipmentStatus = Literal["In process", "Shipped", "Returned"]


class ShipmentCommand(Strict):
    idempotency_key: uuid.UUID
    expected_version: int = Field(ge=1, strict=True)


class ShipmentDispatch(ShipmentCommand):
    courier_id: uuid.UUID
    tracking_id: str = Field(min_length=1, max_length=200, strict=True)
    expected_delivery_date: date
    actual_delivery_date: date | None = None

    @field_validator("tracking_id")
    @classmethod
    def tracking(cls, value):
        value = value.strip()
        if not value or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("Enter a tracking ID without control characters")
        return value


class ShipmentDelivery(ShipmentCommand):
    actual_delivery_date: date


class ShipmentRecord(Strict):
    id: uuid.UUID
    key: str
    type: ShipmentType
    number: str
    date: str
    version: int
    value: str | None
    doctor: str | None
    mr: str | None
    patients: list[str] = Field(default_factory=list)
    address: str | None
    recipient: str | None
    courier: str | None
    trackingId: str | None
    expectedDeliveryDate: str | None
    actualDeliveryDate: str | None
    shippedAt: str | None
    status: ShipmentStatus
    paymentStatus: str | None


class ShipmentPage(Strict):
    items: list[ShipmentRecord]
    total: int
    offset: int
    limit: int


class ShipmentDetails(Strict):
    record: ShipmentRecord
    order: dict[str, Any]


class ShipmentCourier(Strict):
    id: uuid.UUID
    name: str


class ShipmentCouriers(Strict):
    items: list[ShipmentCourier]
    total: int
