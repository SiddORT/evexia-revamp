"""Saved SMTP for explicit template tests/invitations; never environment fallback."""
import json
from dataclasses import dataclass
from email.headerregistry import Address

from pydantic import SecretStr
from sqlalchemy import select

from app.db.communication_models import CommunicationConfiguration
from app.schemas.communication import CommunicationInput
from app.services.communication_crypto import CommunicationCrypto, CommunicationError
from app.services import recovery_mail


# Only these fixed categories/messages may reach attempt logs or API responses.
CONFIGURATION_GUIDANCE = {
    "saved_smtp_missing": "No default Email configuration is available. Save an SMTP configuration and make it the Email default in Settings → Communication.",
    "saved_smtp_unsupported": "The default Email configuration is not SMTP. Select an SMTP default in Settings → Communication; API and Platform email sends are not supported.",
    "saved_smtp_insecure": "The default SMTP configuration has security set to none. Select STARTTLS or TLS in Settings → Communication before sending email.",
    "saved_smtp_unavailable": "The saved default Email configuration or its credential cannot be read. Review Settings → Communication and ask the operator to restore encrypted storage access. No email was sent.",
    "saved_smtp_invalid": "The default SMTP configuration or credential is invalid. Review its host, port, TLS mode, username, app password and sender fields in Settings → Communication.",
}


class SavedSMTPUnavailable(Exception):
    def __init__(self, category):
        self.category = category
        super().__init__(CONFIGURATION_GUIDANCE[category])


@dataclass(frozen=True, repr=False)
class SavedSMTP:
    """Request-local only; never persist, cache, log or serialize this object."""
    smtp_host: str
    smtp_port: int
    smtp_implicit_tls: bool
    smtp_username: str
    smtp_password: SecretStr
    smtp_from: str
    sender_name: str


def resolve(db, settings):
    # A single statement reads the default and both ciphertexts from one MVCC
    # snapshot. No channel/configuration locks, enumeration or second selection.
    # The dispatcher commits its attempt before any SMTP network operation.
    rows = list(db.scalars(select(CommunicationConfiguration).where(
        CommunicationConfiguration.channel == "email",
        CommunicationConfiguration.is_default.is_(True),
    ).limit(2).execution_options(populate_existing=True)))
    if not rows:
        raise SavedSMTPUnavailable("saved_smtp_missing")
    if len(rows) != 1:
        raise SavedSMTPUnavailable("saved_smtp_invalid")
    row = rows[0]
    if row.type != "smtp":
        raise SavedSMTPUnavailable("saved_smtp_unsupported")
    try:
        crypto = CommunicationCrypto(settings)
        payload = crypto.decrypt(row, "payload", row.payload_ciphertext)
        secret = crypto.decrypt(row, "secret", row.secret_ciphertext)
    except CommunicationError:
        raise SavedSMTPUnavailable("saved_smtp_unavailable") from None
    try:
        config = CommunicationInput(channel="email", type="smtp", channelVersion=1,
                                    values=json.loads(payload), secret=secret)
        values = config.values
        if values["security"] == "none":
            raise SavedSMTPUnavailable("saved_smtp_insecure")
        transport = SavedSMTP(
            smtp_host=values["host"], smtp_port=int(values["port"]),
            smtp_implicit_tls=values["security"] == "tls",
            smtp_username=values["username"], smtp_password=config.secret,
            smtp_from=values["fromEmail"], sender_name=values["fromName"],
        )
        # Communication storage permits more than delivery does. Validate the
        # actual mailbox/header and required credential before network handoff.
        if (transport.smtp_password is None
                or recovery_mail.transport_configuration_issues(transport)):
            raise ValueError()
        Address(display_name=transport.sender_name, addr_spec=transport.smtp_from)
        return transport
    except SavedSMTPUnavailable:
        raise
    except Exception:
        # Never propagate validation errors containing decrypted inputs.
        raise SavedSMTPUnavailable("saved_smtp_invalid") from None
