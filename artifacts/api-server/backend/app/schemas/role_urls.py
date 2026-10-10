import ipaddress
import re
import uuid
from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator


def canonical_hostname(value: str) -> str:
    value = value.strip()
    if not value or len(value) > 270 or any(c.isspace() for c in value):
        raise ValueError("Enter a production hostname or HTTPS origin")
    if "://" in value:
        parsed = urlsplit(value)
        if (parsed.scheme != "https" or parsed.username is not None or parsed.password is not None
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment
                or "?" in value or "#" in value or parsed.port is not None):
            raise ValueError("Use an HTTPS origin without credentials, port, path, query or fragment")
        value = parsed.netloc
    value = value.lower().removesuffix(".")
    if not value.isascii() or len(value) > 253:
        raise ValueError("Use an ASCII hostname (punycode for international names)")
    labels = value.split(".")
    if len(labels) < 2 or not all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in labels):
        raise ValueError("Enter an exact production hostname, without wildcards")
    if not re.fullmatch(r"[a-z][a-z0-9-]*", labels[-1]) or labels[-1] in {
        "localhost", "local", "internal", "test", "invalid", "example", "onion",
    }:
        raise ValueError("Enter a public production hostname")
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return value
    raise ValueError("IP addresses are not portal hostnames")


class RoleUrlFields(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hostname: str = Field(max_length=270)
    role: Literal["admin", "mr", "doctor"]
    enabled: StrictBool = True
    _hostname = field_validator("hostname")(canonical_hostname)


class RoleUrlVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=1, strict=True)


class RoleUrlEdit(RoleUrlFields, RoleUrlVersion):
    pass


class RoleUrlResponse(RoleUrlFields):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    version: int
    created_at: datetime
    updated_at: datetime
    created_by: uuid.UUID
    updated_by: uuid.UUID


class RoleUrlPage(BaseModel):
    items: list[RoleUrlResponse]


class PortalResolution(BaseModel):
    role: Literal["admin", "mr", "doctor"] | None
