"""Separate names preserve existing PR/PO generated component contracts."""
import uuid
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class PRBatchPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["manual", "system", "product"]
    prefix: str = Field(default="", max_length=64, pattern=r"^[A-Za-z0-9._-]*$")


class PRBatchSettingsWrite(PRBatchPolicy):
    expected_version: int = Field(ge=1)


class PRBatchSettingsView(PRBatchPolicy):
    version: int
    policyToken: str


class PRBatchAllocationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idempotencyKey: uuid.UUID
    poId: uuid.UUID
    lineIds: list[uuid.UUID] = Field(min_length=1, max_length=100)
    policyToken: str = Field(min_length=1, max_length=2048)

    @model_validator(mode="after")
    def distinct(self):
        if len(set(self.lineIds)) != len(self.lineIds):
            raise ValueError("Each source line can be allocated only once per request.")
        return self


class PRBatchAllocatedLine(BaseModel):
    lineId: uuid.UUID
    batchNo: str


class PRBatchAllocationView(BaseModel):
    idempotencyKey: uuid.UUID
    lines: list[PRBatchAllocatedLine]
