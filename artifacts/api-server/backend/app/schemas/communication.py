"""Strict, bounded configuration contracts. No provider delivery operations."""
import re
from typing import Literal
from urllib.parse import urlsplit
from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

FIELDS = {
    "smtp": ("name", "host", "port", "security", "username", "fromName", "fromEmail"),
    "email": ("name", "provider", "endpoint", "fromName", "fromEmail"),
    "sms": ("name", "provider", "senderId", "endpoint", "dltEntityId", "dltTemplateId"),
    "waba": ("name", "provider", "endpoint", "businessAccountId", "phoneNumberId", "senderPhone", "apiVersion"),
}
OPTIONAL = {"dltEntityId", "dltTemplateId", "apiVersion"}
Channel = Literal["email", "sms", "waba"]
Kind = Literal["smtp", "api", "platform"]


class CommunicationVersion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    version: int = Field(ge=1)
    channelVersion: int = Field(ge=1)


class CommunicationDelete(CommunicationVersion):
    replacementId: str | None = Field(default=None, pattern=r"^[0-9a-f-]{36}$")


class CommunicationInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    channel: Channel
    type: Kind
    channelVersion: int = Field(ge=1)
    values: dict[str, str] = Field(max_length=12)
    secret: SecretStr | None = Field(default=None, max_length=4096)

    @model_validator(mode="after")
    def validate_payload(self):
        if self.channel != "email" and self.type != "api":
            raise ValueError("Invalid channel/type")
        fields = FIELDS["smtp" if self.type == "smtp" else self.channel]
        if set(self.values) - set(fields) or set(fields) - OPTIONAL - set(self.values):
            raise ValueError("Invalid configuration fields")
        self.values = {f: self.values.get(f, "").strip() for f in fields}
        for field, value in self.values.items():
            if (not value and field not in OPTIONAL) or len(value) > (500 if field == "endpoint" else 160) or re.search(r"[\x00-\x1f\x7f]", value):
                raise ValueError("Invalid configuration value")
        v = self.values
        if "endpoint" in v:
            try:
                url = urlsplit(v["endpoint"])
                valid = url.scheme == "https" and url.hostname and not url.username and not url.password
                valid = valid and not re.search(r"[\s\\?#@]", v["endpoint"]) and (url.port is None or 1 <= url.port <= 65535)
            except ValueError:
                valid = False
            if not valid:
                raise ValueError("Use HTTPS without credentials, query or fragment")
        if "fromEmail" in v and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@.]+", v["fromEmail"]):
            raise ValueError("Invalid sender email")
        if self.type == "smtp":
            if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*", v["host"]):
                raise ValueError("Invalid SMTP host")
            if re.fullmatch(r"\d+\.\d+\.\d+\.\d+", v["host"]) and any(int(x) > 255 for x in v["host"].split(".")):
                raise ValueError("Invalid SMTP host")
            if not re.fullmatch(r"\d{1,5}", v["port"]) or not 1 <= int(v["port"]) <= 65535 or v["security"] not in ("starttls", "tls", "none"):
                raise ValueError("Invalid SMTP port/security")
        if self.channel == "waba":
            if not re.fullmatch(r"\+?[\d ()-]{5,30}", v["senderPhone"]) or not 5 <= len(re.sub(r"\D", "", v["senderPhone"])) <= 15:
                raise ValueError("Invalid sender phone")
            if v["apiVersion"] and not re.fullmatch(r"v?\d+(?:\.\d+)?", v["apiVersion"]):
                raise ValueError("Invalid API version")
        if self.secret is not None:
            value = self.secret.get_secret_value()
            if not value or not value.strip() or re.search(r"[\x00-\x1f\x7f]", value):
                raise ValueError("Invalid credential")
        return self


class CommunicationEdit(CommunicationInput):
    version: int = Field(ge=1)


class CommunicationRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    type: Kind
    version: int
    values: dict[str, str]
    credentialPresent: bool


class CommunicationChannel(BaseModel):
    version: int
    defaultId: str | None
    configurations: list[CommunicationRecord] = Field(max_length=100)


class CommunicationSnapshot(BaseModel):
    channels: dict[str, CommunicationChannel]
