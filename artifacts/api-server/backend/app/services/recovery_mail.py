"""TLS-only SMTP delivery. Do not log recipients, credentials or reset URLs."""
import smtplib
import ssl
from email.message import EmailMessage
from urllib.parse import urlsplit

from pydantic import EmailStr, TypeAdapter


class RecoveryUnavailable(Exception):
    pass


def validate_configuration(settings):
    try:
        url = urlsplit(settings.password_recovery_url or "")
        if (url.scheme != "https" or not url.hostname or url.username or url.password
                or url.query or url.fragment or url.path.rstrip("/") != "/reset-password"):
            raise ValueError()
        if (not settings.smtp_host or any(c.isspace() for c in settings.smtp_host)
                or not 1 <= settings.smtp_port <= 65535):
            raise ValueError()
        TypeAdapter(EmailStr).validate_python(settings.smtp_from)
        if bool(settings.smtp_username) != bool(settings.smtp_password):
            raise ValueError()
    except Exception:
        raise RecoveryUnavailable() from None


def send(settings, recipient, token):
    validate_configuration(settings)
    # Fragment never reaches HTTP access logs or the referrer header.
    link = settings.password_recovery_url.rstrip("/") + "#token=" + token
    message = EmailMessage()
    message["Subject"] = "Reset your EVEXIA password"
    message["From"] = settings.smtp_from
    message["To"] = TypeAdapter(EmailStr).validate_python(recipient)
    message.set_content(
        "A password reset was requested for your EVEXIA account.\n\n"
        f"{link}\n\n"
        "This link expires in 15 minutes and can be used once. "
        "If you did not request this, ignore this email. Your password has not changed.\n"
    )
    context = ssl.create_default_context()
    if settings.smtp_implicit_tls:
        connection = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port,
                                     timeout=10, context=context)
    else:
        connection = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10)
    with connection as smtp:
        if not settings.smtp_implicit_tls:
            smtp.ehlo()
            smtp.starttls(context=context)  # No plaintext or downgrade fallback.
            smtp.ehlo()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password.get_secret_value())
        smtp.send_message(message)
