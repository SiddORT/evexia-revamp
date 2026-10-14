"""Isolated browser DNS fixture. Never import from the production entrypoint."""
import os
from sqlalchemy import select
from app.core.config import get_settings
from app.db.session import session_factory
from app.db.domain_models import DomainPolicy
from app.services import domain_policy

if (get_settings().app_env != "test" or
        not os.environ.get("TEST_DATABASE_URL", "").startswith("postgresql+psycopg://") or
        "/tmp/evexia-auth-preview." not in os.environ.get("TEST_DATABASE_URL", "")):
    raise RuntimeError("Domain browser fixtures require the private disposable preview database")


def fixture_txt(name):
    if not name.startswith("_evexia-verification."):
        raise RuntimeError("Unexpected fixture query")
    host = name.removeprefix("_evexia-verification.")
    with session_factory()() as db:
        row = db.scalar(select(DomainPolicy).where(DomainPolicy.hostname == host))
        return [row.challenge] if row and row.challenge else []


domain_policy.lookup_txt = fixture_txt

from app.main import app  # noqa: E402
