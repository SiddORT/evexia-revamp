"""Auxiliary staff order permissions do not change MR or object ownership rules."""
from app.services.capability_policy import allowed


def attachment_changes(actor, resource, identities, previous):
    if actor.staff is None:
        return
    retained = {item["id"] for item in previous.get("attachments", [])} if previous else set()
    if {str(identity) for identity in identities} - retained and not allowed(actor, resource, "upload_attachment"):
        from app.services.immunotherapy import ImmError
        raise ImmError("Upload Prescription / Attachment permission is required.", 403, "access_denied")


def public_result(actor, resource, value):
    """Retain opaque saved IDs for edits without disclosing protected filenames."""
    # Shipment reports have their own singleton-only projection. Internal source
    # projects retain these fields for ordinary-edit preservation, not transport.
    def without_fulfillment(child):
        if isinstance(child, list):
            return [without_fulfillment(item) for item in child]
        if isinstance(child, dict):
            return {key: without_fulfillment(item) for key, item in child.items()
                    if key not in {"shipment", "shipmentHistory"}}
        return child
    value = without_fulfillment(value)
    if resource == "immunotherapy" and actor.role == "mr":
        def material_summary(child):
            if isinstance(child, list):
                return [material_summary(item) for item in child]
            if isinstance(child, dict):
                result = {key: material_summary(item) for key, item in child.items()}
                if isinstance(result.get("materialConsumption"), dict):
                    result["materialConsumption"] = {key: item for key, item in result["materialConsumption"].items()
                                                     if key in {"status", "unit", "materials", "at"}}
                return result
            return child
        value = material_summary(value)
    if resource == "kits":
        from app.services.capability_policy import is_super_admin
        if not is_super_admin(actor):
            # Includes MR and all import-review previous/order envelopes.
            def redact(child):
                if isinstance(child, list):
                    return [redact(item) for item in child]
                if isinstance(child, dict):
                    return {key: redact(item) for key, item in child.items()
                            if key not in {"pricing", "businessParking", "poNumber"}}
                return child
            value = redact(value)
    if actor.staff is None or allowed(actor, resource, "read_attachment"):
        return value
    if isinstance(value, list):
        return [public_result(actor, resource, item) for item in value]
    if isinstance(value, dict):
        return {key: ([{"id": item["id"], "name": "Private attachment", "restricted": True}
                       for item in child] if key == "attachments" and isinstance(child, list)
                      else public_result(actor, resource, child))
                for key, child in value.items()}
    return value
