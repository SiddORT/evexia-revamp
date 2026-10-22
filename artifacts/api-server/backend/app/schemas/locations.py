import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from app.schemas.phone import COUNTRIES
from app.services.location_geography import indian_state
from app.schemas.master_validation import MasterWriteFields


class LocationFields(MasterWriteFields):
    master_names = {"name": ("storage location name", False)}
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    address: str = Field(min_length=1, max_length=2000)
    status: Literal["active", "inactive"]
    pincode: str = Field(default="", max_length=20)
    countryCode: str = Field(default="", max_length=2)
    state: str = Field(default="", max_length=100)
    city: str = Field(default="", max_length=100)

    @field_validator("name", "address", "pincode", "countryCode", "state", "city", mode="before")
    @classmethod
    def normalize(cls, value, info):
        if cls.master_read or info.field_name in ("name", "address"):
            return value
        return " ".join(value.split()) if isinstance(value, str) else value

    @field_validator("name", "address", "pincode", "countryCode", "state", "city")
    @classmethod
    def printable(cls, value, info):
        if info.field_name == "address" and not cls.master_read and not value.strip():
            raise ValueError("Storage location address is required.")
        allowed = "\n\r\t" if info.field_name == "address" else ""
        if any((ord(char) < 32 and char not in allowed) or 0xD800 <= ord(char) <= 0xDFFF or char in "\ufffe\uffff" for char in value):
            raise ValueError("Unsupported characters")
        return value

    @model_validator(mode="after")
    def geography(self):
        if self.master_read:
            return self
        if self.countryCode and self.countryCode not in COUNTRIES:
            raise ValueError("Select a supported ISO country code.")
        if (self.pincode or self.state or self.city) and not self.countryCode:
            raise ValueError("Select a country for the structured address.")
        if self.countryCode == "IN":
            import re
            if self.pincode and not re.fullmatch(r"[1-9][0-9]{5}", self.pincode):
                raise ValueError("Enter a six-digit Indian PIN.")
            if self.state:
                resolved = indian_state(self.state)
                if not resolved:
                    raise ValueError("Select a supported Indian GST State/UT.")
                self.state = resolved["name"]
        return self


class LocationEdit(LocationFields):
    expected_version: int = Field(ge=1, strict=True)


class LocationVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class LocationStatus(LocationVersion):
    status: Literal["active", "inactive"]


class LocationResponse(LocationFields):
    master_read = True
    stateCode: str | None = None
    id: uuid.UUID
    version: int
    createdBy: str
    updatedBy: str
    createdAt: datetime
    updatedAt: datetime


class LocationPage(BaseModel):
    items: list[LocationResponse]
    total: int
    filtered: int
    limit: int
    offset: int


class LocationImportRow(BaseModel):
    row: int
    name: str
    address: str
    status: str
    pincode: str = ""
    countryCode: str = ""
    state: str = ""
    city: str = ""
    errors: list[str]


class LocationReview(BaseModel):
    rows: list[LocationImportRow]
    valid: bool
    digest: str


class LocationImportResult(BaseModel):
    imported: int
