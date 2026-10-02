import uuid

from pydantic import ConfigDict, EmailStr, Field

from app.schemas.auth import StrictModel


class ProvisionMRRequest(StrictModel):
    email: EmailStr
    username: str | None = Field(default=None, min_length=3, max_length=32)
    password: str = Field(min_length=12, max_length=128)


class MRResponse(StrictModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)
    id: uuid.UUID
    user_id: uuid.UUID
    is_active: bool


class CreatePatientRequest(StrictModel):
    assigned_mr_id: uuid.UUID | None = None


class AssignPatientRequest(StrictModel):
    assigned_mr_id: uuid.UUID | None


class PatientResponse(StrictModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)
    id: uuid.UUID
    assigned_mr_id: uuid.UUID | None
    is_active: bool
    version: int


class DomainError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)