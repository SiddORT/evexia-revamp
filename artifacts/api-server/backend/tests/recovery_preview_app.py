"""Private recovery browser fixture. Never loaded by the application entrypoint."""
import json
import os
from datetime import timedelta
from pathlib import Path
import uuid

import jwt
from sqlalchemy import select
from sqlalchemy.engine import make_url

from app.core.config import get_settings
from app.core.security import utcnow
from app.db.models import User
from app.db.session import session_factory
from app.main import app
from app.services import auth, password_recovery, recovery_mail

settings = get_settings()
url = make_url(settings.database_url)
root = Path(url.query.get("host", "")).parent
if (settings.app_env != "test" or url.database != "evexia_auth_preview_test"
        or not str(root).startswith("/tmp/evexia-auth-preview.")
        or url.host or not (root / "socket").is_dir()
        or os.environ.get("EVEXIA_RECOVERY_FIXTURE") != str(root / "recovery-fixture.json")):
    raise RuntimeError("Recovery fixture requires the isolated preview harness.")


class CapturingSMTP:
    """Intercept transport only: real message/link construction, no network or email."""
    def __init__(self, host, port, **kwargs):
        assert host == "smtp.example.com" and port == 587
        self.secure = False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def ehlo(self):
        pass

    def starttls(self, context):
        assert context.check_hostname
        self.secure = True

    def send_message(self, message):
        assert self.secure
        assert message["From"] == "recovery@example.com"
        content = message.get_content()
        link = next(line for line in content.splitlines() if line.startswith("https://"))
        assert link.startswith("https://portal.example.com/reset-password#token=")
        assert "15 minutes" in content
        # Private short-lived capture, removed by the harness. Never log the body.
        path = root / "recovery-outbox.jsonl"
        with path.open("a", encoding="utf-8") as outbox:
            outbox.write(json.dumps({"recipient": str(message["To"]), "link": link}) + "\n")
        path.chmod(0o600)


recovery_mail.smtplib.SMTP = CapturingSMTP


def seed():
    from app.db.designation_models import Designation
    from app.db.staff_models import StaffProfile
    from app.schemas.staff import StaffFields
    from app.services import staff

    with session_factory()() as db:
        owner = db.scalar(select(User).where(User.is_protected_system_admin.is_(True)))
        actor, _ = auth.login(db, owner.email, settings.super_admin_initial_password.get_secret_value(),
                              settings, False, "recovery-fixture", "127.0.0.1", "admin")
        designation = Designation(id=uuid.uuid4(), name="Recovery fixture", shortName="RF",
                                  status="active", created_by=owner.id, updated_by=owner.id)
        db.add(designation)
        db.commit()
        result = staff.create(db, actor, StaffFields(
            name="Synthetic Recovery Staff", email="staff-recovery@example.com",
            phone="9876543210", dialCountry="IN", role="Staff",
            designation_id=designation.id, dateOfJoining="2025-01-15", status="active",
        ), settings)
        profile = db.get(StaffProfile, result["record"]["id"])
        profile.workspace_login_enabled = True
        db.commit()
        user = db.get(User, profile.user_id)
        identity = auth._load_identity(db, user)
        now = utcnow()
        claims = {
            "sub": str(user.id), "ver": user.token_version, "iver": user.identity_version,
            "kind": "admin", "recipient": password_recovery._binding(
                settings, password_recovery._recipient(identity, settings)),
            "purpose": "password_recovery", "jti": "x" * 43,
            "iat": now - timedelta(minutes=20), "nbf": now - timedelta(minutes=20),
            "exp": now - timedelta(minutes=5), "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience + ":password-recovery",
        }
        fixture = {
            "identifier": user.username, "password": result["initial_password"],
            "expired": jwt.encode(claims, password_recovery._key(settings), algorithm="HS256"),
        }
        path = root / "recovery-fixture.json"
        path.write_text(json.dumps(fixture), encoding="utf-8")
        path.chmod(0o600)


if __name__ == "__main__":
    seed()
