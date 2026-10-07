"""Exercise actual forward/rollback metadata DDL in a disposable schema."""
import os
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings


@pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="requires explicitly isolated TEST_DATABASE_URL")
def test_private_file_migration_constraints_and_domain_rollback_retention(monkeypatch):
    url = make_url(os.environ["TEST_DATABASE_URL"])
    assert "test" in url.database
    schema = f"migration_test_{uuid.uuid4().hex}"
    admin_engine = create_engine(url)
    with admin_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    isolated_url = url.set(query={**url.query, "options": f"-csearch_path={schema}"})
    monkeypatch.setenv("DATABASE_URL", isolated_url.render_as_string(hide_password=False))
    get_settings.cache_clear()
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    engine = create_engine(isolated_url)
    try:
        # The file rollback contract belongs to 0004, not later forward-only
        # master migrations. Do not weaken those migrations for this fixture.
        command.upgrade(config, "0004_private_files")
        user_id, patient_id, file_id = (uuid.uuid4() for _ in range(3))
        with engine.begin() as conn:
            conn.execute(text(
                "INSERT INTO users(id,email,password_hash,is_active,token_version,identity_version,system_role)"
                " VALUES (:id,'synthetic@example.test','unused',true,0,1,'mr')"
            ), {"id": user_id})
            conn.execute(text(
                "INSERT INTO patients(id,is_active,version) VALUES(:id,true,1)"
            ), {"id": patient_id})
        params = {"id": file_id, "patient": patient_id, "user": user_id,
                  "key": f"patients/{patient_id}/documents/{file_id}.pdf", "state": "verified"}
        sql = text(
            "INSERT INTO files(id,patient_id,category,object_key,display_name,content_type,size,uploader_id,state,scanner_status,version)"
            " VALUES(:id,:patient,'documents',:key,'synthetic.pdf','application/pdf',1,:user,:state,'pending',1)"
        )
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(sql, params)
        params["state"] = "quarantined"
        with engine.begin() as conn:
            conn.execute(sql, params)
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(text("UPDATE files SET object_key=:key WHERE id=:id"),
                         {"id": file_id, "key": f"patients/{uuid.uuid4()}/documents/{file_id}.pdf"})
        command.downgrade(config, "0003_system_domain")
        with engine.connect() as conn:
            assert conn.scalar(text("SELECT count(*) FROM patients WHERE id=:id"), {"id": patient_id}) == 1
            assert conn.scalar(text("SELECT system_role FROM users WHERE id=:id"), {"id": user_id}) == "mr"
            assert conn.scalar(text("SELECT to_regclass('files')")) is None
        # Mapping/domain data makes earlier rollback deliberately unsafe.
        with pytest.raises(RuntimeError, match="Cannot downgrade"):
            command.downgrade(config, "0002_username")
    finally:
        engine.dispose()
        get_settings.cache_clear()
        with admin_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin_engine.dispose()