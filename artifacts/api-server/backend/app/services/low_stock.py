"""One complete, bounded usable-inventory projection for screen and digest."""
from decimal import Decimal, InvalidOperation
from sqlalchemy import select
from app.core.security import utcnow
from app.db.allergen_models import AllergenProduct
from app.services import inventory as inv


def snapshot(db, crypto):
    inv.lock(db)
    eligible = {str(p.id) for p in inv.bounded(db, select(AllergenProduct).where(
        AllergenProduct.deleted_at.is_(None), AllergenProduct.status == "active").order_by(
            AllergenProduct.id).with_for_update(read=True))}
    data = inv.stock_snapshot(db, crypto, dict(snapshot=True, offset=0, limit=100))
    if not data["coverage"]["complete"] or data.get("snapshot") is None:
        raise inv.PRError("Complete usable inventory is unavailable. No zero quantities or empty alert result can be inferred.",
                          503, "low_stock_unavailable")
    # Same eligibility as PO's products references/locked_reference, including
    # the stable bound Dilution material. No name-based exclusions.
    rows = []
    for row in data["snapshot"]:
        if row["itemKind"] != "allergen" or row["productId"] not in eligible:
            continue
        try:
            amount = Decimal(row["quantity"])
            threshold = Decimal(row["thresholdLimit"]) if row["thresholdLimit"] is not None else None
            if not amount.is_finite() or (threshold is not None and (not threshold.is_finite() or threshold < 0)):
                raise ValueError()
            # Reserve-only stock never appears in stock_snapshot. Accepted
            # dilution lots are ml; reject mixed/unrepresentable quantity units.
            units = {lot["unit"] for lot in row["lots"]}
            if len(units) > 1 or any(u not in {"ml", "procurement quantity units"} for u in units):
                raise ValueError()
            unit = next(iter(units)) if units else "procurement quantity units"
        except (InvalidOperation, ValueError, KeyError):
            raise inv.PRError("A material's usable inventory cannot be represented completely. Ask an administrator to review inventory.",
                              503, "low_stock_unrepresentable") from None
        zero, low = amount <= 0, threshold is not None and amount <= threshold
        if zero or low:
            rows.append(dict(productId=row["productId"], name=row["name"], category=row["category"],
                quantity=row["quantity"], unit=unit, thresholdLimit=row["thresholdLimit"],
                reason="Zero usable stock; at or below threshold" if zero and low else
                       "Zero usable stock" if zero else "At or below threshold"))
    rows.sort(key=lambda row: (row["name"].casefold(), row["productId"]))
    return dict(items=rows, total=len(rows), asOf=utcnow().isoformat())


def listing(db, actor, query="", offset=0, limit=25):
    def work(_, crypto):
        data = snapshot(db, crypto)
        term = query.strip().casefold()
        rows = [r for r in data["items"] if not term or term in
                " ".join((r["name"], r["category"], r["productId"])).casefold()]
        return {**data, "items": rows[offset:offset + limit], "filtered": len(rows), "offset": offset, "limit": limit}
    return inv.transaction(db, actor, work, capability=("stock_status", None))
