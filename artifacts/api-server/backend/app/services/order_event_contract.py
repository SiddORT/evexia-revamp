"""Stable event names, privacy allowlist and single-pass literal substitution."""
from html import escape
from app.services.email_rendering import TOKEN, DeliveryHTML, RenderedEmail

EVENTS = {
    "order_placed": "Order placed",
    "order_confirmed": "Order confirmed",
    "order_rejected": "Order rejected",
    "order_resubmitted": "Order resubmitted",
    "order_shipped": "Order shipped",
    "order_delivered": "Order delivered",
    "order_returned": "Order returned",
    "order_transaction": "MR transaction recorded",
}
VARIABLES = ("order_number", "order_type", "event_name", "status", "mr_name",
             "timestamp", "transaction_amount", "company_name")
KINDS = {"immunotherapy": "Immunotherapy", "spt": "SPT", "lupin": "Lupin",
         "kits": "Kits & Consumables"}


def variables(event, payload, timestamp):
    return dict(order_number=payload["number"], order_type=KINDS[event.kind],
                event_name=EVENTS[event.event], status=payload["status"],
                mr_name=payload["mrName"], timestamp=timestamp.isoformat(),
                transaction_amount=payload.get("amount") or "Not applicable", company_name="EVEXIA")


def substitute(source, values, *, html=False):
    # Do not recursively interpret user facts as authored variables or markup.
    return TOKEN.sub(lambda match: escape(values[match[1]], quote=True) if html else values[match[1]], source)


def render(template, values):
    safe = "".join(DeliveryHTML(template.html).output)
    return RenderedEmail(subject=substitute(template.subject, values),
                         text=substitute(template.text, values),
                         html=substitute(safe, values, html=True))
