"""Sales Target APIs use synthetic actors and disposable PostgreSQL only."""
import csv
import io
import uuid
from decimal import Decimal
import pytest
from openpyxl import load_workbook
from sqlalchemy import func, select
from app.db.sales_target_models import SalesTarget
from app.db.mr_models import MRDirectory
from app.db.models import AuditEvent, AuthSession
from app.db.download_models import DownloadLog
from app.services import sales_targets, sales_target_transfer as transfer
from app.schemas.sales_targets import SalesTargetFields
from test_sessions import client, create_user, login
from test_reporting import admin_headers
from test_mrs import setup as mr_setup, fields as mr_fields, add as add_mr
from test_zones import workbook, replace_zip

BASE = "/api/v1/admin/sales-targets"
HEADER = ",".join(transfer.HEADERS[:8]) + "\n"


def setup(api, db):
    headers, actor, hq, zone = mr_setup(api, db)
    result = add_mr(api, headers, mr_fields(hq, zone))
    return headers, actor, result["record"], hq, zone


def fields(mr, year=2025, **changes):
    return {**dict(mrId=mr["id"], startYear=year, endYear=year + 1,
                   q1="100.25", q2="200.00", q3="300.00", q4="400.00", status="active"), **changes}


def test_generated_annual_create_edit_import_freshness_and_rejected_writes(client):
    api, db, _ = client
    headers, _, mr, _, _ = setup(api, db)
    for index, (amount, expected) in enumerate((
            ("0", "0.00"), ("0.01", "0.04"), ("999999999999.99", "3999999999999.96"))):
        row = add(api, headers, mr, year=2040 + index, **{q: amount for q in ("q1", "q2", "q3", "q4")})
        assert row["annualTotal"] == expected
        body = fields(mr, year=2040 + index, q1="0.10", q2="0.20", q3="0", q4="0.01")
        edited = api.post(f"{BASE}/{row['id']}/edit", headers=headers, json={**body, "expected_version": 1})
        assert edited.status_code == 200 and edited.json()["annualTotal"] == "0.31"
        for key in ("annual_target", "annualTotal"):
            assert api.post(BASE, headers=headers, json={**body, key: "1"}).status_code == 422
    data = (HEADER + f"{mr['employeeCode']},2050,2051,0.1,0.2,0,0.01,inactive").encode()
    report = review(api, headers, data).json()
    assert report["valid"]
    assert commit(api, headers, data, report["digest"]).json()["imported"] == 1
    listing = api.get(BASE, headers=headers, params={"startYear": 2050}).json()
    assert any(row["startYear"] == 2050 and row["annualTotal"] == "0.31" for row in listing["items"])


def add(api, headers, mr, year=2025, **changes):
    response = api.post(BASE, headers=headers, json=fields(mr, year, **changes))
    assert response.status_code == 201, response.text
    return response.json()


def review(api, headers, data, filename="targets.csv"):
    return api.post(BASE + "/import/review", headers={**headers, "Content-Type": "application/octet-stream"},
                    params={"filename": filename}, content=data)


def commit(api, headers, data, digest, filename="targets.csv", **params):
    return api.post(BASE + "/import/commit", headers={**headers, "Content-Type": "application/octet-stream"},
                    params={"filename": filename, "digest": digest, "confirm": "true", **params}, content=data)


def test_crud_exact_money_version_audit_and_soft_delete(client):
    api, db, _ = client
    headers, actor, mr, hq, zone = setup(api, db)
    row = add(api, headers, mr, q1="999999999999.99")
    assert row["q1"] == "999999999999.99" and row["annualTotal"] == "1000000000899.99"
    assert row["mrName"] == mr["name"] and row["headquarterId"] == hq and row["zoneId"] == zone
    assert row["createdBy"] == row["updatedBy"] == "Super Admin"
    assert row["createdAt"] == row["updatedAt"]
    assert api.post(BASE, headers=headers, json=fields(mr, status="inactive")).status_code == 409
    changed = api.post(f"{BASE}/{row['id']}/edit", headers=headers,
                      json={**fields(mr, 2026), "expected_version": 1})
    assert changed.status_code == 200, changed.text
    edited = changed.json()
    assert edited["version"] == 2 and edited["createdAt"] == row["createdAt"]
    for action, body in (("edit", {**fields(mr), "expected_version": 1}),
                         ("delete", {"expected_version": 1}),
                         ("status", {"expected_version": 1, "status": "inactive"})):
        response = api.post(f"{BASE}/{row['id']}/{action}", headers=headers, json=body)
        assert response.status_code == 409 and response.json()["error"]["code"] == "sales_target_stale"
    response = api.post(f"{BASE}/{row['id']}/status", headers=headers,
                        json={"expected_version": 2, "status": "inactive"})
    assert response.json()["version"] == 3
    assert api.post(BASE, headers=headers, json=fields(mr, 2026)).status_code == 409
    response = api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"expected_version": 3})
    assert response.json()["version"] == 4
    assert api.get(f"{BASE}/{row['id']}", headers=headers).status_code == 404
    assert api.get(BASE, headers=headers).json()["total"] == 0
    db.expire_all()
    saved = db.get(SalesTarget, uuid.UUID(row["id"]))
    assert saved.deleted_by == actor.id and saved.deleted_at == saved.updated_at
    event = db.scalar(select(AuditEvent).where(AuditEvent.action == "sales_target_delete"))
    assert event.actor_id == actor.id and event.session_id
    assert add(api, headers, mr, 2026)["id"] != row["id"]


def test_validation_boundaries_untrusted_fields_and_references(client):
    api, db, _ = client
    headers, _, mr, _, _ = setup(api, db)
    for key, value in (("q1", "-1"), ("q2", "1.001"), ("q3", "1e2"), ("q4", "1000000000000"),
                       ("q1", 1.25), ("q1", "NaN"), ("startYear", 0), ("startYear", True),
                       ("endYear", 2028), ("status", "bad")):
        body = fields(mr)
        body[key] = value
        assert api.post(BASE, headers=headers, json=body).status_code == 422, (key, value)
    for key in ("createdBy", "updatedAt", "created_by", "id", "version", "password_secret", "zoneId", "hq"):
        response = api.post(BASE, headers=headers, json={**fields(mr), key: "private-value"})
        assert response.status_code == 422 and "private-value" not in response.text and "password_secret" not in response.text
    assert api.post(BASE, headers=headers, json=fields({"id": str(uuid.uuid4())})).status_code == 409
    row = add(api, headers, mr)
    # Changes to shared MR relationships are derived from the server, not stale target copies.
    other = api.post("/api/v1/admin/zones", headers=headers, json={"name": "Replacement", "status": "active"}).json()
    stored_mr = db.get(MRDirectory, uuid.UUID(mr["id"]))
    stored_mr.zoneId = uuid.UUID(other["id"])
    db.commit()
    assert api.get(f"{BASE}/{row['id']}", headers=headers).json()["zoneName"] == "Replacement"
    from app.core.security import utcnow
    stored_mr.deleted_at, stored_mr.deleted_by = utcnow(), stored_mr.created_by
    db.commit()
    assert api.get(BASE, headers=headers).json()["filtered"] == 1
    assert api.post(BASE, headers=headers, json=fields(mr, 2030)).status_code == 409
    bad = review(api, headers, (HEADER + "MR-01,2030,2031,1,2,3,4,active").encode()).json()
    assert not bad["valid"] and any("deleted" in e for e in bad["rows"][0]["errors"])


def test_filters_all_match_totals_year_choices_and_export_agreement(client, monkeypatch):
    api, db, _ = client
    headers, _, mr, _, zone = setup(api, db)
    for index in range(12):
        add(api, headers, mr, 1980 + index, **({"status": "inactive"} if index < 11 else {}))
    result = api.get(BASE, headers=headers, params={"status": "inactive", "zoneId": zone,
                     "mrId": mr["id"], "query": mr["name"], "limit": 2}).json()
    assert result["total"] == 12 and result["filtered"] is None and result["partial"] and len(result["items"]) == 2
    assert result["totals"]["q1"] == "200.50" and result["totals"]["total"] == "2000.50"
    assert api.get(BASE, headers=headers, params={"startYear": 1980, "endYear": 1981}).json()["filtered"] == 1
    assert api.get(BASE, headers=headers, params={"startYear": 1980, "endYear": 1982}).json()["filtered"] == 0
    for query in ("%", "_", "\\", "missing"):
        empty = api.get(BASE, headers=headers, params={"query": query}).json()
        assert empty["filtered"] is None and empty["partial"] and not empty["items"] and set(empty["totals"].values()) == {"0.00"}
    choices = api.get(BASE + "/choices", headers=headers, params={"query": "MR-01", "limit": 1}).json()
    assert choices["mrs"][0]["id"] == mr["id"] and choices["total"] is None and choices["partial"] and 1980 in choices["years"]
    assert api.get(BASE + "/choices", headers=headers, params={"zoneId": str(uuid.uuid4())}).json()["total"] == 0
    initiation = str(uuid.uuid4())
    for format in ("csv", "xlsx"):
        response = api.get(BASE + "/export", headers={**headers, "X-Download-Initiation": initiation},
                           params={"status": "inactive", "zoneId": zone, "query": mr["name"], "format": format})
        assert response.status_code == 200 and response.headers["X-Download-Log"]
        rows = transfer.parse(response.content, "targets." + format)
        assert len(rows) == 11 and all(not row["errors"] for row in rows)
        if format == "xlsx":
            book = load_workbook(io.BytesIO(response.content))
            assert all(c.data_type == "s" for row in book.active for c in row)
            book.close()
        else:
            repeated = api.get(BASE + "/export", headers={**headers, "X-Download-Initiation": initiation},
                               params={"status": "inactive"})
            assert repeated.headers["X-Download-Log"] == response.headers["X-Download-Log"]
        initiation = str(uuid.uuid4())
    assert db.scalar(select(func.count()).select_from(DownloadLog).where(DownloadLog.source == "sales_target")) == 2
    monkeypatch.setattr(transfer, "EXPORT_LIMIT", 10)
    assert api.get(BASE + "/export", headers=headers, params={"status": "inactive"}).status_code == 422


def test_legacy_current_and_xlsx_atomic_review_digest_audit(client):
    api, db, _ = client
    headers, _, mr, _, _ = setup(api, db)
    data = (",".join(transfer.HEADERS[:7]) + "\nMR-01,2000,2001,1.25,2,3,4").encode()
    report = review(api, headers, data).json()
    assert report["valid"] and report["rows"][0]["values"]["status"] == "active"
    assert db.scalar(select(func.count()).select_from(SalesTarget)) == 0
    assert commit(api, headers, data + b"\n", report["digest"]).status_code == 409
    assert commit(api, headers, data, report["digest"], filename="other.csv").status_code == 409
    assert commit(api, headers, data, report["digest"], confirm="false").status_code == 422
    assert commit(api, headers, data, report["digest"]).json()["imported"] == 1
    assert commit(api, headers, data, report["digest"]).status_code == 409
    bad = (HEADER + "MR-01,2010,2011,1,2,3,4,active\nMR-01,2010,2011,1,2,3,4,inactive\n"
                   "MISSING,2012,2013,1,2,3,4,active\nMR-01,2014,2017,1.234,2,3,4,active").encode()
    report = review(api, headers, bad).json()
    assert report["validCount"] == 1 and report["invalidCount"] == 3
    assert commit(api, headers, bad, report["digest"]).status_code == 409
    for format in ("csv", "xlsx"):
        year = 2020 if format == "csv" else 2022
        audit = transfer.encode([transfer.HEADERS, ["MR-01", str(year), str(year + 1), "999999999999.99", "2", "3", "4",
                                    "inactive", "Forged Actor", "1900", "Forged Actor", "1900"]], format)
        report = review(api, headers, audit, "current." + format).json()
        assert report["valid"] and report["rows"][0]["values"]["q1"] == "999999999999.99"
        if format == "csv":
            assert commit(api, headers, audit, report["digest"], "current.csv").json()["imported"] == 1
            created = api.get(BASE, headers=headers, params={"startYear": 2020}).json()["items"][0]
            assert created["createdBy"] == "Super Admin" and not created["createdAt"].startswith("1900")
        else:
            assert commit(api, headers, audit, report["digest"], "current.xlsx").json()["imported"] == 1
    # A newly conflicting target invalidates the complete batch at confirmation.
    data = (HEADER + "MR-01,2030,2031,1,2,3,4,active\nMR-01,2032,2033,1,2,3,4,active").encode()
    report = review(api, headers, data).json()
    add(api, headers, mr, 2032)
    assert commit(api, headers, data, report["digest"]).status_code == 409
    assert api.get(BASE, headers=headers, params={"startYear": 2030}).json()["filtered"] == 0
    data = (HEADER + "MR-01,2034,2035,1,2,3,4,active").encode()
    report = review(api, headers, data).json()
    replacement, _ = admin_headers(api, db)
    assert commit(api, replacement, data, report["digest"]).status_code == 409


def test_inert_workbook_original_lexemes_bounds_upload_and_fail_closed_downloads(client, monkeypatch):
    api, db, _ = client
    headers, _, _, _, _ = setup(api, db)
    for data, name, status in ((b"", "targets.csv", 413), (b"x"*(2*1024*1024+1), "targets.csv", 413),
                               (b"bad", "targets.xls", 422), (b"bad", "targets.xlsx", 422),
                               (b"\xff", "targets.csv", 422), (b'Bad,Headers\n"x', "targets.csv", 422),
                               ((HEADER + "MR-01,2025,2026,1,2,3,4,active\n"*1001).encode(), "targets.csv", 422)):
        assert review(api, headers, data, name).status_code == status
    data = workbook([transfer.HEADERS[:8], ["MR-01", 2025, 2026, 1, 2, 3, 4, "active"]])
    def change_price(xml):
        return xml.replace(b'<c r="D2" t="n"><v>1</v>', b'<c r="D2" t="n"><v>999999999999.99</v>')
    exact = replace_zip(data, "xl/worksheets/sheet1.xml", change_price)
    report = review(api, headers, exact, "targets.xlsx").json()
    assert report["valid"] and report["rows"][0]["values"]["q1"] == "999999999999.99"
    scientific = replace_zip(data, "xl/worksheets/sheet1.xml",
                            lambda xml: xml.replace(b'<c r="D2" t="n"><v>1</v>', b'<c r="D2" t="n"><v>1.25E2</v>'))
    assert review(api, headers, scientific, "targets.xlsx").json()["rows"][0]["values"]["q1"] == "125.00"
    too_precise = replace_zip(data, "xl/worksheets/sheet1.xml",
                            lambda xml: xml.replace(b'<c r="D2" t="n"><v>1</v>', b'<c r="D2" t="n"><v>1.001</v>'))
    assert not review(api, headers, too_precise, "targets.xlsx").json()["valid"]
    formula = workbook([transfer.HEADERS[:8], ["MR-01", 2025, 2026, "=1+1", 2, 3, 4, "active"]])
    assert review(api, headers, formula, "targets.xlsx").status_code == 422
    good = (HEADER + "MR-01,2025,2026,1,2,3,4,active").encode()
    response = api.post(BASE + "/import/review", headers=headers, params={"filename": "targets.csv"},
                        files={"file": ("targets.csv", good, "text/csv")})
    assert response.status_code == 200 and response.json()["valid"]
    assert api.post(BASE + "/import/review", headers=headers, params={"filename": "targets.csv"},
                    files={"file": ("targets.csv", good), "other": ("x", b"x")}).status_code == 422
    from app.api.v1 import sales_targets as routes
    from fastapi import HTTPException
    def denied(*args, **kwargs):
        raise HTTPException(503, "Download acceptance unavailable")
    monkeypatch.setattr(routes, "server_record", denied)
    for path in ("/sample", "/export"):
        assert api.get(BASE + path, headers=headers).status_code == 503


def test_anonymous_mr_all_staff_grants_and_revoked_actor_denied(client):
    api, db, settings = client
    assert api.get(BASE).status_code == 401
    user = create_user(db, "target-mr@example.com")
    denied = {"Authorization": "Bearer " + login(api, user.email).json()["access_token"]}
    for route in ("", "/choices", "/sample", "/export", "/" + str(uuid.uuid4())):
        assert api.get(BASE + route, headers=denied).status_code == 403
    assert review(api, denied, b"garbage").status_code == 403
    from test_zone_permissions import setup as staff_setup, staff_login, bearer
    from app.core.master_catalogue import MASTER_ACTIONS
    admin, _, _, record, password = staff_setup(api, db, list(MASTER_ACTIONS))
    staff = bearer(staff_login(api, record, password))
    for route in ("", "/choices", "/sample", "/export", "/" + str(uuid.uuid4())):
        assert api.get(BASE + route, headers=staff).status_code == 403
    dummy = fields({"id": str(uuid.uuid4())})
    assert api.post(BASE, headers=staff, json=dummy).status_code == 403
    assert review(api, staff, b"garbage").status_code == 403
    from app.services.auth import identity_from_token, AuthError
    actor = identity_from_token(db, admin["Authorization"][7:], settings)
    session = db.get(AuthSession, actor.session_id)
    from app.core.security import utcnow
    session.status, session.revoked_at = "REVOKED", utcnow()
    db.commit()
    with pytest.raises(AuthError):
        sales_targets.create(db, actor, SalesTargetFields(**dummy))
