"""Narrow assignment and facts; no transport or historical reconstruction."""
from zoneinfo import ZoneInfo
import re
import uuid

ASSIGNMENT = "mr_immunotherapy_placed"
VARIABLES = ("mr_name", "patient_name", "placement_date")
EMAIL_VARIABLES = (*VARIABLES, "allergen_list", "order_details_url")
TEXT = ("Notification: MR {{mr_name}} has placed an immunotherapy order for patient "
        "{{patient_name}} on {{placement_date}}.\n"
        "Kindly note the same for your records.\n"
        "– Team AllergyEvexia")
HTML = ("<p>Notification: MR {{mr_name}} has placed an immunotherapy order for patient "
        "{{patient_name}} on {{placement_date}}.</p>"
        "<p>Kindly note the same for your records.</p><p>– Team AllergyEvexia</p>")
SUBJECT = "Notification: MR Immunotherapy order placed"
EMAIL_TEXT = TEXT + "\n\nAllergens:\n{{allergen_list}}\n\nView order details: {{order_details_url}}"
EMAIL_HTML = HTML + (
    "<p><strong>Allergens:</strong></p><div>{{allergen_list}}</div>"
    '<p><a href="{{order_details_url}}">View order details</a></p>'
    "<p>Order URL: {{order_details_url}}</p>")


def scoped(event):
    # Also covers outstanding old-format attempts: they may not use the former
    # cross-order template or send to MR/SMS/WABA after this policy is installed.
    return (event.kind == "immunotherapy" and event.event == "order_placed"
            and event.placer_user_id is not None and event.placer_mr_id is not None)


def facts(snapshot, placed_at):
    return dict(patientName=snapshot["patient"]["name"],
                placementDate=placed_at.astimezone(ZoneInfo("Asia/Kolkata")).strftime("%d/%m/%Y"),
                allergenGroups=[dict(group=group["id"],
                    names=[item["allergen"]["name"] for item in group["items"]])
                    for group in snapshot["groups"]])


def order_url(db, settings, order_id):
    """Server-owned origin only. No request headers or arbitrary CORS fallback."""
    from sqlalchemy import select
    from app.db.domain_models import DomainPolicy
    from app.schemas.role_urls import canonical_hostname
    from app.services.domain_policy import admitted
    if settings.app_env == "development" and settings.evexia_managed_preview:
        host = settings.replit_dev_domain
        if (not host or canonical_hostname(host) != host
                or not host.endswith(".replit.dev")):
            raise ValueError("Managed preview origin unavailable.")
    else:
        policy = db.scalar(select(DomainPolicy).where(DomainPolicy.kind == "primary"))
        if not policy or canonical_hostname(policy.hostname) != policy.hostname:
            raise ValueError("Primary portal domain unavailable.")
        host = policy.hostname
        # Do not bypass primary verification using the bootstrap exception.
        admitted(db, host)
    return f"https://{host}/admin/orders/immunotherapy/{uuid.UUID(str(order_id))}"


def email_values(payload):
    result = values(payload)
    groups = payload.get("allergenGroups")
    if not isinstance(groups, list) or not groups:
        raise ValueError("Saved allergen facts unavailable.")
    sections = []
    for group in groups:
        if (not isinstance(group, dict) or not isinstance(group.get("group"), str)
                or not isinstance(group.get("names"), list) or not group["names"]
                or any(not isinstance(name, str) or not name.strip() for name in group["names"])):
            raise ValueError("Saved allergen facts unavailable.")
        # No deduplication, master lookup, concentrations or clinical inference.
        sections.append(group["group"] + "\n" + "\n".join("• " + name for name in group["names"]))
    url = payload.get("orderDetailsUrl", "")
    if not re.fullmatch(r"https://[a-z0-9.-]+/admin/orders/immunotherapy/[0-9a-f-]{36}", url):
        raise ValueError("Order destination unavailable.")
    return dict(**result, allergen_list="\n\n".join(sections), order_details_url=url)


def values(payload):
    if not payload.get("patientName") or not payload.get("placementDate"):
        raise ValueError("Placement facts unavailable; historical facts are not inferred.")
    return dict(mr_name=payload["mrName"], patient_name=payload["patientName"],
                placement_date=payload["placementDate"])


def message(payload):
    from app.services.order_event_contract import substitute
    if not payload.get("patientName") or not payload.get("placementDate"):
        return None
    return substitute(TEXT, values(payload))
