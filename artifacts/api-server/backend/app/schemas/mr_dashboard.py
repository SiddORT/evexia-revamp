"""Read-only MR-self projections with explicitly configured financial subtotals."""
from typing import Literal
from pydantic import BaseModel


class MRDashboardTypeCount(BaseModel):
    kind: Literal["IT", "Kit", "SPT", "Lupin"]
    count: int
    percentage: str


class MRDashboardCount(BaseModel):
    label: str
    total: int
    byType: list[MRDashboardTypeCount]


class MRDashboardAchievement(BaseModel):
    period: Literal["all", "Q1", "Q2", "Q3", "Q4"]
    dateFrom: str
    dateTo: str
    targetState: Literal["active", "missing", "inactive", "deleted"]
    target: str | None
    knownSales: str
    complete: bool
    unavailableOrders: int
    total: int
    remaining: str | None
    percentage: str | None


class MRDashboardMonth(BaseModel):
    month: str
    amount: str | None
    knownSales: str
    unavailableOrders: int


class MRDashboardRecentOrder(BaseModel):
    classification: Literal["Free kit"] | None = None
    key: str
    number: str
    kind: Literal["IT", "Kit", "SPT", "Lupin"]
    date: str
    status: Literal["Pending", "In process", "Shipped", "Delivered", "Rejected", "Returned"]


class MRDashboardDirectory(BaseModel):
    doctors: int
    patients: int


class MRDashboardFinancialMetric(BaseModel):
    amount: str | None
    complete: bool


class MRDashboardFinancialAmounts(BaseModel):
    totalSales: MRDashboardFinancialMetric
    grossSales: MRDashboardFinancialMetric
    actualSales: MRDashboardFinancialMetric
    dueAmount: MRDashboardFinancialMetric


class MRDashboardFinancialContribution(BaseModel):
    kind: Literal["IT", "Kit", "SPT", "Lupin"]
    state: Literal["configured", "unconfigured"]
    totals: MRDashboardFinancialAmounts | None


class MRDashboardFinancial(BaseModel):
    scope: Literal["configured-subtotal"]
    totals: MRDashboardFinancialAmounts
    contributions: list[MRDashboardFinancialContribution]


class MRDashboardReport(BaseModel):
    mrId: str
    startYear: int
    currentYear: int
    period: Literal["all", "Q1", "Q2", "Q3", "Q4"]
    dateFrom: str
    dateTo: str
    orders: MRDashboardCount
    statuses: list[MRDashboardCount]
    directory: MRDashboardDirectory
    financial: MRDashboardFinancial
    annual: MRDashboardAchievement
    quarters: list[MRDashboardAchievement]
    monthly: list[MRDashboardMonth]
    recent: list[MRDashboardRecentOrder]
    recentLimit: int


class MRDoctorPayment(BaseModel):
    doctorId: str
    doctorName: str
    received: str
    knownDue: str
    due: str | None
    pendingPricingOrders: int
    oldestUnpaidDate: str | None
    oldestUnpaidAgeDays: int | None
    daysRemaining: int | None
    overdueDays: int | None


class MRDoctorPaymentsPage(BaseModel):
    mrId: str
    businessDate: str
    doctorDaysLimit: int
    total: int
    offset: int
    limit: int
    items: list[MRDoctorPayment]
