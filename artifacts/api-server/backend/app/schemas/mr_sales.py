"""Minimal MR-self reporting: no directory, clinical or document projections."""
from typing import Literal
from pydantic import BaseModel


class MRSalesYears(BaseModel):
    items: list[int]
    total: int
    offset: int
    limit: int
    currentYear: int


class MRSalesOrder(BaseModel):
    key: str
    number: str
    kind: Literal["IT", "Kit", "SPT", "Lupin"]
    date: str
    status: Literal["In process", "Shipped", "Delivered"]
    amount: str | None
    contribution: str | None


class MRSalesReport(BaseModel):
    mrId: str
    startYear: int
    currentYear: int
    period: Literal["all", "Q1", "Q2", "Q3", "Q4"]
    dateFrom: str
    dateTo: str
    targetState: Literal["active", "missing", "inactive", "deleted"]
    target: str | None
    knownSales: str
    complete: bool
    unavailableOrders: int
    remaining: str | None
    percentage: str | None
    items: list[MRSalesOrder]
    total: int
    offset: int
    limit: int
