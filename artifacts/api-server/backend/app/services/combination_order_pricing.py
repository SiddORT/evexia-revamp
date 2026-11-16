"""Exact category/dosage/member tariff lookup. No count or material-price fallback."""
import uuid
from sqlalchemy import select, text
from app.db.pricing_rule_models import CombinationTariff, CombinationRuleStatus
from app.services.combination_pricing import project, fail

POLICY = "configured_combination_mrp_v1"


def ready(db):
    db.execute(text("SELECT key,actor_id,payload_ciphertext FROM it_combination_requests LIMIT 0"))
    for table in ("it_pricing_rules", "it_pricing_rule_categories", "it_pricing_rule_targets",
                  "it_pricing_rule_requests", "it_category_count_tariffs"):
        if db.scalar(text("SELECT to_regclass(:name)"), {"name": f"public.{table}"}) is not None:
            raise RuntimeError("Legacy pricing retirement is incomplete")


def applicable(db, crypto, category_id, dosage, items, effective_date):
    member_key = ",".join(sorted(str(uuid.UUID(i["allergenId"])) for i in items))
    if len(set(member_key.split(","))) != len(items) or not 1 <= len(items) <= 3:
        fail("A priced combination requires one to three distinct allergens.", "members")
    scope = dict(category_id=category_id, dosage=dosage, member_key=member_key)
    status = db.scalar(select(CombinationRuleStatus).filter_by(**scope).order_by(
        CombinationRuleStatus.version.desc()).limit(1))
    if status is None:
        fail(f"No configured combination status for dosage {dosage}, members {member_key}. Save an explicit combination price.", "missing")
    if status.status != "active":
        fail(f"The configured combination is inactive for dosage {dosage}, members {member_key}.", "inactive")
    row = db.scalar(select(CombinationTariff).filter_by(**scope).where(
        CombinationTariff.effective_from <= effective_date).order_by(
        CombinationTariff.effective_from.desc(), CombinationTariff.version.desc()).limit(1))
    if row is None:
        fail(f"No saved combination MRP applies on {effective_date.isoformat()} for dosage {dosage}, members {member_key}. No count, singleton or catalogue fallback was used.", "missing")
    value = project(row, crypto)
    value["statusVersion"] = status.version
    return value
