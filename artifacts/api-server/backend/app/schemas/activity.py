"""Metadata only: no free text, record values, credentials or client identity."""
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ActivityResource = Literal[
    "dashboard", "zone", "courier_partner", "storage_location", "headquarter",
    "mr", "doctor", "patient", "designation", "staff", "product_category",
    "allergen", "vendor", "sales_target", "opening_balance", "purchase_order",
    "purchase_received", "communication", "message_template", "invoice_template",
    "receipt_template", "settings", "roles_permissions", "activity_logs", "masters",
]
ActivityAction = Literal[
    "page_view", "created", "updated", "deleted", "imported", "exported", "settings_changed",
]


class BrowserActivity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: uuid.UUID
    action: ActivityAction
    resource: ActivityResource


class BrowserActivityBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    events: list[BrowserActivity] = Field(min_length=1, max_length=20)
