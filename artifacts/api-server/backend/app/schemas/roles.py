import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.services.master_policy import MASTER_ACTIONS

ZoneAction = Literal[
    "zone.add", "zone.edit", "zone.delete", "zone.export", "zone.import",
    "headquarter.add", "headquarter.edit", "headquarter.delete", "headquarter.export", "headquarter.import",
    "mr.add", "mr.edit", "mr.delete", "mr.export", "mr.import",
    "patient.add", "patient.edit", "patient.delete", "patient.export", "patient.import",
    "doctor.add", "doctor.edit", "doctor.delete", "doctor.export", "doctor.import",
    "product_category.add", "product_category.edit", "product_category.delete", "product_category.export", "product_category.import",
    "location.add", "location.edit", "location.delete", "location.export", "location.import",
    "courier.add", "courier.edit", "courier.delete", "courier.export", "courier.import",
]


class RoleFields(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=1000)

    @field_validator("name", "description")
    @classmethod
    def safe_text(cls, value, info):
        if any((ord(c) < 32 and (info.field_name == "name" or c not in ("\n", "\t"))) or ord(c) == 127 for c in value):
            raise ValueError("Invalid text")
        return value


class RoleVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=1, strict=True)


class RoleEdit(RoleFields, RoleVersion):
    pass


class RolePermissions(RoleVersion):
    permissions: list[ZoneAction] = Field(max_length=40)

    @field_validator("permissions")
    @classmethod
    def known_unique_grants(cls, value):
        if len(set(value)) != len(value) or any(key not in MASTER_ACTIONS for key in value):
            raise ValueError("Use only distinct supported master actions")
        return sorted(value)


class RoleResponse(RoleFields):
    id: uuid.UUID
    version: int
    created_at: datetime
    updated_at: datetime
    created_by: uuid.UUID = Field(json_schema_extra={"readOnly": True})
    updated_by: uuid.UUID = Field(json_schema_extra={"readOnly": True})
    deleted_at: datetime | None = Field(json_schema_extra={"readOnly": True})
    deleted_by: uuid.UUID | None = Field(json_schema_extra={"readOnly": True})
    permissions: list[ZoneAction] = Field(default_factory=list, max_length=40, json_schema_extra={"readOnly": True})


class RolePage(BaseModel):
    items: list[RoleResponse]
    has_more: bool
    next_cursor: uuid.UUID | None
    limit: int
