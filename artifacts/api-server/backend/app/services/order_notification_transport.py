"""Explicit saved-provider contracts. No arbitrary endpoints or recovery changes."""
import json
import re
import httpx
import phonenumbers
from pydantic import EmailStr, TypeAdapter
from sqlalchemy import select
from app.db.models import User, MRProfile
from app.db.mr_models import MRDirectory
from app.db.staff_models import StaffProfile
from app.db.communication_models import CommunicationConfiguration as Configuration
from app.db.order_notification_models import OrderDelivery
from app.services.communication_crypto import CommunicationCrypto
from app.services.account_crypto import AccountCrypto
from app.services.staff_crypto import StaffCrypto
from app.schemas.communication import CommunicationInput
from app.services import template_test_mail, recovery_mail
from app.services.order_event_contract import render


class Blocked(Exception):
    def __init__(self, category):
        self.category = category
        super().__init__(category)


class ProviderRejected(Exception):
    pass


def configuration(db, settings, channel):
    rows = list(db.scalars(select(Configuration).where(
        Configuration.channel == channel, Configuration.is_default.is_(True)).limit(2)))
    if not rows:
        raise Blocked("configuration_required")
    if len(rows) != 1:
        raise Blocked("configuration_invalid")
    row = rows[0]
    if channel == "email":
        try:
            return row, template_test_mail.resolve_record(row, settings)
        except template_test_mail.SavedSMTPUnavailable as error:
            raise Blocked(error.category) from None
    try:
        crypto = CommunicationCrypto(settings)
        values = json.loads(crypto.decrypt(row, "payload", row.payload_ciphertext))
        secret = crypto.decrypt(row, "secret", row.secret_ciphertext)
        validated = CommunicationInput(channel=channel, type=row.type, channelVersion=1,
                                       values=values, secret=secret)
        values = validated.values
    except Exception:
        raise Blocked("configuration_unreadable") from None
    if channel == "sms":
        # Generic saved vendor/endpoint fields are not a wire protocol.
        raise Blocked("unsupported_provider")
    if row.type != "api" or values["provider"].strip().lower() != "meta_cloud":
        raise Blocked("unsupported_provider")
    # Meta Cloud API only. Credentials never go to an author-selected host,
    # redirect or arbitrary path. Version/phone identity must be supplied.
    if (values["endpoint"].rstrip("/") != "https://graph.facebook.com"
            or not re.fullmatch(r"v[0-9]+\.[0-9]+", values["apiVersion"])
            or not re.fullmatch(r"[0-9]{5,40}", values["phoneNumberId"])
            or not re.fullmatch(r"[0-9]{5,40}", values["businessAccountId"])):
        raise Blocked("provider_metadata_required")
    return row, (values, validated.secret)


def template_state(template):
    if not template:
        return "template_required"
    from app.services.immunotherapy_placement_notification import ASSIGNMENT
    if template.event_key == ASSIGNMENT and getattr(template, "channel", "email") != "email":
        return "template_only"
    if not getattr(template, "enabled", True):
        return "template_disabled"
    if getattr(template, "channel", "email") == "sms" and not template.dlt_id:
        return "dlt_template_required"
    if getattr(template, "channel", "email") == "waba" and (not template.provider_template or not template.language):
        return "template_approval_metadata_required"
    return None


def readiness(db, settings, channel, template):
    code = template_state(template)
    if code:
        return code, None
    try:
        config, _transport = configuration(db, settings, channel)
        return None, config
    except Blocked as error:
        return error.category, None


def destination(db, settings, event, user_id, channel):
    """Resolve only the protected singleton or the proven placing account."""
    user = db.get(User, user_id)
    from app.services.immunotherapy_placement_notification import scoped
    if scoped(event) and (channel != "email" or not user
            or not user.is_protected_system_admin or user.system_role != "super_admin"):
        raise Blocked("immunotherapy_admin_email_only")
    if not user or not user.is_active:
        raise Blocked("recipient_unavailable")
    mr = None
    if user.is_protected_system_admin and user.system_role == "super_admin":
        pass
    elif user.system_role == "mr" and user.id == event.placer_user_id:
        profile = db.get(MRProfile, event.placer_mr_id)
        mr = db.get(MRDirectory, event.placer_mr_id)
        if (not profile or profile.user_id != user.id or not profile.is_active
                or not mr or mr.deleted_at or mr.status != "active"):
            raise Blocked("recipient_unavailable")
    else:
        raise Blocked("recipient_unavailable")
    try:
        if channel == "email":
            address = AccountCrypto(settings).decrypt(user.id, "email", user.email_ciphertext)
            # The validated account mailbox is authoritative; don't substitute a
            # directory contact or manager when the login account has no email.
            if not address:
                raise Blocked("missing_recipient")
            return str(TypeAdapter(EmailStr).validate_python(address))
        if mr:
            phone, region = mr.phone, mr.dialCountry
        else:
            staff = db.scalar(select(StaffProfile).where(StaffProfile.user_id == user.id))
            if not staff or staff.deleted_at or staff.status != "active":
                raise Blocked("missing_recipient")
            phone = StaffCrypto(settings).decrypt(staff.id, "phone", staff.phone_ciphertext)
            region = staff.dial_country
        if not phone:
            raise Blocked("missing_recipient")
        parsed = phonenumbers.parse(phone, region)
        if not phonenumbers.is_valid_number_for_region(parsed, region):
            raise Blocked("invalid_recipient")
        return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
    except Blocked:
        raise
    except Exception:
        raise Blocked("recipient_unreadable") from None


def prepare(db, settings, delivery, event, template, values):
    from app.services.immunotherapy_placement_notification import scoped, ASSIGNMENT
    if scoped(event):
        # Enforce policy before provider resolution, including old pending/leased
        # attempts. Never reassign generic historical work to this new content.
        destination(db, settings, event, delivery.user_id, delivery.channel)
        from app.services.immunotherapy_placement_notification import order_url
        try:
            current_url = order_url(db, settings, event.order_id)
        except (ValueError, PermissionError):
            raise Blocked("trusted_portal_origin_required") from None
        if values.get("order_details_url") != current_url:
            raise Blocked("portal_origin_changed")
        if not template or template.event_key != ASSIGNMENT:
            raise Blocked("scoped_template_required")
        from app.services.email_rendering import validate_template, DeliveryHTML
        try:
            validate_template(template.subject, template.html, template.text, ASSIGNMENT)
            parsed = DeliveryHTML(template.html, link_token="order_details_url")
        except ValueError:
            raise Blocked("placement_template_invalid") from None
        if (not parsed.links or any("{{" + name + "}}" not in source
                for name in ("allergen_list", "order_details_url")
                for source in ("".join(parsed.visible_text), template.text))):
            # Old authored templates are readable, but cannot silently send an
            # incomplete enriched email. No automatic requeue after correction.
            raise Blocked("placement_template_enrichment_required")
    code = template_state(template)
    if code:
        raise Blocked(code)
    config, transport = configuration(db, settings, delivery.channel)
    if ((config.id, config.version) != (delivery.configuration_id, delivery.configuration_version)
            or (template.id, template.version) != (delivery.template_id, delivery.template_version)):
        # Configuration changes activate FUTURE eligible events only. Pending
        # intent cannot silently change destination provider/content.
        raise Blocked("configuration_or_template_changed")
    recipient = destination(db, settings, event, delivery.user_id, delivery.channel)
    digest = AccountCrypto(settings).lookup_index(
        "order-notification:" + delivery.channel + ":" +
        (recipient.casefold() if delivery.channel == "email" else recipient))
    # The worker holds the event row lock, serializing deduplication across
    # recipients even if contacts changed after intent creation.
    if db.scalar(select(OrderDelivery.id).where(
            OrderDelivery.event_id == event.id, OrderDelivery.channel == delivery.channel,
            OrderDelivery.id != delivery.id, OrderDelivery.destination_index == digest,
            OrderDelivery.status.in_(["sending", "accepted", "unknown"]))):
        raise Blocked("duplicate_destination")
    delivery.destination_index = digest
    if delivery.channel == "email":
        rendered = render(template, values)
        return lambda: recovery_mail.send_smtp(transport, recipient, rendered, sender_name=transport.sender_name)
    if delivery.channel == "waba":
        metadata, credential = transport
        payload = {
            "messaging_product": "whatsapp", "recipient_type": "individual",
            "to": recipient.lstrip("+"), "type": "template",
            "template": {"name": template.provider_template,
                         "language": {"code": template.language},
                         **({"components": [{"type": "body", "parameters": [
                             {"type": "text", "text": values[name]} for name in template.parameters]}]}
                            if template.parameters else {})},
        }
        url = f"https://graph.facebook.com/{metadata['apiVersion']}/{metadata['phoneNumberId']}/messages"
        def submit():
            with httpx.Client(timeout=15, follow_redirects=False, trust_env=False) as client:
                response = client.post(url, headers={"Authorization": "Bearer " + credential.get_secret_value()},
                                       json=payload)
                # No provider bodies, phone numbers, URLs or credentials enter
                # logs. Timeout/5xx/malformed acceptance remain ambiguous.
                if 400 <= response.status_code < 500:
                    raise ProviderRejected()
                response.raise_for_status()
                data = response.json()
                if not isinstance(data, dict) or not isinstance(data.get("messages"), list) or not data["messages"] or not data["messages"][0].get("id"):
                    raise RuntimeError("Provider outcome uncertain")
        return submit
    raise Blocked("unsupported_provider")
