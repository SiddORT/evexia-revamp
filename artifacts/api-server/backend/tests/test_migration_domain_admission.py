"""New revision round trip preserves legacy routing rows without admission."""
from alembic import command
import uuid
from sqlalchemy import select, inspect, text
from sqlalchemy.orm import Session
from app.core.config import get_settings
from app.core.security import hash_password
from app.services.account_crypto import AccountCrypto
from app.db.role_url_models import RoleHostname
from app.db.domain_models import DomainPolicy
from test_migration_0006 import migration_db
from test_sessions import PASSWORD


def test_upgrade_downgrade_preserves_legacy_attribution(migration_db):
    engine, config = migration_db
    command.upgrade(config, "0036_reference_privacy")
    with Session(engine) as db:
        # Frozen 0036 contract: current bootstrap/ORM includes columns added
        # by later migrations, which this historical round-trip must not run.
        actor = uuid.uuid4()
        crypto = AccountCrypto(get_settings())
        email = "crm-admin@allergyevexia.in"
        db.execute(text("SELECT set_config('evexia.bootstrap_super_admin', 'on', true)"))
        db.execute(text("""
            INSERT INTO users(id, email, email_index, password_hash, system_role,
                              is_active, token_version, identity_version,
                              is_protected_system_admin)
            VALUES (:id, :email, :index, :password, 'super_admin', true, 0, 0, true)
        """), {"id": actor, "email": crypto.encrypt(actor, "email", email),
               "index": crypto.lookup_index(email), "password": hash_password(PASSWORD)})
        db.execute(text("SELECT set_config('evexia.bootstrap_super_admin', 'off', true)"))
        row = RoleHostname(hostname="legacy.allergyevexia.com", role="admin", enabled=True,
                           version=7, created_by=actor, updated_by=actor)
        db.add(row)
        db.commit()
        before = (row.id, row.hostname, row.role, row.enabled, row.version,
                  row.created_by, row.updated_by, row.created_at, row.updated_at)
    command.upgrade(config, "0037_domain_admission")
    with Session(engine) as db:
        assert list(db.scalars(select(DomainPolicy))) == []
        row = db.get(RoleHostname, before[0])
        assert before == (row.id, row.hostname, row.role, row.enabled, row.version,
                          row.created_by, row.updated_by, row.created_at, row.updated_at)
        db.add(DomainPolicy(hostname="portal.allergyevexia.com", kind="primary",
                            created_by=actor, updated_by=actor))
        db.commit()
    command.downgrade(config, "0036_reference_privacy")
    assert "domain_policies" not in inspect(engine).get_table_names()
    with Session(engine) as db:
        assert db.get(RoleHostname, before[0]).version == 7
    command.upgrade(config, "0037_domain_admission")
    with Session(engine) as db:
        assert list(db.scalars(select(DomainPolicy))) == []
