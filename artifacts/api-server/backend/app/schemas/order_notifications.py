"""Public notification contracts never include destinations, secrets or documents."""
import re
from typing import Literal
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.services.order_event_contract import EVENTS, VARIABLES
from app.services.email_rendering import tokens, DeliveryHTML

Channel = Literal["email", "sms", "waba"]
Kind = Literal["immunotherapy", "spt", "lupin", "kits"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class OrderNotificationReadInput(Strict):
    read: bool


class OrderNotificationVersion(Strict):
    version: int = Field(ge=1, le=2147483646)


class OrderNotificationTemplateInput(Strict):
    channel: Channel
    eventKey: str | None = None
    name: str = Field(min_length=1, max_length=100)
    enabled: bool
    subject: str = Field(default="", max_length=200)
    html: str = Field(default="", max_length=100000)
    text: str = Field(min_length=1, max_length=20000)
    dltId: str = Field(default="", max_length=60)
    providerTemplate: str = Field(default="", max_length=100)
    language: str = Field(default="", max_length=20)
    parameters: list[str] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def content(self):
        self.name = self.name.strip()
        if not self.name or not self.text.strip() or self.eventKey not in (None, *EVENTS):
            raise ValueError("Enter a name, content and supported order event.")
        for source in (self.subject, self.html, self.text):
            tokens(source, VARIABLES)
        if re.search(r"[\x00-\x1f\x7f-\x9f]", self.name + self.subject):
            raise ValueError("Invalid name or subject.")
        if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]", self.text + self.html):
            raise ValueError("Invalid content.")
        if self.channel == "email":
            if not self.subject.strip() or not self.html.strip():
                raise ValueError("Email requires subject, HTML and plain text.")
            # Formatting only; token-bearing links and other recovery semantics
            # are deliberately not inherited by the order renderer.
            parsed = DeliveryHTML(self.html)
            if parsed.links:
                raise ValueError("Order notifications contain no links; open the saved portal bell.")
        if self.channel == "sms" and len(self.text) > 1600:
            raise ValueError("SMS content is limited to 1,600 characters.")
        if self.dltId and not re.fullmatch(r"[0-9]{1,60}", self.dltId):
            raise ValueError("Enter the real numeric DLT template ID.")
        if self.providerTemplate and not re.fullmatch(r"[a-z0-9_]{1,100}", self.providerTemplate):
            raise ValueError("Use the approved provider template name.")
        if self.language and not re.fullmatch(r"[a-z]{2,3}(?:_[A-Z]{2})?", self.language):
            raise ValueError("Enter the approved language code.")
        if any(p not in VARIABLES for p in self.parameters):
            raise ValueError("Parameter mapping must use supported placeholder names.")
        return self


class OrderNotificationTemplateEdit(OrderNotificationTemplateInput, OrderNotificationVersion):
    pass


class OrderNotificationTemplateRecord(OrderNotificationTemplateInput):
    id: UUID
    version: int
    readiness: str


class OrderNotificationEventChoice(BaseModel):
    key: str
    label: str


class OrderNotificationTemplatePage(BaseModel):
    items: list[OrderNotificationTemplateRecord]
    events: list[OrderNotificationEventChoice]
    variables: list[str]


class OrderNotificationAlert(BaseModel):
    id: UUID
    event: str
    kind: Kind
    number: str
    status: str
    mrName: str
    createdAt: datetime
    amount: str | None
    read: bool


class OrderNotificationFeed(BaseModel):
    items: list[OrderNotificationAlert]
    unreadCount: int


class OrderNotificationReadResult(BaseModel):
    id: UUID
    read: bool


class OrderNotificationTarget(BaseModel):
    kind: Kind
    orderId: UUID


class OrderNotificationDeliveryRecord(BaseModel):
    id: UUID
    eventId: UUID
    channel: Channel
    event: str
    kind: Kind
    number: str
    recipient: Literal["Super Admin", "Placing MR"]
    status: str
    category: str | None
    createdAt: datetime
    updatedAt: datetime


class OrderNotificationDeliveryPage(BaseModel):
    items: list[OrderNotificationDeliveryRecord]
    offset: int
    limit: int
    hasMore: bool
