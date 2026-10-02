"""PostgreSQL-backed integration and concurrency coverage for private files."""
import base64
import hashlib
import io
import logging
import os
import threading
from contextlib import contextmanager
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from pydantic import SecretStr

from app.core.config import get_settings
from app.core.security import access_token, token_digest, utcnow
from app.db.base import Base
from app.db.file_models import DownloadGrant, FileRecord
from app.db.models import AuditEvent, AuthSession, MRProfile, Patient, User
from app.main import app
from app.services import files as file_service
from app.services.storage import LocalStorage
from app.services.verification import verify as real_verify

# A real, complete 1x1 transparent PNG. PDF bytes are produced by pypdf below.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQAB"
    "pfZFQAAAAABJRU5ErkJggg=="
)


class StorageSpy:
    def __init__(self, wrapped):
        self.wrapped = wrapped
        self.calls = []

    def put(self, key, stream, content_type):
        self.calls.append(("put", key))
        return self.wrapped.put(key, stream, content_type)

    def get(self, key):
        self.calls.append(("get", key))
        return self.wrapped.get(key)

    def delete(self, key):
        self.calls.append(("delete", key))
        return self.wrapped.delete(key)

    def exists(self, key):
        return self.wrapped.exists(key)

    def head(self, key):
        return self.wrapped.head(key)

    def download_link(self, key, expires):
        return self.wrapped.download_link(key, expires)


@pytest.fixture
def files_env(tmp_path):
    base_settings = get_settings()
    if base_settings.app_env == "production":
        pytest.fail("File integration tests refuse APP_ENV=production")
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.fail("Set TEST_DATABASE_URL to the disposable local PostgreSQL test database")
    parsed_url = make_url(database_url)
    if not parsed_url.database or "test" not in parsed_url.database.lower():
        pytest.fail("File integration tests require a test-named disposable database")

    schema = f"file_test_{uuid.uuid4().hex}"
    settings = base_settings.model_copy(update={
        "app_env": "test",
        "storage_backend": "local",
        "local_storage_root": str(tmp_path / "private"),
        "scanner_backend": "unavailable",
        "max_upload_bytes": 1024 * 1024,
        "download_grant_seconds": 120,
        "file_request_timeout_seconds": 10,
        "file_concurrency_limit": 8,
        "file_rate_limit": 1000,
    })
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    engine = create_engine(
        database_url,
        pool_size=12,
        max_overflow=12,
        connect_args={"options": f"-csearch_path={schema}"},
    )
    try:
        with engine.begin() as connection:
            directory = connection.scalar(text("SHOW data_directory"))
            if not (
                directory.startswith("/tmp/evexia-api-test.")
                or directory.startswith("/tmp/evexia-identity-pg")
                or directory.startswith("/tmp/task144-pg.")
            ):
                pytest.fail("File integration tests require the disposable local PostgreSQL test cluster")
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        Base.metadata.create_all(engine)
    except Exception:
        engine.dispose()
        pytest.fail("Unable to initialize isolated schema on the disposable PostgreSQL test cluster")

    storage = StorageSpy(LocalStorage(settings))
    db = Session(engine, expire_on_commit=False)

    def seed_user(email, role):
        if role == "super_admin":
            from app.bootstrap import bootstrap_super_admin

            result = bootstrap_super_admin(db, SecretStr("synthetic-test-bootstrap-password"))
            return db.get(User, result.user_id), None
        user = User(
            email=f"{uuid.uuid4().hex}-{email}@example.test",
            password_hash="test-only-not-a-login-hash",
            system_role=role,
            identity_version=1,
        )
        db.add(user)
        db.flush()
        profile = None
        if role == "mr":
            profile = MRProfile(user_id=user.id, is_active=True)
            db.add(profile)
            db.flush()
        db.commit()
        return user, profile

    admin, _ = seed_user("admin", "super_admin")
    owner, owner_mr = seed_user("owner", "mr")
    outsider, outsider_mr = seed_user("outsider", "mr")
    replacement_owner, replacement_mr = seed_user("replacement", "mr")
    patient = Patient(assigned_mr_id=owner_mr.id, is_active=True, version=1)
    db.add(patient)
    db.commit()

    def create_auth_session(user):
        now = utcnow()
        session = AuthSession(
            user_id=user.id,
            family_id=uuid.uuid4(),
            status="ACTIVE",
            token_version=user.token_version,
            identity_version=user.identity_version,
            persistent=False,
            created_at=now,
            expires_at=now + timedelta(hours=settings.session_refresh_hours),
        )
        db.add(session)
        db.flush()
        return session

    auth_sessions = {
        user.id: create_auth_session(user)
        for user in (admin, owner, outsider, replacement_owner)
    }
    db.commit()

    def make_token(user):
        session = auth_sessions[user.id]
        return access_token(
            user.id, user.token_version, user.identity_version, settings, session_id=session.id,
        )

    def db_override():
        with Session(engine, expire_on_commit=False) as request_db:
            yield request_db

    app.dependency_overrides.clear()
    from app.api.v1.files import storage_dependency
    from app.db.session import get_db

    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[storage_dependency] = lambda: lambda: storage
    try:
        with TestClient(app, base_url="http://testserver") as client:
            yield {
                "api": client,
                "db": db,
                "engine": engine,
                "settings": settings,
                "storage": storage,
                "admin": admin,
                "owner": owner,
                "owner_mr": owner_mr,
                "outsider": outsider,
                "outsider_mr": outsider_mr,
                "replacement_owner": replacement_owner,
                "replacement_mr": replacement_mr,
                "patient": patient,
                "auth": lambda user: {"Authorization": f"Bearer {make_token(user)}"},
            }
    finally:
        app.dependency_overrides.clear()
        db.close()
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        engine.dispose()


def pdf_bytes():
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    data = io.BytesIO()
    writer.write(data)
    return data.getvalue()


def clean_scanner(monkeypatch):
    class Clean:
        def scan(self, content, settings):
            assert content
            return "clean"

    def verify_with_injected_scanner(stream, filename, content_type, settings):
        return real_verify(stream, filename, content_type, settings, scanner=Clean())

    monkeypatch.setattr(file_service, "verify", verify_with_injected_scanner)


def scanner_result(monkeypatch, status):
    class Scanner:
        def scan(self, content, settings):
            assert content
            return status

    def verify_with_injected_scanner(stream, filename, content_type, settings):
        return real_verify(stream, filename, content_type, settings, scanner=Scanner())

    monkeypatch.setattr(file_service, "verify", verify_with_injected_scanner)


def upload(api, token_headers, patient_id, *, name="scan.png", body=PNG, media="image/png"):
    return api.post(
        "/api/v1/files",
        params={"patient_id": str(patient_id), "category": "documents", "filename": name},
        headers={**token_headers, "Content-Type": media},
        content=body,
    )


def saved_upload(env, monkeypatch, *, filename="original.png", data=PNG):
    clean_scanner(monkeypatch)
    response = upload(
        env["api"], env["auth"](env["owner"]), env["patient"].id,
        name=filename, body=data, media="image/png",
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_file_authorization_owner_outsider_and_superadmin_lifecycle(files_env, monkeypatch):
    env = files_env
    api = env["api"]
    row = saved_upload(env, monkeypatch)
    file_id = row["id"]
    key = next(key for operation, key in env["storage"].calls if operation == "put")
    assert row["state"] == "verified"
    assert row["patient_id"] == str(env["patient"].id)
    assert row["checksum"] == hashlib.sha256(PNG).hexdigest()
    assert "object_key" not in row and "uploader_id" not in row

    owner_headers = env["auth"](env["owner"])
    outsider_headers = env["auth"](env["outsider"])
    admin_headers = env["auth"](env["admin"])
    assert api.get(f"/api/v1/files/{file_id}", headers=owner_headers).status_code == 200
    own_download = api.get(f"/api/v1/files/{file_id}/download", headers=owner_headers)
    assert own_download.status_code == 200
    assert own_download.content == PNG
    assert own_download.headers["content-disposition"] == f'attachment; filename="{file_id}.png"'

    calls_before = list(env["storage"].calls)
    for path, method in (
        (f"/api/v1/files/{file_id}", "get"),
        (f"/api/v1/files/{file_id}/download", "get"),
        (f"/api/v1/files/{file_id}/download-url", "post"),
        (f"/api/v1/files/{file_id}", "delete"),
        (f"/api/v1/files/{file_id}/reconcile", "post"),
        (f"/api/v1/files/{file_id}/replacement", "post"),
    ):
        params = {"filename": "next.png", "expected_version": row["version"]} if path.endswith("replacement") else None
        request_kwargs = {"headers": outsider_headers}
        if params:
            request_kwargs.update(params=params, content=PNG)
        response = api.request(method.upper(), path, **request_kwargs)
        expected_status = 403 if method == "delete" or path.endswith(("reconcile", "replacement")) else 404
        assert response.status_code == expected_status, response.text
    assert env["storage"].calls == calls_before

    # Admin can reconcile a quarantined object; scanner injection wraps real parser
    # verification and is limited to this test's explicit recovery action.
    clean_scanner(monkeypatch)
    # Make this record unavailable to readers while retaining its verified bytes.
    with Session(env["engine"]) as db:
        record = db.get(FileRecord, uuid.UUID(file_id))
        record.state, record.scanner_status = "quarantined", "unavailable"
        record.version += 1
        db.commit()
    reconciled = api.post(f"/api/v1/files/{file_id}/reconcile", headers=admin_headers)
    assert reconciled.status_code == 200, reconciled.text
    assert reconciled.json()["state"] == "verified"
    replaced = api.post(
        f"/api/v1/files/{file_id}/replacement",
        params={"filename": "next.png", "expected_version": reconciled.json()["version"]},
        headers={**admin_headers, "Content-Type": "image/png"},
        content=PNG,
    )
    assert replaced.status_code == 201, replaced.text
    assert replaced.json()["state"] == "verified"
    with Session(env["engine"]) as db:
        original = db.get(FileRecord, uuid.UUID(file_id))
        assert original.state == "deleted"
    deleted = api.delete(f"/api/v1/files/{replaced.json()['id']}", headers=admin_headers)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["state"] == "deleted"
    assert not env["storage"].exists(key)


def test_mr_owner_scope_and_denied_adapter_calls(files_env, monkeypatch):
    env = files_env
    clean_scanner(monkeypatch)
    mr_file = env["api"].post(
        "/api/v1/files",
        params={"mr_id": str(env["owner_mr"].id), "category": "profile", "filename": "profile.png"},
        headers={**env["auth"](env["owner"]), "Content-Type": "image/png"},
        content=PNG,
    )
    assert mr_file.status_code == 201, mr_file.text
    file_id = mr_file.json()["id"]
    assert env["api"].get(f"/api/v1/files/{file_id}", headers=env["auth"](env["owner"])).status_code == 200
    calls_before = list(env["storage"].calls)
    for path in (f"/api/v1/files/{file_id}/download", f"/api/v1/files/{file_id}/download-url"):
        response = env["api"].get(path, headers=env["auth"](env["outsider"])) if path.endswith("download") else env["api"].post(path, headers=env["auth"](env["outsider"]))
        assert response.status_code == 404
    assert env["storage"].calls == calls_before
    denied = env["api"].delete(f"/api/v1/files/{file_id}", headers=env["auth"](env["owner"]))
    assert denied.status_code == 403
    assert env["storage"].calls == calls_before


def test_raw_pdf_upload_quarantine_and_real_png_validation(files_env):
    env = files_env
    pdf = pdf_bytes()
    assert pdf.startswith(b"%PDF-")
    response = upload(
        env["api"], env["auth"](env["owner"]), env["patient"].id,
        name="record.pdf", body=pdf, media="application/pdf",
    )
    assert response.status_code == 201, response.text
    assert response.json()["state"] == "quarantined"
    assert response.json()["scanner_status"] == "unavailable"
    assert env["api"].get(
        f"/api/v1/files/{response.json()['id']}/download", headers=env["auth"](env["owner"]),
    ).status_code == 409

    calls_before_invalid = list(env["storage"].calls)
    malformed = upload(
        env["api"], env["auth"](env["owner"]), env["patient"].id,
        name="bad.png", body=b"\x89PNG\r\n\x1a\nnot-an-image",
    )
    assert malformed.status_code == 415, malformed.text
    assert malformed.json()["error"]["code"] == "invalid_file"
    assert env["storage"].calls == calls_before_invalid


def test_infected_and_scanner_error_outcomes_fail_closed_and_reconcile(files_env, monkeypatch):
    env = files_env
    scanner_result(monkeypatch, "infected")
    infected = upload(env["api"], env["auth"](env["owner"]), env["patient"].id, name="infected.png")
    assert infected.status_code == 201, infected.text
    infected_row = infected.json()
    assert infected_row["state"] == "rejected"
    assert infected_row["scanner_status"] == "infected"
    assert env["api"].get(
        f"/api/v1/files/{infected_row['id']}/download", headers=env["auth"](env["owner"]),
    ).status_code == 404
    removed = env["api"].post(
        f"/api/v1/files/{infected_row['id']}/reconcile", headers=env["auth"](env["admin"]),
    )
    assert removed.status_code == 200, removed.text
    assert removed.json()["state"] == "deleted"

    scanner_result(monkeypatch, "error")
    unavailable = upload(env["api"], env["auth"](env["owner"]), env["patient"].id, name="scanner-error.png")
    assert unavailable.status_code == 201, unavailable.text
    unavailable_row = unavailable.json()
    assert unavailable_row["state"] == "quarantined"
    assert unavailable_row["scanner_status"] == "error"
    assert env["api"].get(
        f"/api/v1/files/{unavailable_row['id']}/download", headers=env["auth"](env["owner"]),
    ).status_code == 409

    clean_scanner(monkeypatch)
    verified = env["api"].post(
        f"/api/v1/files/{unavailable_row['id']}/reconcile", headers=env["auth"](env["admin"]),
    )
    assert verified.status_code == 200, verified.text
    assert verified.json()["state"] == "verified"
    assert verified.json()["scanner_status"] == "clean"


def test_actual_stream_limit_and_unsafe_filename_rejections(files_env):
    env = files_env
    # Raise the route-side limit only via its injected settings and send a truly
    # chunked stream without Content-Length so Request.stream() enforces the cap.
    env["settings"].max_upload_bytes = 64
    stream = iter([b"A" * 40, b"B" * 40])
    response = env["api"].post(
        "/api/v1/files",
        params={"patient_id": str(env["patient"].id), "category": "documents", "filename": "large.pdf"},
        headers={**env["auth"](env["owner"]), "Content-Type": "application/pdf"},
        content=stream,
    )
    assert response.status_code == 413, response.text
    assert response.json()["error"]["code"] == "file_too_large"
    file_id = response.headers.get("X-File-ID")
    assert file_id and str(uuid.UUID(file_id)) == file_id
    with Session(env["engine"]) as db:
        assert db.get(FileRecord, uuid.UUID(file_id)).state == "pending_delete"
    assert not any(action == "put" for action, _ in env["storage"].calls)

    invalid_name = upload(
        env["api"], env["auth"](env["owner"]), env["patient"].id,
        name="../private.png",
    )
    assert invalid_name.status_code == 415
    assert not any(action == "put" for action, _ in env["storage"].calls)


def test_quota_rejection_happens_before_reservation_or_adapter_call(files_env):
    env = files_env
    env["settings"].file_rate_limit = 1
    first = upload(env["api"], env["auth"](env["owner"]), env["patient"].id)
    assert first.status_code == 201, first.text
    assert first.json()["state"] == "quarantined"
    calls = list(env["storage"].calls)
    with Session(env["engine"]) as db:
        count_before = len(list(db.scalars(select(FileRecord.id))))

    limited = upload(env["api"], env["auth"](env["owner"]), env["patient"].id, name="second.png")
    assert limited.status_code == 429, limited.text
    assert limited.json()["error"]["code"] == "file_rate_limit"
    assert "X-File-ID" not in limited.headers
    assert env["storage"].calls == calls
    with Session(env["engine"]) as db:
        assert len(list(db.scalars(select(FileRecord.id)))) == count_before


def test_grants_bind_identity_expiry_and_current_patient_assignment(files_env, monkeypatch):
    env = files_env
    row = saved_upload(env, monkeypatch)
    url = env["api"].post(
        f"/api/v1/files/{row['id']}/download-url", headers=env["auth"](env["owner"]),
    )
    assert url.status_code == 200, url.text
    token = url.json()["url"].rsplit("/", 1)[-1]
    assert env["api"].get(f"/api/v1/files/grants/{token}", headers=env["auth"](env["outsider"])).status_code == 404

    with Session(env["engine"]) as db:
        grant = db.get(DownloadGrant, token_digest(token))
        grant.expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    assert env["api"].get(f"/api/v1/files/grants/{token}", headers=env["auth"](env["owner"])).status_code == 404

    fresh = env["api"].post(
        f"/api/v1/files/{row['id']}/download-url", headers=env["auth"](env["owner"]),
    ).json()["url"].rsplit("/", 1)[-1]
    with Session(env["engine"]) as db:
        patient = db.get(Patient, env["patient"].id)
        patient.assigned_mr_id = env["replacement_mr"].id
        patient.version += 1
        db.commit()
    denied = env["api"].get(f"/api/v1/files/grants/{fresh}", headers=env["auth"](env["owner"]))
    assert denied.status_code == 404


def test_patient_can_be_reassigned_from_inactive_former_mr_without_moving_file(files_env, monkeypatch):
    env = files_env
    row = saved_upload(env, monkeypatch)
    file_id = uuid.UUID(row["id"])
    with Session(env["engine"]) as db:
        object_key = db.get(FileRecord, file_id).object_key
        former_profile = db.get(MRProfile, env["owner_mr"].id)
        former_profile.is_active = False
        db.commit()

    reassigned = env["api"].post(
        f"/api/v1/domain/patients/{env['patient'].id}/assignment",
        headers=env["auth"](env["admin"]),
        json={"assigned_mr_id": str(env["replacement_mr"].id)},
    )
    assert reassigned.status_code == 200, reassigned.text
    assert reassigned.json()["assigned_mr_id"] == str(env["replacement_mr"].id)

    with Session(env["engine"]) as db:
        assert db.get(FileRecord, file_id).object_key == object_key
    assert env["api"].get(
        f"/api/v1/files/{file_id}", headers=env["auth"](env["replacement_owner"]),
    ).status_code == 200
    assert env["api"].get(
        f"/api/v1/files/{file_id}", headers=env["auth"](env["owner"]),
    ).status_code == 401
    assert env["api"].get(
        f"/api/v1/files/{file_id}", headers=env["auth"](env["admin"]),
    ).status_code == 200


def test_patient_reassignment_during_object_put_never_publishes_to_old_owner(files_env, monkeypatch):
    env = files_env
    clean_scanner(monkeypatch)
    entered, release = threading.Event(), threading.Event()
    original_put = env["storage"].put

    def blocked_put(key, stream, content_type):
        entered.set()
        assert release.wait(timeout=5)
        return original_put(key, stream, content_type)

    monkeypatch.setattr(env["storage"], "put", blocked_put)
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(upload, env["api"], env["auth"](env["owner"]), env["patient"].id)
        assert entered.wait(timeout=5)
        with Session(env["engine"]) as admin_db:
            patient = admin_db.get(Patient, env["patient"].id)
            patient.assigned_mr_id = env["replacement_mr"].id
            patient.version += 1
            admin_db.commit()
        release.set()
        response = pending.result(timeout=10)
    assert response.status_code == 404, response.text
    # Reservation remains discoverable and unpublishable; key/object stays private
    # for retryable cleanup, never readable by the former owner.
    with Session(env["engine"]) as db:
        records = list(db.scalars(select(FileRecord).where(FileRecord.patient_id == env["patient"].id)))
        assert len(records) == 1
        assert records[0].state == "pending_delete"
        assert env["storage"].exists(records[0].object_key)
    assert env["api"].get(f"/api/v1/files/{records[0].id}", headers=env["auth"](env["owner"])).status_code == 404


def test_delete_waits_for_active_upload_lease_and_cleans_object(files_env, monkeypatch):
    env = files_env
    clean_scanner(monkeypatch)
    entered, release = threading.Event(), threading.Event()
    delete_checked_lock = threading.Event()
    original_put = env["storage"].put
    from app.api.v1 import files as files_api
    original_operation = files_api.operation
    calls_by_file = {}
    calls_lock = threading.Lock()

    @contextmanager
    def monitored_operation(db, settings, file_id):
        with calls_lock:
            calls_by_file[file_id] = calls_by_file.get(file_id, 0) + 1
            call_number = calls_by_file[file_id]
        lease = original_operation(db, settings, file_id)
        try:
            lease.__enter__()
        except BaseException:
            if call_number > 1:
                delete_checked_lock.set()
            raise
        if call_number > 1:
            delete_checked_lock.set()
        try:
            yield
        finally:
            lease.__exit__(None, None, None)

    def blocked_put(key, stream, content_type):
        entered.set()
        assert release.wait(timeout=5)
        return original_put(key, stream, content_type)

    monkeypatch.setattr(env["storage"], "put", blocked_put)
    monkeypatch.setattr(files_api, "operation", monitored_operation)
    with ThreadPoolExecutor(max_workers=2) as pool:
        uploader = pool.submit(upload, env["api"], env["auth"](env["owner"]), env["patient"].id)
        assert entered.wait(timeout=5)
        with Session(env["engine"]) as db:
            reserved = db.scalar(select(FileRecord).where(FileRecord.state == "uploading"))
            assert reserved is not None
            deleting = pool.submit(
                env["api"].delete, f"/api/v1/files/{reserved.id}",
                headers=env["auth"](env["admin"]),
            )
        assert delete_checked_lock.wait(timeout=5)
        busy = deleting.result(timeout=5)
        assert busy.status_code == 409, busy.text
        assert busy.json()["error"]["code"] == "operation_busy"
        release.set()
        uploaded = uploader.result(timeout=10)
    assert uploaded.status_code == 201, uploaded.text
    deleted = env["api"].delete(f"/api/v1/files/{reserved.id}", headers=env["auth"](env["admin"]))
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["state"] == "deleted"
    assert not env["storage"].exists(reserved.object_key)


def test_cleanup_failure_remains_pending_and_admin_reconcile_retries(files_env, monkeypatch):
    env = files_env
    row = saved_upload(env, monkeypatch)
    original_delete = env["storage"].delete

    def fail_delete(key):
        raise OSError("sensitive provider details must not escape")

    monkeypatch.setattr(env["storage"], "delete", fail_delete)
    response = env["api"].delete(
        f"/api/v1/files/{row['id']}", headers=env["auth"](env["admin"]),
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "delete_pending"
    assert "sensitive provider" not in response.text
    with Session(env["engine"]) as db:
        assert db.get(FileRecord, uuid.UUID(row["id"])).state == "pending_delete"
    monkeypatch.setattr(env["storage"], "delete", original_delete)
    recovered = env["api"].post(
        f"/api/v1/files/{row['id']}/reconcile", headers=env["auth"](env["admin"]),
    )
    assert recovered.status_code == 200, recovered.text
    assert recovered.json()["state"] == "deleted"


def test_concurrent_replacements_publish_only_one_version(files_env, monkeypatch):
    env = files_env
    initial = saved_upload(env, monkeypatch)
    clean_scanner(monkeypatch)
    both_putting, release = threading.Barrier(3), threading.Event()
    original_put = env["storage"].put

    def gated_put(key, stream, content_type):
        both_putting.wait(timeout=5)
        assert release.wait(timeout=5)
        return original_put(key, stream, content_type)

    monkeypatch.setattr(env["storage"], "put", gated_put)

    def replace():
        return env["api"].post(
            f"/api/v1/files/{initial['id']}/replacement",
            params={"filename": "replacement.png", "expected_version": initial["version"]},
            headers={**env["auth"](env["admin"]), "Content-Type": "image/png"},
            content=PNG,
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(replace)
        second = pool.submit(replace)
        try:
            both_putting.wait(timeout=8)
        except threading.BrokenBarrierError:
            pytest.fail("Concurrent replacement uploads did not both reach storage")
        release.set()
        responses = [first.result(timeout=10), second.result(timeout=10)]
    assert sorted(response.status_code for response in responses) == [201, 404]
    with Session(env["engine"]) as db:
        old = db.get(FileRecord, uuid.UUID(initial["id"]))
        replacements = list(db.scalars(select(FileRecord).where(FileRecord.replaces_id == old.id)))
        assert old.state == "deleted"
        assert len(replacements) == 2
        assert sum(item.state == "verified" for item in replacements) == 1
        assert all(item.state in ("verified", "pending_delete") for item in replacements)


def test_file_constraints_exclusive_owner_verified_scanner_and_foreign_keys(files_env):
    env = files_env
    common = dict(
        id=uuid.uuid4(), category="documents",
        object_key=f"patients/{env['patient'].id}/documents/{uuid.uuid4()}.png",
        display_name="constraint.png", content_type="image/png", uploader_id=env["owner"].id,
        state="uploading", scanner_status="pending", version=1,
    )
    cases = [
        {**common, "patient_id": env["patient"].id, "mr_id": env["owner_mr"].id},
        {**common, "id": uuid.uuid4(), "patient_id": None, "mr_id": None,
         "object_key": f"mrs/{env['owner_mr'].id}/documents/{uuid.uuid4()}.png"},
        {**common, "id": uuid.uuid4(), "patient_id": env["patient"].id, "mr_id": None,
         "object_key": f"patients/{env['patient'].id}/documents/{uuid.uuid4()}.png",
         "state": "verified", "scanner_status": "pending", "size": len(PNG),
         "checksum": hashlib.sha256(PNG).hexdigest()},
        {**common, "id": uuid.uuid4(), "patient_id": uuid.uuid4(), "mr_id": None,
         "object_key": f"patients/{uuid.uuid4()}/documents/{uuid.uuid4()}.png"},
        {**common, "id": uuid.uuid4(), "patient_id": env["patient"].id, "mr_id": None,
         "uploader_id": uuid.uuid4(),
         "object_key": f"patients/{env['patient'].id}/documents/{uuid.uuid4()}.png"},
    ]
    for values in cases:
        db = Session(env["engine"])
        try:
            db.add(FileRecord(**values))
            with pytest.raises(IntegrityError):
                db.commit()
        finally:
            db.rollback()
            db.close()
    with Session(env["engine"]) as db:
        assert db.scalar(select(FileRecord.id)) is None


def test_response_audit_and_logs_never_contain_storage_path_or_provider_secret(files_env, monkeypatch, caplog):
    env = files_env
    caplog.set_level(logging.INFO, logger="evexia.api")
    unique_name = "private-customer-name-token.png"
    monkeypatch.setattr(
        file_service, "verify",
        lambda stream, filename, content_type, settings: real_verify(
            stream, filename, content_type, settings,
            scanner=type("Clean", (), {"scan": lambda self, content, config: "clean"})(),
        ),
    )
    response = upload(env["api"], env["auth"](env["owner"]), env["patient"].id, name=unique_name)
    assert response.status_code == 201
    body = response.json()
    assert body["display_name"] == unique_name
    assert "object_key" not in body and str(env["settings"].local_storage_root) not in response.text
    assert unique_name not in caplog.text
    assert str(env["settings"].local_storage_root) not in caplog.text
    with Session(env["engine"]) as db:
        events = list(db.scalars(select(AuditEvent).where(AuditEvent.resource_id == uuid.UUID(body["id"]))))
        assert events
        assert all(event.resource_type == "file" and event.request_id for event in events)
        assert unique_name not in " ".join(event.action for event in events)