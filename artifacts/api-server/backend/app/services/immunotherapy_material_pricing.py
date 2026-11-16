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
from app.services.immunotherapy import ImmError, encode
from app.services.purchase_received_crypto import ReceiptCrypto, PRError

POLICY = "configured_material_ml_v1"
from app.schemas.category_count_tariffs import POLICY as COUNT_POLICY
from app.services.combination_order_pricing import POLICY as COMBINATION_POLICY
POLICIES = (POLICY, COUNT_POLICY, COMBINATION_POLICY)


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


def quote(db, keys, data, effective_date, policy=COMBINATION_POLICY, preserve_quantities=False):
    from app.services.directory_inventory import DirectoryCryptoError
    try:
        # Historical policies remain snapshot readers only, never live fallbacks.
        from app.services.immunotherapy_count_pricing import quote as combination_quote
        return combination_quote(db, keys, data, effective_date, preserve_quantities=preserve_quantities)
    except SQLAlchemyError:
        raise ImmError("Pricing/quantity settings storage is unavailable. No price was substituted and no order was placed. Keep your draft and retry.",
                       503, "imm_quote_storage") from None
    except (PRError, DirectoryCryptoError):
        raise ImmError("Saved pricing or quantity evidence could not be read. Ask Admin to review the encrypted configuration; your entry and uploads remain available.",
                       503, "imm_quote_unreadable") from None


def retain(data, previous, *, correction_actor=None):
    """No silently stale price after changes, and no implicit historical adoption."""
    if not previous or previous.get("pricingPolicy") not in POLICIES:
        return
    for key in ("pricingPolicy", "pricingEvidence", "materialConsumption"):
        data[key] = deepcopy(previous.get(key))
    if previous.get("pricingPolicy") in (COUNT_POLICY, COMBINATION_POLICY) and correction_actor is not None:
        from app.services.immunotherapy_count_pricing import retain_quantity_correction
        retain_quantity_correction(data, previous, correction_actor)
        # The correction helper only accepts the same saved clinical/pricing
        # basis; changed membership or dosage still requires an explicit quote.
        if (data["pricingEvidence"]["basis"] == basis(data)
                and [g["mrp"] for g in data["groups"]] == [g["mrp"] for g in previous["groups"]]):
            return
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
    fresh = not previous
    if fresh or body.refreshQuote:
        count_refresh = bool(previous and previous.get("pricingPolicy") in POLICIES)
        quote(db, keys, data, effective_date, policy=COMBINATION_POLICY,
              preserve_quantities=count_refresh)
        if count_refresh:
            data["pricingEvidence"]["previousQuote"] = deepcopy(previous["pricingEvidence"])
        return True
    return False


def validate_saved(data):
    """Approval uses immutable saved evidence, not today's rates/settings."""
    if data.get("pricingPolicy") in (COUNT_POLICY, COMBINATION_POLICY):
        from app.services.immunotherapy_count_pricing import validate_saved as validate_count
        return validate_count(data)
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
