"""Public error response models shared by FastAPI exception handlers and OpenAPI."""

import uuid

from pydantic import BaseModel, ConfigDict


class ErrorField(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str
    code: str


class ErrorDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    request_id: uuid.UUID | None
    fields: list[ErrorField]


class ErrorEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error: ErrorDetail