"""Shared catalogue reference response for combination configuration."""
import uuid
from pydantic import BaseModel


class ItPricingReference(BaseModel):
    id: uuid.UUID
    name: str
    status: str
