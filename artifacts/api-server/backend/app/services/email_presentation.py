"""Email-only presentation. No persistence, recipient selection or transport."""
from html import escape
from html.parser import HTMLParser
from datetime import datetime
from zoneinfo import ZoneInfo

LOGO = "/images/evexia-logo.png"
LOGO_CID = "cid:evexia-logo@evexia"


class _Layout(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.branded = False
        self.card = False
        self.heading = False
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "h1":
            self.heading = True
        if tag == "img" and attrs.get("src") in (LOGO, LOGO_CID):
            self.branded = True
        if tag == "table" and attrs.get("style"):
            self.card = True


def presentation(content, *, title="", source=None):
    """Wrap sanitized/server-owned markup, never inspect substituted user facts.

    Complete authored layouts keep their own cards and branding. Ordinary body
    fragments gain the shared frame without rewriting their words or links.
    Source is inspected before substitution so a literal name cannot opt out.
    """
    layout = _Layout(content if source is None else source)
    if layout.branded or layout.card:
        return content
    heading = (f'<h1 style="font-size:26px;line-height:1.3;color:#187368;margin:0 0 24px">'
               f'{escape(title)}</h1>') if title and not layout.heading else ""
    return (
        '<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f5fa;border-collapse:separate">'
        '<tr><td align="center" style="padding:24px 12px">'
        '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;'
        'border:1px solid #ddd7e5;border-radius:16px;border-collapse:separate">'
        '<tr><td style="padding:24px;background-color:#f0eaf5;text-align:center">'
        f'<img src="{LOGO}" alt="EVEXIA Life Sciences" width="154" style="display:inline-block;max-width:100%;height:auto">'
        '<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#5d506d;margin:12px 0 0">'
        'EVEXIA LIFE SCIENCES</p></td></tr>'
        '<tr><td style="padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.7;'
        'color:#28263a;overflow-wrap:anywhere">'
        + heading + content +
        '</td></tr><tr><td style="padding:16px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;'
        'line-height:1.6;color:#5d506d;border:0;background-color:#f7f5fa">'
        'EVEXIA Life Sciences</td></tr></table></td></tr></table>'
    )


def delivery_presentation(content, **kwargs):
    # Only application-owned image markup is introduced by presentation().
    # Authored markup has already passed DeliveryHTML before reaching here.
    return presentation(content, **kwargs).replace(f'src="{LOGO}"', f'src="{LOGO_CID}"')


def recorded_time(value):
    """Display the saved instant, without altering its storage or other channels."""
    instant = datetime.fromisoformat(value)
    if instant.tzinfo is None:
        raise ValueError("Recorded time requires an explicit time zone.")
    local = instant.astimezone(ZoneInfo("Asia/Kolkata"))
    months = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    return (f"{local.day:02d} {months[local.month - 1]} {local.year}, "
            f"{local.strftime('%I:%M %p')} IST (Asia/Kolkata, UTC+05:30)")


ORDER_PHRASES = {
    "order_placed": "has been placed",
    "order_confirmed": "has been confirmed",
    "order_rejected": "has been rejected",
    "order_resubmitted": "has been resubmitted for review",
    "order_shipped": "has been shipped",
    "order_delivered": "has a recorded delivery",
    "order_returned": "has been returned",
    "order_transaction": "has a recorded MR transaction of INR {{transaction_amount}}",
}


def order_sources(event):
    """Exact historical pristine pair, not a heuristic match or a DB upgrade."""
    phrase = ORDER_PHRASES.get(event)
    if phrase is None:
        return None
    text = ("{{company_name}}: {{order_type}} order {{order_number}} " + phrase +
            ". Placing MR: {{mr_name}}. Status: {{status}}. Recorded: {{timestamp}}.")
    return "<p>" + text + "</p>", text


def structured_order(event):
    """Same allowed facts as the seeded sentence; no links or extra order facts."""
    transaction = event == "order_transaction"
    fields = [("Order type", "order_type"), ("Placing MR", "mr_name"),
              ("Status", "status"), ("Recorded", "timestamp")]
    if transaction:
        fields.append(("MR transaction (INR)", "transaction_amount"))
    html = (
        '<h1 style="font-size:26px;line-height:1.3;color:#187368;margin:0 0 24px">{{event_name}}</h1>'
        '<p style="font-size:13px;color:#5d506d;margin:0">Saved order number</p>'
        '<p style="font-size:24px;font-weight:bold;line-height:1.4;margin:4px 0 24px;overflow-wrap:anywhere">{{order_number}}</p>'
    )
    text = "{{company_name}}\n{{event_name}}\nSaved order number: {{order_number}}\n\n"
    for label, name in fields:
        html += (f'<p style="margin:0 0 18px"><span style="font-size:13px;color:#5d506d">{label}</span>'
                 f'<br><strong>{{{{{name}}}}}</strong></p>')
        text += f"{label}: {{{{{name}}}}}\n"
    return html, text


def order_content(template):
    # Version guards keep protecting queued work against stored template edits.
    # This is a runtime view only: no version/provenance claims, writes or replay.
    pristine = order_sources(template.event_key)
    if pristine and (template.html, template.text) == pristine:
        return structured_order(template.event_key)
    return template.html, template.text


ACCOUNT_TITLES = {
    "password_recovery": "Reset your password",
    "account_invitation": "Welcome to the Admin workspace",
    "mr_invitation": "Welcome to the MR portal",
    "mr_immunotherapy_placed": "Immunotherapy order placed",
}
