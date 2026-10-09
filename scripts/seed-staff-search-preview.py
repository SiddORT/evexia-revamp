"""Synthetic browser-search fixture. Refuses every non-private test database."""
import os
import uuid
from datetime import timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

url = os.environ.get("TEST_DATABASE_URL", "")
parsed = urlparse(url)
socket = parse_qs(parsed.query).get("host", [""])[0]
if (os.environ.get("APP_ENV") != "test" or url != os.environ.get("DATABASE_URL")
        or parsed.hostname is not None or parsed.path != "/evexia_auth_preview_test"
        or not socket.startswith("/tmp/evexia-auth-preview.")
        or Path(socket).name != "socket" or not Path(socket).is_dir()):
    raise SystemExit("Staff search fixture requires the private authenticated-preview database.")

from sqlalchemy import select
from app.core.config import get_settings
from app.core.security import utcnow
from app.db.models import User
from app.db.session import session_factory
from app.db.staff_models import StaffProfile
from app.db.designation_models import Designation
from app.schemas.staff import StaffFields
from app.services.staff import assign
from app.services.staff_crypto import StaffCrypto

with session_factory()() as db:
    admin = db.scalar(select(User).where(User.is_protected_system_admin.is_(True)))
    if not admin:
        raise SystemExit("Synthetic protected admin is required.")
    crypto = StaffCrypto(get_settings())
    now = utcnow()
    designation = db.scalar(select(Designation).where(Designation.name == "Synthetic Executive",
                                                       Designation.status == "active",
                                                       Designation.deleted_at.is_(None)))
    if designation is None:
        designation = Designation(id=uuid.uuid4(), name="Synthetic Executive", shortName="SE",
                                  status="active", version=1, created_by=admin.id, updated_by=admin.id)
        db.add(designation)
        db.flush()
    for index in range(1, 606):
        user = User(id=uuid.uuid4(), username=f"st_{index:028x}", email=None,
                    password_hash=admin.password_hash, system_role=None)
        db.add(user)
        profile = StaffProfile(id=uuid.UUID(int=index), user_id=user.id, version=1,
                               created_by=admin.id, updated_by=admin.id,
                               created_at=now - timedelta(seconds=index), updated_at=now)
        assign(profile, StaffFields(name=f"Directory Preview {index}",
               email=f"preview-search-{index}@example.com", phone="9876543210",
               dialCountry="IN", role="Staff", designation_id=designation.id,
               dateOfJoining="2025-01-15", status="active"), crypto)
        db.add(profile)
    db.commit()
