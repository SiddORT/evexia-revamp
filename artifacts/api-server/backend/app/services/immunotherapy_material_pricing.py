"""Exact configured ml pricing for explicitly governed orders, never catalogue prices."""
import hashlib
import uuid
from copy import deepcopy
from datetime import date
from decimal import Decimal, ROUND_HALF_UP, localcontext
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from app.core.config import get_settings
from app.db.allergen_models import AllergenProduct, ImmunotherapyDilutionMaterial
from app.db.product_category_models import ProductCategory
from app.db.pricing_rule_models import PricingRule, PricingRuleTarget, PricingRuleCategory
from app.services.immunotherapy import ImmError, encode
from app.services.purchase_received_crypto import ReceiptCrypto, PRError

POLICY = "configured_material_ml_v1"


def configuration_locks(db):
    # All configuration readers/writers acquire these before identity/master rows.
    from app.services.pricing_rules import LOCK
    from app.services.immunotherapy_extract import POLICY_LOCK
    for key in (LOCK, POLICY_LOCK):
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def dilution_id(db):
    row = db.get(ImmunotherapyDilutionMaterial, 1)
    return row.product_id if row else None


def clinical_only(db, identity):
    if str(dilution_id(db)) == str(identity):
        raise ImmError("Dilution is an inventory/pricing material, not a clinical allergen. Remove it from the clinical selection.",
                       422, "imm_dilution_clinical")


def basis(data):
    """Membership/order/rank and actual ml; no server-issued SUB identifiers."""
    return dict(dosage=data["dosage"], histamine=data["histamine"], saline=data["saline"],
        groups=[[dict(allergenId=i["allergenId"], result=i["result"], extract=i.get("extract"),
                      dilution=i.get("dilution"), groupingBasis=i.get("groupingBasis"),
                      clinicalAssignment=i.get("clinicalAssignment")) for i in g["items"]] for g in data["groups"]])


def digest(value):
    return hashlib.sha256(encode(value).encode()).hexdigest()


def quote(db, keys, data, effective_date):
    from app.services.directory_inventory import DirectoryCryptoError
    try:
        return _quote(db, keys, data, effective_date)
    except SQLAlchemyError:
        raise ImmError("Pricing/quantity settings storage is unavailable. No price was substituted and no order was placed. Keep your draft and retry.",
                       503, "imm_quote_storage") from None
    except (PRError, DirectoryCryptoError):
        raise ImmError("Saved pricing or quantity evidence could not be read. Ask Admin to review the encrypted configuration; your entry and uploads remain available.",
                       503, "imm_quote_unreadable") from None


def _quote(db, keys, data, effective_date):
    """Read-only: no IDs, ledger, drafts, notifications or persisted assignments."""
    from app.services.immunotherapy_extract import assign
    from app.schemas.rates import rate
    from app.services.inventory import quantity
    assign(db, keys, data["groups"], data["dosage"])
    material_id = dilution_id(db)
    if not material_id:
        raise ImmError("Dilution material is not configured. Protected Admin must explicitly set it up in Allergen Master using real category/storage references, then save its Pricing Rule.",
                       409, "imm_dilution_missing")
    ids = {uuid.UUID(i["allergenId"]) for g in data["groups"] for i in g["items"]} | {material_id}
    masters = {a.id: a for a in db.scalars(select(AllergenProduct).where(AllergenProduct.id.in_(ids)).order_by(AllergenProduct.id).with_for_update())}
    if len(masters) != len(ids) or any(a.deleted_at or a.status != "active" for a in masters.values()):
        raise ImmError("A selected pricing material is missing or inactive. Review the saved allergens and Dilution material.", 409, "imm_price_material")
    cats = {a.category_id for a in masters.values()}
    categories = {c.id: c for c in db.scalars(select(ProductCategory).where(ProductCategory.id.in_(cats)))}
    if len(categories) != len(cats) or any(c.deleted_at or c.status != "active" for c in categories.values()):
        raise ImmError("A pricing material's category is unavailable. Admin must review its category and Pricing Rule.", 409, "imm_price_category")
    targets = {t.allergen_id: t for t in db.scalars(select(PricingRuleTarget).where(PricingRuleTarget.allergen_id.in_(ids)))}
    crypto = ReceiptCrypto(get_settings())
    selected, missing = {}, []
    for identity in sorted(ids):
        master, target = masters[identity], targets.get(identity)
        label = f"{master.name} ({'Dilution; ' if identity == material_id else ''}category {categories[master.category_id].name}; order date {effective_date.isoformat()})"
        if not target or target.category_id != master.category_id:
            missing.append(label)
            continue
        row = db.get(PricingRule, target.rule_id)
        if row is None or db.get(PricingRuleCategory, (target.rule_id, master.category_id)) is None:
            missing.append(label)
            continue
        try:
            saved = crypto.open(row.id, "it-pricing-rule", row.payload_ciphertext)
            cutoff = date.fromisoformat(saved["cutoff"])
            branch = "before" if effective_date < cutoff else "onOrAfter"
            raw = saved.get("beforeRate" if branch == "before" else "afterRate")
            if raw is None:
                missing.append(label)
                continue
            selected_rate = rate(raw)
        except (PRError, ValueError, KeyError, TypeError):
            raise ImmError(f"Pricing Rule for {label} is unreadable. Admin must review the saved rule; no price fallback was used.",
                           503, "imm_price_unreadable") from None
        selected[identity] = dict(materialId=str(identity), name=master.name, categoryId=str(master.category_id),
            categoryName=categories[master.category_id].name, ruleId=str(row.id), ruleVersion=row.version,
            cutoff=cutoff.isoformat(), branch=branch, ratePerMl=selected_rate)
    if missing:
        raise ImmError("Missing applicable Pricing Rules/rates or stale category mappings: " + "; ".join(missing) +
                       ". Admin must explicitly save current category/material selections and rates (an entered zero rate is allowed).",
                       409, "imm_price_missing")
    quantities_missing = []
    for group in data["groups"]:
        for item in group["items"]:
            master = masters[uuid.UUID(item["allergenId"])]
            assignment = item["clinicalAssignment"]
            if assignment["categoryId"] != str(master.category_id):
                raise ImmError(f"{master.name} changed category. Review the composition and category quantity settings before quoting again.",
                               409, "imm_price_category")
            for field in ("extract", "dilution"):
                if item.get(field) is None:
                    quantities_missing.append(f"{master.name}: {field} ml, category {categories[master.category_id].name}, dosage {data['dosage']}, bottle size {len(group['items'])}, rank {assignment['rank']}")
                else:
                    quantity(item[field])
    if quantities_missing:
        raise ImmError("Missing configured quantities: " + "; ".join(quantities_missing) +
                       ". Admin must enter the actual ml in Extract & Dilution settings; zero has not been assumed.",
                       409, "imm_quantity_missing")
    components, total = [], Decimal(0)
    with localcontext() as context:
        context.prec = 48
        for group in data["groups"]:
            charges, dilution_ml = [], Decimal(0)
            for item in group["items"]:
                rule = selected[uuid.UUID(item["allergenId"])]
                ml = Decimal(item["extract"])
                amount = (ml * Decimal(rule["ratePerMl"])).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)
                charges.append(dict(**rule, kind="extract", quantityMl=format(ml, ".2f"), amount=format(amount, ".2f")))
                dilution_ml += Decimal(item["dilution"])
            rule = selected[material_id]
            amount = (dilution_ml * Decimal(rule["ratePerMl"])).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)
            charges.append(dict(**rule, kind="dilution", quantityMl=format(dilution_ml, ".2f"), amount=format(amount, ".2f")))
            subtotal = sum((Decimal(c["amount"]) for c in charges), Decimal(0))
            group["mrp"] = format(subtotal, ".2f")
            components.append(dict(amount=group["mrp"], components=charges))
            total += subtotal
    if total > Decimal("100000000"):
        raise ImmError("Order value exceeds ₹10 crore.", 422, "imm_total")
    evidence = dict(policy=POLICY, orderDate=effective_date.isoformat(), unit="ml",
                    basis=basis(data), groups=components, totalMinor=int(total * 100))
    data.update(pricingPolicy=POLICY, pricingEvidence=evidence, totalMinor=evidence["totalMinor"],
                pricingNeedsReview=False, materialConsumption=None)
    return evidence


def retain(data, previous):
    """No silently stale price after changes, and no implicit historical adoption."""
    if not previous or previous.get("pricingPolicy") != POLICY:
        return
    for key in ("pricingPolicy", "pricingEvidence", "materialConsumption"):
        data[key] = deepcopy(previous.get(key))
    if basis(data) != previous["pricingEvidence"]["basis"] or [g["mrp"] for g in data["groups"]] != [g["mrp"] for g in previous["groups"]]:
        raise ImmError("This priced composition or quantity changed. Select Refresh configured quote, save and review the new quote explicitly before approval.",
                       409, "imm_quote_refresh")


def token(data, effective_date, actor_id, financial):
    return digest(dict(actor=str(actor_id), orderDate=effective_date.isoformat(),
        patientId=data["patientId"], doctorId=data["doctorId"], mrId=data["mrId"],
        shipping=data["shipping"], basis=basis(data), quote=data["pricingEvidence"],
        financial=financial))


def require_confirmation(data, effective_date, actor_id, financial, submitted):
    if submitted != token(data, effective_date, actor_id, financial):
        raise ImmError("The quote, effective date, quantities or financial evidence changed or were not reviewed. Review the financial confirmation again; your entry and verified uploads are retained.",
                       409, "imm_quote_changed")


def prepare_quote(db, keys, data, body, effective_date, previous):
    from app.services.mr_orders import scope_identity
    fresh = not previous and bool(scope_identity(db))
    if fresh or body.refreshQuote:
        quote(db, keys, data, effective_date)
        return True
    return False


def validate_saved(data):
    """Approval uses immutable saved evidence, not today's rates/settings."""
    evidence = data["pricingEvidence"]
    if evidence["policy"] != POLICY or evidence["basis"] != basis(data) or evidence["totalMinor"] != data["totalMinor"]:
        raise ValueError("Saved configured quote no longer matches composition")
    if [g["amount"] for g in evidence["groups"]] != [g["mrp"] for g in data["groups"]]:
        raise ValueError("Saved header totals differ")
    if len(evidence["groups"]) != len(data["groups"]):
        raise ValueError("Saved bottle membership differs")
    effective_date = date.fromisoformat(evidence["orderDate"])
    total = Decimal(0)
    dilution_material = None
    with localcontext() as context:
        context.prec = 48
        for group, priced in zip(data["groups"], evidence["groups"]):
            components = priced["components"]
            extracts = [c for c in components if c["kind"] == "extract"]
            dilutions = [c for c in components if c["kind"] == "dilution"]
            if len(extracts) != len(group["items"]) or len(dilutions) != 1 or len(components) != len(extracts) + 1:
                raise ValueError("Invalid saved component count")
            for item, component in zip(group["items"], extracts):
                if (component["materialId"] != item["allergenId"]
                        or Decimal(component["quantityMl"]) != Decimal(item["extract"])
                        or component["categoryId"] != item["groupingBasis"]["categoryId"]):
                    raise ValueError("Saved Extract evidence differs")
            dilution = dilutions[0]
            if Decimal(dilution["quantityMl"]) != sum((Decimal(i["dilution"]) for i in group["items"]), Decimal(0)):
                raise ValueError("Saved Dilution evidence differs")
            if dilution_material is not None and dilution_material != dilution["materialId"]:
                raise ValueError("Dilution material identity differs")
            dilution_material = dilution["materialId"]
            if dilution_material in {i["allergenId"] for i in group["items"]}:
                raise ValueError("Dilution cannot be a clinical child")
            subtotal = Decimal(0)
            for component in components:
                cutoff = date.fromisoformat(component["cutoff"])
                if component["branch"] != ("before" if effective_date < cutoff else "onOrAfter"):
                    raise ValueError("Saved cutoff branch differs")
                ml, rate_value = Decimal(component["quantityMl"]), Decimal(component["ratePerMl"])
                if not ml.is_finite() or not rate_value.is_finite() or ml < 0 or rate_value < 0:
                    raise ValueError("Invalid saved component values")
                charge = (ml * rate_value).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)
                if charge != Decimal(component["amount"]):
                    raise ValueError("Saved component calculation differs")
                subtotal += charge
            if subtotal != Decimal(priced["amount"]):
                raise ValueError("Saved component total differs")
            total += subtotal
    if int(total * 100) != data["totalMinor"]:
        raise ValueError("Saved order total differs")
