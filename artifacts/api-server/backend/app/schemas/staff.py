import re
import uuid
from datetime import date, datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

COUNTRIES = {"IN": 10, "US": 10, "GB": 10, "AE": 9}


class StaffFields(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr = Field(max_length=320)
    phone: str = Field(min_length=1, max_length=30)
    dialCountry: str
    role: Literal["Staff", "Manager", "Accountant", "Back End", "Sub Admin", "Super Admin"]
    designation: str = Field(min_length=1, max_length=200)
    dateOfJoining: date
    status: Literal["active", "inactive"]

    @field_validator("name", "designation")
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
        local = re.sub(r"^\+91[\s-]?", "", self.phone) if self.dialCountry == "IN" else self.phone
        digits = re.sub(r"[\s()-]", "", local)
        if (self.dialCountry not in COUNTRIES or not re.fullmatch(r"[0-9\s()-]+", local)
                or len(digits) != COUNTRIES[self.dialCountry]
                or (self.dialCountry == "IN" and not re.fullmatch(r"[6-9][0-9]{9}", digits))):
            raise ValueError("Invalid phone")
        self.phone = digits
        return self


class StaffEdit(StaffFields):
    expected_version: int = Field(ge=1)


class StaffStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["active", "inactive"]
    expected_version: int = Field(ge=1)


class StaffAccess(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)
    custom_role_id: uuid.UUID | None
    workspace_login_enabled: bool = Field(strict=True)


class StaffResponse(StaffFields):
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
