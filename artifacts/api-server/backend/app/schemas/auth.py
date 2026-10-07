import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LoginRequest(StrictModel):
    identifier: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=128)
    remember_me: bool = False
    # Portal selection constrains issuance; it never grants a role or permission.
    identity_kind: Literal["admin", "mr"] | None = None

    @field_validator("identifier")
    @classmethod
    def normalized_identifier(cls, value: str) -> str:
        value = value.strip().lower()
        if not value or any(character.isspace() for character in value):
            raise ValueError("Invalid identifier")
        return value


class ChangePasswordRequest(StrictModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class CurrentUser(BaseModel):
    id: uuid.UUID
    email: EmailStr | None
    username: str | None
    system_role: Literal["super_admin", "mr"] | None
    mr_id: uuid.UUID | None = None
    permissions: list[str]
    identity_kind: Literal["super_admin", "mr", "staff"]


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: CurrentUser


class SessionResponse(BaseModel):
    id: str
    status: Literal["ACTIVE", "EXPIRED", "REVOKED"]
    created_at: datetime
    last_refreshed_at: datetime | None
    expires_at: datetime
    persistent: bool


class SessionListResponse(BaseModel):
    items: list[SessionResponse]
    limit: int
    offset: int