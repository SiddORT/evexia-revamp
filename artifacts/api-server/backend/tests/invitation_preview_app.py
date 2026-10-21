"""Private focused email onboarding fixture, never a normal runtime entrypoint."""
import json
import os
from pathlib import Path
import re
import uuid
from sqlalchemy import select
from sqlalchemy.engine import make_url
from app.core.config import get_settings
from app.db.session import session_factory
from app.db.models import User
from app.db.designation_models import Designation
from app.main import app
from app.services import recovery_mail, auth

settings = get_settings()
url = make_url(settings.database_url)
root = Path(url.query.get("host", "")).parent
if (settings.app_env != "test" or url.database != "evexia_auth_preview_test"
        or not str(root).startswith("/tmp/evexia-auth-preview.") or url.host
        or not (root / "socket").is_dir()
        or os.environ.get("EVEXIA_INVITATION_OUTBOX") != str(root / "invitation-outbox.jsonl")):
    raise RuntimeError("Invitation fixture requires its isolated socket-only harness.")


class CapturingSMTP:
    def __init__(self, host, port, **kwargs):
        assert host == "smtp.example.com" and port == 587
        self.secure = False
    def __enter__(self): return self
    def __exit__(self, *_args): pass
    def ehlo(self): pass
    def starttls(self, context):
        assert context.check_hostname
        self.secure = True
    def send_message(self, message):
        assert self.secure and message["From"] == "recovery@example.com"
        text_part = next(part for part in message.walk() if part.get_content_type() == "text/plain")
        html_part = next(part for part in message.walk() if part.get_content_type() == "text/html")
        link = re.search(r"https://portal\.example\.com/reset-password[^\s]+", text_part.get_content())[0]
        assert "#token=" in link and "15 minutes" in text_part.get_content()
        assert "cid:evexia-logo@evexia" in html_part.get_content()
        assert any(part.get_content_type() == "image/png" for part in message.walk())
        path = root / "invitation-outbox.jsonl"
        with path.open("a", encoding="utf-8") as output:
            output.write(json.dumps({"recipient": str(message["To"]), "link": link}) + "\n")
        path.chmod(0o600)
        return {}


recovery_mail.smtplib.SMTP = CapturingSMTP


def seed():
    with session_factory()() as db:
        owner = db.scalar(select(User).where(User.is_protected_system_admin.is_(True)))
        db.add(Designation(id=uuid.UUID("62900000-0000-4000-8000-000000000001"),
                           name="Invitation fixture designation", shortName="IF", status="active",
                           created_by=owner.id, updated_by=owner.id))
        db.commit()


if __name__ == "__main__":
    seed()
