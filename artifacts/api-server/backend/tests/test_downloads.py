"""Run only through the ephemeral PostgreSQL API harness."""
import uuid
from datetime import timedelta
import pytest
from sqlalchemy import func, select, text
from app.core.security import utcnow
from app.db.download_models import DownloadLog
from app.services.downloads import BROWSER
from test_sessions import client, create_user, login
from test_reporting import admin_headers

BASE = "/api/v1/admin/reporting/downloads"


def initiation(source="patient", kind="export", format="CSV", **extra):
    return dict(initiation_id=str(uuid.uuid4()), source=source, kind=kind, format=format, **extra)


def setup(api, db):
    headers, user = admin_headers(api, db)
    headers["Origin"] = "http://testserver"
    return headers, user


def test_all_browser_combinations_durable_safe_and_newest_paginated(client):
    api, db, _ = client
    headers, user = setup(api, db)
    before = utcnow() - timedelta(seconds=2)
    count = 0
    for source, kinds in BROWSER.items():
        for kind, formats in kinds.items():
            for format in formats:
                body = initiation(source, kind, format)
                response = api.post(f"{BASE}/initiate", json=body, headers=headers)
                assert response.status_code == 200, response.text
                assert response.json()["provenance"] == "browser_reported"
                assert api.post(f"{BASE}/initiate", json=body, headers=headers).json() == response.json()
                count += 1
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(DownloadLog)) == count
    ids = []
    for offset in range(0, count, 7):
        body = api.get(BASE, headers=headers, params={"limit": 7, "offset": offset}).json()
        assert body["total"] == count and body["offset"] == offset
        ids.extend(r["id"] for r in body["items"])
        for row in body["items"]:
            assert row["user"]["id"] == str(user.id)
            assert set(row) == {"id", "user", "created_at", "label", "module", "format", "provenance"}
            assert before <= db.get(DownloadLog, uuid.UUID(row["id"])).created_at <= utcnow()
    assert len(ids) == len(set(ids)) == count
    assert api.get(BASE, headers=headers, params={"offset": count + 10}).json()["total"] == count
    for format in ("PDF", "CSV", "XLSX"):
        result = api.get(BASE, headers=headers, params={"format": format, "limit": 100}).json()
        assert result["items"] and all(r["format"] == format for r in result["items"])
        assert result["total"] == len(result["items"])
    result = api.get(BASE, headers=headers, params={"q": "Patient Master", "user_id": str(user.id)}).json()
    assert result["total"] == 2
    assert api.get(BASE, headers=headers, params={"q": "%_"}).json()["total"] == 0
    assert api.get(BASE, headers=headers, params={"start": (utcnow() + timedelta(days=1)).isoformat()}).json()["total"] == 0
    # Logout does not delete ledger history; a fresh authenticated session sees it.
    api.post("/api/v1/auth/logout", headers=headers)
    assert api.get(BASE, headers=headers).status_code == 401
    fresh = login(api, user.email)
    new_headers = {"Authorization": f"Bearer {fresh.json()['access_token']}"}
    assert api.get(BASE, headers=new_headers).json()["total"] == count


@pytest.mark.parametrize("extra", [
    {"actor_id": str(uuid.uuid4())}, {"session_id": "forged"}, {"created_at": "2030-01-01T00:00:00Z"},
    {"filename": "private-patient-name.pdf"}, {"record": {"patient": "SECRET"}},
    {"url": "https://example.test/signed?token=SECRET"}, {"source": "arbitrary"},
    {"format": "XLS"}, {"kind": "file_values"}, {"source": "private_attachment", "kind": "attachment", "format": "PDF"},
])
def test_rejects_forged_metadata_and_never_logs_failed_ingestion(client, extra):
    api, db, _ = client
    headers, _ = setup(api, db)
    body = initiation()
    body.update(extra)
    assert api.post(f"{BASE}/initiate", headers=headers, json=body).status_code == 422
    assert db.scalar(select(func.count()).select_from(DownloadLog)) == 0


def test_authorization_origin_filters_retry_conflict_and_deliberate_repeat(client):
    api, db, _ = client
    assert api.get(BASE).status_code == 401
    mr = create_user(db, "downloadmr@example.com")
    token = login(api, mr.email).json()["access_token"]
    assert api.get(BASE, headers={"Authorization": f"Bearer {token}"}).status_code == 403
    headers, _ = setup(api, db)
    assert api.post(f"{BASE}/initiate", headers={**headers, "Origin": "https://invalid.test"}, json=initiation()).status_code == 403
    body = initiation()
    assert api.post(f"{BASE}/initiate", headers=headers, json=body).status_code == 200
    body["source"] = "doctor"
    assert api.post(f"{BASE}/initiate", headers=headers, json=body).status_code == 409
    assert api.post(f"{BASE}/initiate", headers=headers, json=initiation()).status_code == 200
    assert api.get(BASE, headers=headers).json()["total"] == 2
    for params in ({"start": "2030-01-01"}, {"start": "2031-01-01T00:00:00Z", "end": "2030-01-01T00:00:00Z"},
                   {"limit": 101}, {"offset": -1}, {"format": "xls"}, {"q": "x" * 101}):
        assert api.get(BASE, headers=headers, params=params).status_code == 422
    # Replacement rejects old session and pending ingestion; history remains.
    login(api, "crm-admin@allergyevexia.in")
    assert api.post(f"{BASE}/initiate", headers=headers, json=initiation()).status_code == 401


@pytest.mark.parametrize("resource,source", [("zones", "zone"), ("courier-partners", "courier"),
                                           ("storage-locations", "storage_location")])
@pytest.mark.parametrize("format", ["csv", "xlsx"])
def test_server_exports_record_once_before_release_and_failure_closed(client, monkeypatch, resource, source, format):
    api, db, _ = client
    headers, _ = setup(api, db)
    headers["X-Download-Initiation"] = str(uuid.uuid4())
    url = f"/api/v1/admin/{resource}/export?format={format}"
    response = api.get(url, headers=headers)
    assert response.status_code == 200, response.text
    assert response.headers["x-download-log"]
    assert api.get(url, headers=headers).headers["x-download-log"] == response.headers["x-download-log"]
    row = db.scalar(select(DownloadLog))
    assert (row.source, row.format, row.provenance) == (source, format.upper(), "server_prepared")
    assert api.get(BASE, headers=headers).json()["total"] == 1
    headers["X-Download-Initiation"] = str(uuid.uuid4())
    assert api.get(url, headers=headers).status_code == 200
    assert api.get(BASE, headers=headers).json()["total"] == 2
    from app.api.v1 import zones, couriers, locations
    module = {"zones": zones, "courier-partners": couriers, "storage-locations": locations}[resource]
    def unavailable(*args, **kwargs):
        from fastapi import HTTPException
        raise HTTPException(503, "Download logging unavailable. Retry.")
    monkeypatch.setattr(module, "server_record", unavailable)
    failed = api.get(url, headers=headers)
    assert failed.status_code == 503 and "content-disposition" not in failed.headers
    assert api.get(BASE, headers=headers).json()["total"] == 2


def test_append_only_and_rate_limit_including_retry_exemption(client):
    api, db, _ = client
    headers, _ = setup(api, db)
    first = initiation()
    for i in range(120):
        assert api.post(f"{BASE}/initiate", headers=headers, json=first if i == 0 else initiation()).status_code == 200
    assert api.post(f"{BASE}/initiate", headers=headers, json=first).status_code == 200
    assert api.post(f"{BASE}/initiate", headers=headers, json=initiation()).status_code == 429
    with db.begin_nested():
        with pytest.raises(Exception):
            db.execute(text("DELETE FROM download_logs"))
        db.rollback()
