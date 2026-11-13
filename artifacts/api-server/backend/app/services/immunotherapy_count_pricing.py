"""Total header MRP once; ml evidence remains independent inventory authority."""
import uuid
from decimal import Decimal
from sqlalchemy import select
from app.core.config import get_settings
from app.db.allergen_models import AllergenProduct
from app.db.product_category_models import ProductCategory
from app.schemas.category_count_tariffs import POLICY
from app.services.immunotherapy import ImmError
from app.services.immunotherapy_grouping import validate
from app.services.purchase_received_crypto import ReceiptCrypto
from app.services.category_count_tariffs import applicable
from copy import deepcopy


def quote(db, keys, data, effective_date, *, preserve_quantities=False):
    from app.services.immunotherapy_extract import assign
    from app.services.immunotherapy_material_pricing import basis, dilution_id
    from app.services.pricing_rules import PricingRuleError
    from app.services.inventory import quantity
    for group in data["groups"]:
        validate(group, ImmError)
    if not preserve_quantities:
        assign(db, keys, data["groups"], data["dosage"])
    else:
        # Price refresh is not permission to reapply current quantity settings
        # to already assigned children or erase explicit Admin corrections.
        for group in data["groups"]:
            if any(not item.get("clinicalAssignment") for item in group["items"]):
                resolved = deepcopy([group])
                assign(db, keys, resolved, data["dosage"])
                assigned = {i["allergenId"]: i for i in resolved[0]["items"]}
                for item in group["items"]:
                    if not item.get("clinicalAssignment"):
                        for field in ("extract", "dilution", "clinicalAssignment"):
                            item[field] = deepcopy(assigned[item["allergenId"]][field])
    material_id = dilution_id(db)
    if not material_id:
        raise ImmError("Dilution inventory material is not configured. Admin must bind the real material; a separate pricing rule is not required.",
                       409, "imm_dilution_missing")
    ids = {uuid.UUID(i["allergenId"]) for g in data["groups"] for i in g["items"]} | {material_id}
    masters = {a.id: a for a in db.scalars(select(AllergenProduct).where(
        AllergenProduct.id.in_(ids)).order_by(AllergenProduct.id).with_for_update())}
    if len(masters) != len(ids) or any(a.deleted_at or a.status != "active" for a in masters.values()):
        raise ImmError("A clinical or Dilution material is unavailable or inactive.", 409, "imm_price_material")
    categories = {c.id: c for c in db.scalars(select(ProductCategory).where(
        ProductCategory.id.in_({a.category_id for a in masters.values()})))}
    if any(c.deleted_at or c.status != "active" for c in categories.values()) or len(categories) != len({a.category_id for a in masters.values()}):
        raise ImmError("A material category is unavailable.", 409, "imm_price_category")
    crypto = ReceiptCrypto(get_settings())
    priced_groups, total_minor = [], 0
    for group in data["groups"]:
        category_id = uuid.UUID(group["items"][0]["groupingBasis"]["categoryId"])
        components, dilution_ml = [], Decimal(0)
        for item in group["items"]:
            master = masters[uuid.UUID(item["allergenId"])]
            if master.id == material_id or master.category_id != category_id:
                raise ImmError("Clinical membership changed category or contains Dilution. Review the suborder.",
                               409, "imm_price_category")
            for field in ("extract", "dilution"):
                if item.get(field) is None:
                    raise ImmError(f"Missing {field} ml for {master.name}, dosage {data['dosage']}, count {len(group['items'])}, rank {item['clinicalAssignment']['rank']}. Admin must save an explicit quantity; blank is not zero.",
                                   409, "imm_quantity_missing")
                quantity(item[field])
            components.append(dict(materialId=str(master.id), name=master.name, kind="extract",
                                   quantityMl=item["extract"]))
            dilution_ml += Decimal(item["dilution"])
        components.append(dict(materialId=str(material_id), name=masters[material_id].name,
                               kind="dilution", quantityMl=format(dilution_ml, ".2f")))
        try:
            tariff = applicable(db, crypto, category_id, len(group["items"]), effective_date)
        except PricingRuleError as error:
            raise ImmError(error.message, error.status, error.code) from None
        group["mrp"] = tariff["totalMrp"]
        priced_groups.append(dict(amount=tariff["totalMrp"], tariff=tariff,
                                  categoryName=categories[category_id].name, components=components))
        total_minor += int(Decimal(tariff["totalMrp"]) * 100)
    if total_minor > 10000000000:
        raise ImmError("Order value exceeds ₹10 crore.", 422, "imm_total")
    evidence = dict(policy=POLICY, orderDate=effective_date.isoformat(), basis=basis(data),
                    groups=priced_groups, totalMinor=total_minor, unit="total_suborder_mrp")
    data.update(pricingPolicy=POLICY, pricingEvidence=evidence, totalMinor=total_minor,
                pricingNeedsReview=False, materialConsumption=None)
    return evidence


def validate_saved(data):
    from app.services.immunotherapy_material_pricing import basis
    from app.schemas.rates import rate
    from datetime import date
    evidence = data["pricingEvidence"]
    if (evidence["policy"] != POLICY or evidence["basis"] != basis(data)
            or evidence["totalMinor"] != data["totalMinor"]
            or len(evidence["groups"]) != len(data["groups"])):
        raise ValueError("Saved category/count quote differs")
    effective_date = date.fromisoformat(evidence["orderDate"])
    total, dilution_id = 0, None
    for group, priced in zip(data["groups"], evidence["groups"]):
        validate(group, ImmError)
        tariff = priced["tariff"]
        uuid.UUID(tariff["id"])
        uuid.UUID(tariff["actorId"])
        if (tariff["categoryId"] != group["items"][0]["groupingBasis"]["categoryId"]
                or tariff["allergenCount"] != len(group["items"])
                or type(tariff["version"]) is not int or tariff["version"] < 1
                or date.fromisoformat(tariff["effectiveFrom"]) > effective_date
                or rate(tariff["totalMrp"]) != tariff["totalMrp"]
                or tariff["totalMrp"] != group["mrp"] or priced["amount"] != group["mrp"]):
            raise ValueError("Saved tariff selection differs")
        components = priced["components"]
        if len(components) != len(group["items"]) + 1:
            raise ValueError("Saved material count differs")
        for item, component in zip(group["items"], components[:-1]):
            if (component["kind"] != "extract" or component["materialId"] != item["allergenId"]
                    or Decimal(component["quantityMl"]) != Decimal(item["extract"])):
                raise ValueError("Saved Extract evidence differs")
        dilution = components[-1]
        if (dilution["kind"] != "dilution"
                or Decimal(dilution["quantityMl"]) != sum((Decimal(i["dilution"]) for i in group["items"]), Decimal(0))
                or dilution["materialId"] in {i["allergenId"] for i in group["items"]}
                or (dilution_id is not None and dilution_id != dilution["materialId"])):
            raise ValueError("Saved Dilution evidence differs")
        dilution_id = dilution["materialId"]
        total += int(Decimal(tariff["totalMrp"]) * 100)
    if total != data["totalMinor"]:
        raise ValueError("Saved total differs")


def retain_quantity_correction(data, previous, actor_id):
    """Explicit Admin-only quantity correction, not a new price/assignment."""
    from app.services.immunotherapy_material_pricing import basis
    from app.core.security import utcnow
    old, new = basis(previous), basis(data)
    if old == new or [g["mrp"] for g in data["groups"]] != [g["mrp"] for g in previous["groups"]]:
        return

    def clinical(value):
        value = deepcopy(value)
        for group in value["groups"]:
            for item in group:
                item.pop("extract", None)
                item.pop("dilution", None)
        return value

    if clinical(old) != clinical(new):
        return
    for group, priced in zip(data["groups"], data["pricingEvidence"]["groups"]):
        if any(item.get(field) is None for item in group["items"] for field in ("extract", "dilution")):
            raise ImmError("Quantity corrections for a priced suborder require explicit Extract and Dilution ml for every clinical allergen. Blank is not zero.",
                           409, "imm_quantity_missing")
        for item, component in zip(group["items"], priced["components"][:-1]):
            component["quantityMl"] = item["extract"]
        priced["components"][-1]["quantityMl"] = format(
            sum((Decimal(i["dilution"]) for i in group["items"]), Decimal(0)), ".2f")
    evidence = data["pricingEvidence"]
    evidence.setdefault("quantityCorrections", []).append(dict(
        actorId=str(actor_id), recordedAt=utcnow().isoformat(), before=old, after=deepcopy(new)))
    evidence["basis"] = new
    # Original clinicalAssignment and selected tariff revisions remain intact.
