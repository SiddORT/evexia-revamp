"""New MR placement only. Historical compositions are never inferred or repacked."""
from copy import deepcopy

POLICY = "mr_category_mix_v1"


def governed(previous):
    return bool(previous and any(g.get("compositionPolicy") == POLICY for g in previous["groups"]))


def metadata(row):
    return {"categoryId": str(row.category_id), "mix": row.mix}


def placement(groups, masters, error):
    """Ignore incoming group identities/eligibility; build real canonical headers."""
    result, batches = [], {}
    for source in groups:
        for raw in source["items"]:
            if any(raw.get(field) is not None for field in ("suborderId", "rate", "extract", "dilution")):
                raise error("New MR selections cannot supply SUB identities or Admin review values.", 422, "imm_suborder")
            item = deepcopy(raw)
            item.pop("rate", None)
            item.pop("suborderId", None)
            item["groupingBasis"] = metadata(masters[item["allergenId"]])
            basis = item["groupingBasis"]
            group = batches.get(basis["categoryId"]) if basis["mix"] else None
            # Preserve distinct occurrences without creating duplicate child keys.
            if not group or len(group["items"]) == 3 or any(i["allergenId"] == item["allergenId"] for i in group["items"]):
                group = {"id": f"placement-{len(result) + 1}", "mrp": None, "items": [],
                         "compositionPolicy": POLICY}
                result.append(group)
                if basis["mix"]:
                    batches[basis["categoryId"]] = group
            group["items"].append(item)
    return result


def retain_basis(groups, previous, masters, error):
    """Edits keep header membership/IDs; validate, never merge or rebalance."""
    if not governed(previous):
        return
    old = {g["id"]: g for g in previous["groups"]}
    for group in groups:
        saved = old.get(group["id"])
        if not saved or saved.get("compositionPolicy") != POLICY:
            raise error("Retain saved grouped SUB identities.", 409, "imm_suborder")
        group["compositionPolicy"] = POLICY
        old_items = {i["allergenId"]: i for i in saved["items"]}
        for item in group["items"]:
            retained = old_items.get(item["allergenId"])
            item["groupingBasis"] = (deepcopy(retained["groupingBasis"]) if retained
                                     else metadata(masters[item["allergenId"]]))
        validate(group, error)


def validate(group, error):
    bases = [i.get("groupingBasis") for i in group["items"]]
    if (not 1 <= len(bases) <= 3 or any(
        not isinstance(b, dict) or not b.get("categoryId") or type(b.get("mix")) is not bool for b in bases
    ) or (len(bases) > 1 and (not all(b["mix"] for b in bases)
                            or len({b["categoryId"] for b in bases}) != 1))):
        raise error("A grouped SUB allows up to three Mix allergens from one category; No Mix must remain alone.", 422, "imm_grouping")
