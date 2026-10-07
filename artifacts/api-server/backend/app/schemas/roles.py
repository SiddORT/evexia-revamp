import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


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


class RoleResponse(RoleFields):
    id: uuid.UUID
    version: int
    created_at: datetime
    updated_at: datetime
    permissions: list[str] = Field(default_factory=list, max_length=0, json_schema_extra={"readOnly": True})


class RolePage(BaseModel):
    items: list[RoleResponse]
    has_more: bool
    next_cursor: uuid.UUID | None
    limit: int
