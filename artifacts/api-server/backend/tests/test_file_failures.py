"""Credential, commit ambiguity and adapter partial-failure regressions."""
import uuid
from datetime import timedelta

import jwt
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import utcnow
from app.db.file_models import FileRecord
from app.db.models import Patient
from test_files import PNG, clean_scanner, files_env, saved_upload, upload


@pytest.mark.parametrize("mutation", ["issuer", "audience", "expired", "algorithm", "version", "legacy", "missing"])
def test_invalid_credentials_never_invoke_storage(files_env, mutation):
    env = files_env
    settings = env["settings"]
    token = env["auth"](env["owner"])["Authorization"].split()[1]
    claims = jwt.decode(token, settings.signing_key, algorithms=["HS256"], audience=settings.jwt_audience)
    algorithm = "HS256"
    if mutation == "issuer":
        claims["iss"] = "other"
    elif mutation == "audience":
        claims["aud"] = "other"
    elif mutation == "expired":
        claims["exp"] = int((utcnow() - timedelta(minutes=1)).timestamp())
    elif mutation == "algorithm":
        algorithm = "HS384"
    elif mutation == "version":
        claims["ver"] += 1
    elif mutation == "legacy":
        claims["org"] = str(uuid.uuid4())
    elif mutation == "missing":
        del claims["identity_version"]
    invalid = jwt.encode(claims, settings.signing_key, algorithm=algorithm)
    result = upload(env["api"], {"Authorization": f"Bearer {invalid}"}, env["patient"].id)
    assert result.status_code == 401
    assert env["storage"].calls == []


def test_object_written_then_adapter_failure_is_recoverable(files_env, monkeypatch):
    env = files_env
    clean_scanner(monkeypatch)
    original_put = env["storage"].put
    def partial_put(key, stream, media):
        original_put(key, stream, media)
        raise OSError("credential-bearing-provider-url-must-not-be-logged")
    monkeypatch.setattr(env["storage"], "put", partial_put)
    result = upload(env["api"], env["auth"](env["owner"]), env["patient"].id)
    assert result.status_code == 503
    file_id = uuid.UUID(result.headers["X-File-ID"])
    with Session(env["engine"]) as db:
        row = db.get(FileRecord, file_id)
        assert row.state == "pending_delete"
        assert env["storage"].exists(row.object_key)
    assert "provider-url" not in result.text
    cleanup = env["api"].post(f"/api/v1/files/{file_id}/reconcile", headers=env["auth"](env["admin"]))
    assert cleanup.status_code == 200
    assert cleanup.json()["state"] == "deleted"


@pytest.mark.parametrize("committed", [False, True])
def test_publication_commit_failure_never_claims_false_success(files_env, monkeypatch, committed):
    env = files_env
    clean_scanner(monkeypatch)
    original_commit = Session.commit
    failed = False
    def commit(self):
        nonlocal failed
        publishing = any(isinstance(row, FileRecord) and row.state == "verified" for row in self.dirty)
        if publishing and not failed:
            failed = True
            if committed:
                original_commit(self)
            raise OSError("sensitive-database-parameters")
        return original_commit(self)
    monkeypatch.setattr(Session, "commit", commit)
    result = upload(env["api"], env["auth"](env["owner"]), env["patient"].id)
    assert failed
    assert result.status_code == 500
    assert "database-parameters" not in result.text
    file_id = uuid.UUID(result.headers["X-File-ID"])
    with Session(env["engine"]) as db:
        row = db.get(FileRecord, file_id)
        assert row.state == ("verified" if committed else "pending_delete")
    # A response failure after a successful commit is explicitly resolvable by ID;
    # before commit, the object is unreadable and privileged cleanup is required.
    if committed:
        check = env["api"].get(f"/api/v1/files/{file_id}/download", headers=env["auth"](env["owner"]))
        assert check.status_code == 200 and check.content == PNG
    else:
        check = env["api"].get(f"/api/v1/files/{file_id}/download", headers=env["auth"](env["owner"]))
        assert check.status_code == 404
        cleanup = env["api"].post(f"/api/v1/files/{file_id}/reconcile", headers=env["auth"](env["admin"]))
        assert cleanup.status_code == 200


def test_super_admin_can_clean_files_of_inactive_owners(files_env, monkeypatch):
    env = files_env
    row = saved_upload(env, monkeypatch)
    with Session(env["engine"]) as db:
        db.get(Patient, env["patient"].id).is_active = False
        db.commit()
    assert env["api"].get(f"/api/v1/files/{row['id']}", headers=env["auth"](env["owner"])).status_code == 404
    assert env["api"].get(f"/api/v1/files/{row['id']}", headers=env["auth"](env["admin"])).status_code == 200
    assert env["api"].delete(f"/api/v1/files/{row['id']}", headers=env["auth"](env["admin"])).json()["state"] == "deleted"