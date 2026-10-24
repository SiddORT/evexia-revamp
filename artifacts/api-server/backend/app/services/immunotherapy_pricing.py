"""Explicit financial-basis changes and authoritative order-local identities."""
from decimal import Decimal
from copy import deepcopy
import re

RATE_BASIS = "allergen_rates"
LEGACY_BASIS = "legacy_bottle_mrp"
SUBORDER_BASIS = "suborder_mrp_v1"


def retry_payload(value):
    """Additive absent/null defaults must not strand pre-upgrade safe retries."""
    if isinstance(value, list):
        return [retry_payload(item) for item in value]
    if isinstance(value, dict):
        return {key: retry_payload(child) for key, child in value.items()
                if not (key in {"pricingBasis", "suborderId", "decision", "extract", "dilution"} and child is None)}
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
    if chosen == SUBORDER_BASIS:
        return chosen, prepare_suborders(groups, previous, error, mr=mr)
    if len(groups) > 100:
        raise error("Historical orders support at most 100 groups.", 422, "imm_suborder")
    if previous and old_basis == SUBORDER_BASIS:
        raise error("A suborder-MRP order cannot return to historical pricing.", 422, "imm_pricing_basis")
    if any(i.get("extract") is not None or i.get("dilution") is not None for g in groups for i in g["items"]):
        raise error("Explicitly adopt suborder MRP before recording extract or dilution.", 422, "imm_pricing_basis")
    if mr and previous:
        old_groups = {g["id"]: g for g in previous["groups"]}
        for group in groups:
            saved = old_groups.get(group["id"], {})
            group["mrp"] = saved.get("mrp")
            old_items = {i["allergenId"]: i for i in saved.get("items", [])}
            for item in group["items"]:
                old = old_items.get(item["allergenId"], {})
                if item.get("suborderId") is not None and item["suborderId"] != old.get("suborderId"):
                    raise error("Retain the saved occurrence identity.", 409, "imm_suborder")
                item["suborderId"] = old.get("suborderId")
                # Retain Admin-owned values as history; the server review flag
                # invalidates approval when the clinical/item basis changes.
                item["rate"] = old.get("rate")
        return chosen, groups
    if chosen == RATE_BASIS:
        if previous and old_basis != RATE_BASIS:
            raise error("Adopt suborder MRP explicitly; historical repricing no longer uses individual rates.", 422, "imm_pricing_basis")
        if previous and financials(groups) != financials(previous["groups"]):
            raise error("Adopt suborder MRP before changing historical composition or pricing.", 422, "imm_pricing_basis")
        saved_rates = {(g["id"], i["allergenId"]): i.get("rate")
                       for g in previous["groups"] for i in g["items"]} if previous else {}
        for group in groups:
            for item in group["items"]:
                rate = item.get("rate")
                saved = saved_rates.get((group["id"], item["allergenId"]))
                if (rate is None) != (saved is None) or (rate is not None and Decimal(rate) != Decimal(saved)):
                    raise error("Individual allergen rates are historical read-only values. Adopt suborder MRP for pricing edits.", 422, "imm_pricing_basis")
    if chosen == LEGACY_BASIS:
        unpriced = previous and previous.get("totalMinor") is None and all(
            g.get("mrp") is None and all(i.get("rate") is None for i in g["items"])
            for g in [*groups, *previous["groups"]]
        )
        if not previous or old_basis != LEGACY_BASIS or (
            not unpriced and financials(groups) != financials(previous["groups"])
        ):
            raise error("Historical pricing cannot be edited implicitly. Adopt suborder MRP explicitly.", 422, "imm_pricing_basis")
    if previous and old_basis == RATE_BASIS and chosen != RATE_BASIS:
        raise error("An allergen-rate order cannot return to historical bottle-MRP pricing.", 422, "imm_pricing_basis")
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


def prepare_suborders(groups, previous, error, *, mr=False):
    """The canonical list is the sole writable composition, not a bottle alias.

    Conversion is an explicit write. Every prior occurrence starts its own SUB;
    original encrypted groups are kept separately as immutable provenance.
    """
    if not previous:
        raise error("Save the initial submission to issue SUB identities before Admin review.", 422, "imm_suborder")
    converted = previous.get("pricingBasis") == SUBORDER_BASIS
    if mr and not converted:
        raise error("Only Admin can adopt suborder MRP.", 403, "imm_admin_review")
    old = {g["id"]: g for g in previous["groups"]} if converted else {}
    if not converted:
        for group in previous["groups"]:
            for item in group["items"]:
                sid = item.get("suborderId")
                if not sid or sid in old:
                    raise error("Save the original submission to issue distinct SUB identities before conversion.", 409, "imm_suborder")
                old[sid] = {"id": sid, "mrp": None, "items": [item]}
        if {g["id"] for g in groups} != set(old):
            raise error("Conversion must retain every existing SUB separately.", 409, "imm_suborder")
    for group in groups:
        sid = group["id"]
        saved = old.get(sid)
        if not saved or not re.fullmatch(r"SUB(?:[0-9]{3,12}|-[0-9]{6,12})", sid):
            raise error("Retain exact server-issued SUB identities. New headers cannot be invented or recycled.", 409, "imm_suborder")
        if not converted and saved["items"][0]["allergenId"] not in {i["allergenId"] for i in group["items"]}:
            raise error("Each existing occurrence must remain the initial child of its own SUB during conversion.", 409, "imm_suborder")
        old_items = {i["allergenId"]: i for i in saved["items"]}
        if mr:
            group["mrp"] = saved.get("mrp")
        for item in group["items"]:
            if item.get("suborderId") is not None or item.get("rate") is not None:
                raise error("Suborder children have no separate SUB number or price.", 422, "imm_suborder")
            # A missing Admin value in MR corrections is not permission to erase it.
            if mr:
                retained = old_items.get(item["allergenId"], {})
                for field in ("extract", "dilution"):
                    item[field] = retained.get(field)
            item.pop("rate", None)
            item.pop("suborderId", None)
    return groups


def retain_provenance(value, previous):
    if value["pricingBasis"] != SUBORDER_BASIS or not previous:
        return
    converted = previous.get("pricingBasis") == SUBORDER_BASIS
    value["historicalGroups"] = deepcopy(previous.get("historicalGroups", []) if converted else previous["groups"])
    value["historicalPricingBasis"] = previous.get("historicalPricingBasis") if converted else previous.get("pricingBasis", LEGACY_BASIS)
    value["historicalTotalMinor"] = previous.get("historicalTotalMinor") if converted else previous.get("totalMinor")


def issue(value, previous):
    """Called only inside an explicit version-checked/idempotent write."""
    next_number = previous.get("nextSuborderNumber", 1) if previous else 1
    # Both formats share one numeric sequence. Include removed saved occurrences
    # so a historical snapshot without a counter cannot recycle their numbers.
    groups = [*(previous["groups"] if previous else []), *value["groups"]]
    used = [int(i["suborderId"].removeprefix("SUB").removeprefix("-")) for g in groups
            for i in g["items"] if i.get("suborderId")]
    used += [int(g["id"].removeprefix("SUB").removeprefix("-")) for g in groups
             if re.fullmatch(r"SUB(?:[0-9]{3,12}|-[0-9]{6,12})", g["id"])]
    next_number = max([next_number, *[n + 1 for n in used]])
    if value.get("pricingBasis") == SUBORDER_BASIS:
        value["nextSuborderNumber"] = next_number
        return
    for group in value["groups"]:
        for item in group["items"]:
            if not item.get("suborderId"):
                item["suborderId"] = f"SUB{next_number:03d}"
                next_number += 1
    value["nextSuborderNumber"] = next_number
