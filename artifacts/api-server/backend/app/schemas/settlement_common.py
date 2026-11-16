from typing import Literal
from pydantic import BaseModel

SettlementKind = Literal["IT", "Kit", "SPT", "Lupin"]


class SettlementPerson(BaseModel):
    id: str | None = None
    name: str | None = None
    code: str | None = None
    qualification: str | None = None
    phone: str | None = None
    email: str | None = None
    contactsMasked: bool = False
