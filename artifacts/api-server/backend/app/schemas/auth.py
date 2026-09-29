import re
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RegisterRequest(StrictModel):
    email: EmailStr
    username: str | None = Field(default=None, min_length=3, max_length=32)
    password: str = Field(min_length=12, max_length=128)
    organization_name: str = Field(min_length=2, max_length=160)

    @field_validator("organization_name")
    @classmethod
    def nonblank(cls, name: str) -> str:
        name = name.strip()
        if len(name) < 2:
            raise ValueError("Enter an organization name")
        return name

    @field_validator("username")
    @classmethod
    def valid_username(cls, name: str | None) -> str | None:
        if name is None:
            return None
        name = name.strip().lower()
        if not re.fullmatch(r"[a-z][a-z0-9._-]{2,31}", name):
            raise ValueError("Invalid username")
        return name


class LoginRequest(StrictModel):
    identifier: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("identifier")
    @classmethod
    def normalized_identifier(cls, value: str) -> str:
        value = value.strip().lower()
        if not value or any(character.isspace() for character in value):
            raise ValueError("Invalid identifier")
        return value


class ChangePasswordRequest(StrictModel):
    current_password: str
    new_password: str = Field(min_length=12, max_length=128)


class CurrentUser(BaseModel):
    id: uuid.UUID
    email: EmailStr
    username: str | None
    organization_id: uuid.UUID
    role: Literal["owner", "admin", "viewer"]


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: CurrentUser