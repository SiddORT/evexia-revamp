import re
import uuid
from datetime import date, datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.schemas.phone import DialCountry, normalize_phone


class StaffFields(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr = Field(max_length=320)
    phone: str = Field(min_length=1, max_length=30)
    dialCountry: DialCountry = "IN"
    role: Literal["Staff", "Manager", "Accountant", "Back End", "Sub Admin", "Super Admin"]
    designation_id: uuid.UUID
    dateOfJoining: date
    status: Literal["active", "inactive"]

    @field_validator("name")
    @classmethod
    def safe_text(cls, value):
        if any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("Invalid text")
        return value

    @field_validator("email")
    @classmethod
    def normalized_email(cls, value):
        return str(value).lower()

    @field_validator("dateOfJoining")
    @classmethod
    def joining_day(cls, value):
        if value < date(1900, 1, 1) or value > datetime.now(timezone.utc).date():
            raise ValueError("Invalid joining date")
        return value

    @model_validator(mode="after")
    def phone_country(self):
        self.phone = normalize_phone(self.phone, self.dialCountry, "staff")
        return self


class StaffEdit(StaffFields):
    expected_version: int = Field(ge=1)


class StaffStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["active", "inactive"]
    expected_version: int = Field(ge=1)


class StaffDeletion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class StaffAccess(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)
    custom_role_id: uuid.UUID | None
    workspace_login_enabled: bool = Field(strict=True)


class StaffResponse(StaffFields):
    designationName: str
    deleted_at: datetime | None = None
    deleted_by: uuid.UUID | None = None
    id: uuid.UUID
    userId: str
    version: int
    createdBy: str
    updatedBy: str
    createdAt: datetime
    updatedAt: datetime
    custom_role_id: uuid.UUID | None = None
    workspace_login_enabled: bool = False


class StaffCreated(BaseModel):
    record: StaffResponse
    initial_password: str


class StaffPage(BaseModel):
    items: list[StaffResponse]
    has_more: bool
    limit: int
    offset: int


class StaffSearch(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    query: str = Field(min_length=2, max_length=200)
    cursor: uuid.UUID | None = None
    limit: int = Field(default=100, ge=1, le=100)

    @field_validator("query")
    @classmethod
    def safe_query(cls, value):
        if any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("Invalid search")
        return value


class StaffSearchPage(BaseModel):
    items: list[StaffResponse]
    has_more: bool
    next_cursor: uuid.UUID | None
    scanned: int
    scan_limit: int
    limit: int
