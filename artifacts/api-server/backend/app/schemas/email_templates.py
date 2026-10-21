import re
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class EmailTemplateInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    subject: str = Field(min_length=1, max_length=200)
    html: str = Field(min_length=1, max_length=100000)
    text: str = Field(min_length=1, max_length=20000)
    event_key: Literal["password_recovery", "account_invitation"] | None = None

    @field_validator("name", "description", "subject", "html", "text")
    @classmethod
    def bounded_source(cls, value, info):
        pattern = r"[\x00-\x1f\x7f-\x9f]" if info.field_name in ("name", "description", "subject") else r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]"
        if re.search(pattern, value) or (info.field_name != "description" and not value.strip()):
            raise ValueError("Use nonempty text without unsupported control characters.")
        return value if info.field_name in ("html", "text") else value.strip()

    @model_validator(mode="after")
    def deliverable(self):
        from app.services.email_rendering import validate_template
        validate_template(self.subject, self.html, self.text, self.event_key)
        return self


class EmailTemplateVersion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    version: int = Field(ge=1, le=2147483647)


class EmailTemplateCreate(EmailTemplateInput):
    # Client-generated identity makes explicit retries safe after a lost response.
    creation_id: UUID = Field(strict=False)


class EmailTemplateEdit(EmailTemplateInput, EmailTemplateVersion):
    pass


class EmailTemplateRecord(EmailTemplateInput):
    id: UUID
    version: int
    protected: bool


class EmailTemplateEvent(BaseModel):
    key: Literal["password_recovery", "account_invitation"]
    label: str
    required: bool
    variables: list[str]


class EmailTemplateList(BaseModel):
    items: list[EmailTemplateRecord] = Field(max_length=101)
    events: list[EmailTemplateEvent]
