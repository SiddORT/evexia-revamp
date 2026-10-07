"""Private PDF ledger integration using isolated synthetic storage/database."""
import uuid
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.core.config import get_settings
from app.main import app
from app.db.download_models import DownloadLog
from app.api.v1 import files
from test_files import files_env, clean_scanner, pdf_bytes, upload


def test_pdf_direct_and_grant_redemption_persist_without_private_references(files_env, monkeypatch):
    env = files_env
    clean_scanner(monkeypatch)
    headers = env["auth"](env["owner"])
    response = upload(env["api"], headers, env["patient"].id, name="Sensitive-Person-Document.pdf",
                      body=pdf_bytes(), media="application/pdf")
    assert response.status_code == 201 and response.json()["state"] == "verified"
    file_id = response.json()["id"]
    headers["X-Download-Initiation"] = str(uuid.uuid4())
    path = f"/api/v1/files/{file_id}/download"
    first = env["api"].get(path, headers=headers)
    assert first.status_code == 200 and first.content.startswith(b"%PDF-")
    assert env["api"].get(path, headers=headers).headers["x-download-log"] == first.headers["x-download-log"]
    # Query another committed connection, not the request session.
    with Session(env["engine"]) as db:
        row = db.scalar(select(DownloadLog))
        assert row.actor_id == env["owner"].id and row.source == "private_attachment"
        assert row.format == "PDF" and row.provenance == "server_prepared"
        assert not hasattr(row, "file_id") and not hasattr(row, "filename")
        assert db.scalar(select(func.count()).select_from(DownloadLog)) == 1
    grant = env["api"].post(f"/api/v1/files/{file_id}/download-url", headers=headers)
    assert grant.status_code == 200
    # Local grant creation is not a delivered file or a second initiation.
    with Session(env["engine"]) as db:
        assert db.scalar(select(func.count()).select_from(DownloadLog)) == 1
    headers["X-Download-Initiation"] = str(uuid.uuid4())
    redemption = env["api"].get(grant.json()["url"], headers=headers)
    assert redemption.status_code == 200
    assert env["api"].get(grant.json()["url"], headers=headers).headers["x-download-log"] == redemption.headers["x-download-log"]
    # Global history is still Super Admin only, even for an authorized MR download actor.
    history = env["api"].get("/api/v1/admin/reporting/downloads", headers=env["auth"](env["admin"])).json()
    assert history["total"] == 2
    assert all(r["label"] == "Private PDF attachment" for r in history["items"])
    assert "Sensitive" not in str(history) and file_id not in str(history) and grant.json()["url"] not in str(history)
    assert env["api"].get("/api/v1/admin/reporting/downloads", headers=env["auth"](env["owner"])).status_code == 403
    assert env["api"].get(path, headers=env["auth"](env["outsider"])).status_code == 404
    with Session(env["engine"]) as db:
        assert db.scalar(select(func.count()).select_from(DownloadLog)) == 2


def test_pdf_logging_failure_closes_spool_without_response_release(files_env, monkeypatch):
    env = files_env
    clean_scanner(monkeypatch)
    headers = env["auth"](env["owner"])
    created = upload(env["api"], headers, env["patient"].id, name="Document.pdf",
                     body=pdf_bytes(), media="application/pdf").json()
    prepared = []
    real_prepare = files.service.prepare_download
    def prepare(*args):
        result = real_prepare(*args)
        prepared.append(result[0])
        return result
    def fail(*args):
        raise HTTPException(503, "Download logging unavailable. Retry.")
    monkeypatch.setattr(files.service, "prepare_download", prepare)
    monkeypatch.setattr(files, "server_record", fail)
    response = env["api"].get(f"/api/v1/files/{created['id']}/download", headers=headers)
    assert response.status_code == 503 and "content-disposition" not in response.headers
    assert prepared and prepared[0].closed
    with Session(env["engine"]) as db:
        assert db.scalar(select(func.count()).select_from(DownloadLog)) == 0


def test_s3_pdf_issuance_is_logged_before_url_release_without_logging_capability(files_env, monkeypatch):
    env = files_env
    clean_scanner(monkeypatch)
    headers = env["auth"](env["owner"])
    created = upload(env["api"], headers, env["patient"].id, name="Private.pdf",
                     body=pdf_bytes(), media="application/pdf").json()
    settings = env["settings"].model_copy(update={"storage_backend": "s3"})
    app.dependency_overrides[get_settings] = lambda: settings
    capability = "https://synthetic.example.test/private?credential=NEVER_LOG"
    monkeypatch.setattr(env["storage"], "download_link", lambda *args: capability)
    headers["X-Download-Initiation"] = str(uuid.uuid4())
    response = env["api"].post(f"/api/v1/files/{created['id']}/download-url", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["url"] == capability and response.json()["bearer_capability"] is True
    evidence = response.json()["download_log"]
    assert evidence["provenance"] == "server_prepared"
    assert env["api"].post(f"/api/v1/files/{created['id']}/download-url", headers=headers).json()["download_log"] == evidence
    history = env["api"].get("/api/v1/admin/reporting/downloads", headers=env["auth"](env["admin"])).json()
    assert history["total"] == 1 and history["items"][0]["label"] == "Private PDF issuance"
    assert "NEVER_LOG" not in str(history)


def test_acknowledged_pdf_preparation_remains_when_stream_later_fails(files_env, monkeypatch):
    import pytest
    from app.services.auth import Identity
    from app.db.models import AuthSession, MRProfile
    env = files_env
    clean_scanner(monkeypatch)
    headers = env["auth"](env["owner"])
    created = upload(env["api"], headers, env["patient"].id, name="Private.pdf",
                     body=pdf_bytes(), media="application/pdf").json()
    real_prepare = files.service.prepare_download
    spools = []
    class BrokenStream:
        def __init__(self, spool):
            self.spool = spool
            self.closed = False
        def read(self, *args):
            raise IOError("synthetic stream failure")
        def close(self):
            self.closed = True
            self.spool.close()
    def prepare(*args):
        spool, media, size = real_prepare(*args)
        wrapper = BrokenStream(spool)
        spools.append(wrapper)
        return wrapper, media, size
    monkeypatch.setattr(files.service, "prepare_download", prepare)
    with Session(env["engine"]) as db:
        user = db.get(type(env["owner"]), env["owner"].id)
        session = db.scalar(select(AuthSession).where(AuthSession.user_id == user.id))
        identity = Identity(user, db.get(MRProfile, env["owner_mr"].id), session_id=session.id)
        response = files.stream_download(db, identity, uuid.UUID(created["id"]), env["settings"],
                                         lambda: env["storage"], "synthetic-request", uuid.uuid4())
        assert response.headers["x-download-log"]
        assert db.scalar(select(func.count()).select_from(DownloadLog)) == 1
        import asyncio
        async def consume():
            async for _ in response.body_iterator:
                pass
        with pytest.raises(IOError):
            asyncio.run(consume())
        assert spools[0].closed
        assert db.scalar(select(func.count()).select_from(DownloadLog)) == 1


def test_concurrent_private_pdf_retry_creates_one_durable_row(files_env, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    env = files_env
    clean_scanner(monkeypatch)
    headers = env["auth"](env["owner"])
    created = upload(env["api"], headers, env["patient"].id, name="Private.pdf",
                     body=pdf_bytes(), media="application/pdf").json()
    headers["X-Download-Initiation"] = str(uuid.uuid4())
    path = f"/api/v1/files/{created['id']}/download"
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: env["api"].get(path, headers=headers), range(2)))
    assert all(r.status_code in (200, 409) for r in responses)
    # Keep the existing same-file transfer exclusion; a busy retry releases no file.
    for response in responses:
        if response.status_code == 409:
            assert response.json()["error"]["code"] == "operation_busy"
    accepted = [r for r in responses if r.status_code == 200]
    assert accepted
    retried = env["api"].get(path, headers=headers)
    assert retried.status_code == 200
    assert all(r.headers["x-download-log"] == retried.headers["x-download-log"] for r in accepted)
    with Session(env["engine"]) as db:
        assert db.scalar(select(func.count()).select_from(DownloadLog)) == 1


def test_concurrent_acceptance_serializes_session_bound_idempotency(files_env):
    from concurrent.futures import ThreadPoolExecutor
    from app.services.downloads import record
    from app.services.auth import Identity
    from app.db.models import AuthSession, User
    env = files_env
    initiation_id = uuid.uuid4()
    def accept(_):
        with Session(env["engine"]) as db:
            user = db.get(User, env["admin"].id)
            session = db.scalar(select(AuthSession).where(AuthSession.user_id == user.id))
            return record(db, Identity(user, session_id=session.id), initiation_id,
                          "zone", "sample", "CSV", "browser_reported")
    with ThreadPoolExecutor(max_workers=2) as pool:
        evidence = list(pool.map(accept, range(2)))
    assert evidence[0] == evidence[1]
    with Session(env["engine"]) as db:
        assert db.scalar(select(func.count()).select_from(DownloadLog)) == 1
