"""Narrow assignment and facts; no transport or historical reconstruction."""
from zoneinfo import ZoneInfo

ASSIGNMENT = "mr_immunotherapy_placed"
VARIABLES = ("mr_name", "patient_name", "placement_date")
TEXT = ("Notification: MR {{mr_name}} has placed an immunotherapy order for patient "
        "{{patient_name}} on {{placement_date}}.\n"
        "Kindly note the same for your records.\n"
        "– Team AllergyEvexia")
HTML = ("<p>Notification: MR {{mr_name}} has placed an immunotherapy order for patient "
        "{{patient_name}} on {{placement_date}}.</p>"
        "<p>Kindly note the same for your records.</p><p>– Team AllergyEvexia</p>")
SUBJECT = "Notification: MR Immunotherapy order placed"


def scoped(event):
    # Also covers outstanding old-format attempts: they may not use the former
    # cross-order template or send to MR/SMS/WABA after this policy is installed.
    return (event.kind == "immunotherapy" and event.event == "order_placed"
            and event.placer_user_id is not None and event.placer_mr_id is not None)


def facts(snapshot, placed_at):
    return dict(patientName=snapshot["patient"]["name"],
                placementDate=placed_at.astimezone(ZoneInfo("Asia/Kolkata")).strftime("%d/%m/%Y"))


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
