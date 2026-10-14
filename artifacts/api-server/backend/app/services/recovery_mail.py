"""TLS-only SMTP delivery. Do not log recipients, credentials or reset URLs."""
import smtplib
import ssl
from email.message import EmailMessage
from urllib.parse import urlsplit

from pydantic import EmailStr, TypeAdapter


class RecoveryUnavailable(Exception):
    """Contains only allowlisted setting categories, never configured values."""

    def __init__(self, issues):
        self.issues = tuple(issues)
        super().__init__("Password recovery configuration unavailable")


def configuration_issues(settings):
    """Offline preflight: no database lookup, network connection or secret output."""
    issues = []
    try:
        url = urlsplit(settings.password_recovery_url or "")
        if (url.scheme != "https" or not url.hostname or url.username or url.password
                or url.query or url.fragment or url.path.rstrip("/") != "/reset-password"
                or url.port == 0):
            raise ValueError()
    except Exception:
        issues.append("PASSWORD_RECOVERY_URL:missing_or_invalid")
    try:
        if (not settings.smtp_host or any(c.isspace() for c in settings.smtp_host)
                or any(c in settings.smtp_host for c in "/@?#")):
            raise ValueError()
    except Exception:
        issues.append("SMTP_HOST:missing_or_invalid")
    if not 1 <= settings.smtp_port <= 65535:
        issues.append("SMTP_PORT:invalid")
    try:
        TypeAdapter(EmailStr).validate_python(settings.smtp_from)
    except Exception:
        issues.append("SMTP_FROM:missing_or_invalid")
    if bool(settings.smtp_username) != bool(settings.smtp_password):
        issues.append("SMTP_AUTH:incomplete_pair")
    return tuple(issues)


def validate_configuration(settings):
    issues = configuration_issues(settings)
    if issues:
        raise RecoveryUnavailable(issues)


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
