"""New revision round trip preserves legacy routing rows without admission."""
from alembic import command
from sqlalchemy import select, inspect
from sqlalchemy.orm import Session
from pydantic import SecretStr
from app.bootstrap import bootstrap_super_admin
from app.db.role_url_models import RoleHostname
from app.db.domain_models import DomainPolicy
from test_migration_0006 import migration_db
from test_sessions import PASSWORD


def test_upgrade_downgrade_preserves_legacy_attribution(migration_db):
    engine, config = migration_db
    command.upgrade(config, "0036_reference_privacy")
    with Session(engine) as db:
        actor = bootstrap_super_admin(db, SecretStr(PASSWORD)).user_id
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
