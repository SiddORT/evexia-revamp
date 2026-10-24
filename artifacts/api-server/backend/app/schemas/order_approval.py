import uuid
from pydantic import Field
from app.schemas.immunotherapy import Strict


class OrderApproval(Strict):
    expected_version: int = Field(ge=1, strict=True)
    idempotencyKey: uuid.UUID
