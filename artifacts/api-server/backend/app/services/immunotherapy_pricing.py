"""Explicit financial-basis changes and authoritative order-local identities."""
from decimal import Decimal

RATE_BASIS = "allergen_rates"
LEGACY_BASIS = "legacy_bottle_mrp"


def retry_payload(value):
    """Additive absent/null defaults must not strand pre-upgrade safe retries."""
    if isinstance(value, list):
        return [retry_payload(item) for item in value]
    if isinstance(value, dict):
        return {key: retry_payload(child) for key, child in value.items()
                if not (key in {"pricingBasis", "suborderId"} and child is None)}
    return value


def basis(body, previous):
    return body.pricingBasis or (previous.get("pricingBasis", LEGACY_BASIS) if previous else RATE_BASIS)


def financials(groups):
    def amount(value):
        return None if value is None else Decimal(value)
    return {g["id"]: (amount(g.get("mrp")), {
        i["allergenId"]: amount(i.get("rate")) for i in g["items"]
    }) for g in groups}


def prepare(body, previous, error, *, mr=False):
    chosen = basis(body, previous)
    old_basis = previous.get("pricingBasis", LEGACY_BASIS) if previous else None
    groups = body.model_dump(mode="json")["groups"]
    if mr and previous:
        old_groups = {g["id"]: g for g in previous["groups"]}
        clinical_same = all(previous.get(k) == getattr(body, k) for k in ("dosage", "histamine", "saline")) and previous["patientId"] == str(body.patientId)
        for group in groups:
            saved = old_groups.get(group["id"], {})
            group["mrp"] = saved.get("mrp")
            old_items = {i["allergenId"]: i for i in saved.get("items", [])}
            for item in group["items"]:
                old = old_items.get(item["allergenId"], {})
                if item.get("suborderId") is not None and item["suborderId"] != old.get("suborderId"):
                    raise error("Retain the saved occurrence identity.", 409, "imm_suborder")
                item["suborderId"] = old.get("suborderId")
                item["rate"] = old.get("rate") if clinical_same and item.get("result") == old.get("result") else None
        return chosen, groups
    if chosen == LEGACY_BASIS:
        unpriced = previous and previous.get("totalMinor") is None and all(
            g.get("mrp") is None and all(i.get("rate") is None for i in g["items"])
            for g in [*groups, *previous["groups"]]
        )
        if not previous or old_basis != LEGACY_BASIS or (
            not unpriced and financials(groups) != financials(previous["groups"])
        ):
            raise error("Historical pricing cannot be edited implicitly. Explicitly select allergen-rate pricing and enter every rate.", 422, "imm_pricing_basis")
    if previous and old_basis == RATE_BASIS and chosen != RATE_BASIS:
        raise error("An allergen-rate order cannot return to historical bottle-MRP pricing.", 422, "imm_pricing_basis")
    if previous and old_basis == LEGACY_BASIS and chosen == RATE_BASIS and any(
        i.rate is None for g in body.groups for i in g.items
    ):
        raise error("Enter every suborder rate before explicitly changing historical pricing.", 422, "imm_pricing_basis")
    # Legacy MRP stays historical metadata, never a second editable amount.
    old_groups = {g["id"]: g for g in previous["groups"]} if previous else {}
    for group in groups:
        saved = old_groups.get(group["id"], {})
        new_mrp, old_mrp = group.get("mrp"), saved.get("mrp")
        if chosen == RATE_BASIS and (
            (new_mrp is None) != (old_mrp is None)
            or (new_mrp is not None and Decimal(new_mrp) != Decimal(old_mrp))
        ):
            raise error("Bottle MRP is not editable for allergen-rate pricing.", 422, "imm_pricing_basis")
        old_items = {i["allergenId"]: i for i in saved.get("items", [])}
        for item in group["items"]:
            retained = old_items.get(item["allergenId"], {}).get("suborderId")
            if item.get("suborderId") is not None and item["suborderId"] != retained:
                raise error("Retain the saved occurrence identity. New suborder IDs are issued only by the server.", 409, "imm_suborder")
            item["suborderId"] = retained
    return chosen, groups


def issue(value, previous):
    """Called only inside an explicit version-checked/idempotent write."""
    next_number = previous.get("nextSuborderNumber", 1) if previous else 1
    # Both formats share one numeric sequence. Include removed saved occurrences
    # so a historical snapshot without a counter cannot recycle their numbers.
    groups = [*(previous["groups"] if previous else []), *value["groups"]]
    used = [int(i["suborderId"].removeprefix("SUB").removeprefix("-")) for g in groups
            for i in g["items"] if i.get("suborderId")]
    next_number = max([next_number, *[n + 1 for n in used]])
    for group in value["groups"]:
        for item in group["items"]:
            if not item.get("suborderId"):
                item["suborderId"] = f"SUB{next_number:03d}"
                next_number += 1
    value["nextSuborderNumber"] = next_number
