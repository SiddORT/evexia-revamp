"""Read-only contribution facts; invoice inputs remain nonnegative and separate."""
from decimal import Decimal, ROUND_HALF_UP, localcontext
from typing import Literal
from app.schemas.immunotherapy import Strict

POLICY = "kits_parking_discount_v1"
CENT = Decimal("0.01")


class KitsContribution(Strict):
    policyVersion: Literal["kits_parking_discount_v1"]
    state: Literal["Available", "Unavailable"]
    unavailableReason: str | None = None
    orderId: str
    orderNumber: str
    orderDate: str
    orderVersion: int
    mrId: str | None
    savedBy: str
    savedAt: str
    businessParking: str | None
    discountType: Literal["percent", "inr"] | None
    discountValue: str | None
    itemQuantities: dict[str, str]
    salesDeduction: str | None = None
    achievementDeduction: str | None = None
    mrSales: str | None = None
    mrAchievement: str | None = None


def calculate_contribution(parking, pricing, *, pricing_complete, **association):
    """Each deduction uses original P; round independently, never compound/cap."""
    result = dict(policyVersion=POLICY, state="Unavailable", unavailableReason=None,
                  businessParking=parking, discountType=(pricing or {}).get("discountType"),
                  discountValue=(pricing or {}).get("discountValue"),
                  salesDeduction=None, achievementDeduction=None, mrSales=None,
                  mrAchievement=None, **association)
    if parking is None:
        result["unavailableReason"] = "Business Parking was not entered."
    elif not pricing_complete:
        result["unavailableReason"] = "Complete pricing for the saved item basis is unavailable."
    elif not association["mrId"]:
        result["unavailableReason"] = "No saved MR owner."
    else:
        with localcontext() as ctx:
            ctx.prec = 50
            p, d = Decimal(parking), Decimal(pricing["discountValue"])
            base = p * d / 100 if pricing["discountType"] == "percent" else d
            sales = base.quantize(CENT, rounding=ROUND_HALF_UP)
            achievement = (base * 2).quantize(CENT, rounding=ROUND_HALF_UP)
            result.update(state="Available", salesDeduction=format(sales, ".2f"),
                          achievementDeduction=format(achievement, ".2f"),
                          mrSales=format(p - sales, ".2f"),
                          mrAchievement=format(p - achievement, ".2f"))
    return result
