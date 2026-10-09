"""Only synthetic isolated PostgreSQL. No managed accounts or databases."""
import csv
import io
import uuid
from decimal import Decimal

import pytest
from openpyxl import load_workbook
from sqlalchemy import func, select

from app.db.models import AuditEvent
from app.db.designation_models import Designation
from app.db.download_models import DownloadLog
from app.services import designations, designation_transfer
from app.schemas.designations import DesignationFields
from test_sessions import client, create_user, login
from test_reporting import admin_headers
from test_zones import workbook, replace_zip

BASE = "/api/v1/admin/designations"
FIELDS = dict(name="Executive", shortName="EX", status="active")
HEADER = ",".join(designation_transfer.LEGACY_HEADERS[:10]) + "\n"


def add(api, headers, **changes):
    response = api.post(BASE, headers=headers, json={**FIELDS, **changes})
    assert response.status_code == 201, response.text
    return response.json()


def review(api, headers, data, filename="designations.csv"):
    return api.post(BASE + "/import/review", headers={**headers, "Content-Type": "application/octet-stream"},
                    params={"filename": filename}, content=data)


def commit(api, headers, data, digest, filename="designations.csv"):
    return api.post(BASE + "/import/commit", headers={**headers, "Content-Type": "application/octet-stream"},
                    params={"filename": filename, "digest": digest, "confirm": "true"}, content=data)


def test_lifecycle_filters_pagination_and_tombstone(client):
    api, db, _ = client
    headers, actor = admin_headers(api, db)
    assert api.get(BASE, headers=headers).json()["total"] == 0
    row = add(api, headers, name="  City \t Executive  ")
    assert row["name"] == "City Executive" and "basicDa" not in row and "level" not in row
    assert row["createdBy"] == row["updatedBy"] == "Super Admin"
    assert row["createdAt"] == row["updatedAt"]
    assert api.post(BASE, headers=headers, json={**FIELDS, "name": "CITY   executive"}).status_code == 409
    edited = api.post(f"{BASE}/{row['id']}/edit", headers=headers,
                     json={**FIELDS, "name": "Revised", "expected_version": 1}).json()
    assert edited["createdAt"] == row["createdAt"] and edited["version"] == 2
    assert edited["updatedAt"] > row["updatedAt"]
    for query in ("revised", "EX"):
        assert api.get(BASE, headers=headers, params={"query": query}).json()["filtered"] == 1
    assert api.get(BASE, headers=headers, params={"query": "%"}).json()["filtered"] == 0
    assert api.post(f"{BASE}/{row['id']}/status", headers=headers,
                    json={"status": "inactive", "expected_version": 1}).status_code == 409
    assert api.post(f"{BASE}/{row['id']}/status", headers=headers,
                    json={"status": "inactive", "expected_version": 2}).json()["version"] == 3
    assert api.post(BASE, headers=headers, json={**FIELDS, "name": "REVISED"}).status_code == 409
    for name in ("North", "East", "South"):
        add(api, headers, name=name)
    page = api.get(BASE, headers=headers, params={"status": "inactive", "limit": 1}).json()
    assert page["total"] == 4 and page["filtered"] == 1
    first = api.get(BASE, headers=headers, params={"limit": 2}).json()["items"]
    second = api.get(BASE, headers=headers, params={"limit": 2, "offset": 2}).json()["items"]
    assert len({r["id"] for r in first + second}) == 4
    assert api.post(f"{BASE}/{row['id']}/status", headers=headers,
                    json={"status": "active", "expected_version": 3}).json()["version"] == 4
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"expected_version": 3}).status_code == 409
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"expected_version": 4}).json()["version"] == 5
    db.expire_all()
    stored = db.get(Designation, uuid.UUID(row["id"]))
    assert stored.deleted_by == stored.updated_by == stored.created_by == actor.id
    assert stored.deleted_at == stored.updated_at and stored.shortName == "EX"
    deleted = stored.deleted_at
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"expected_version": 5}).status_code == 404
    assert api.get(f"{BASE}/{row['id']}", headers=headers).status_code == 404
    assert "Revised" not in api.get(BASE + "/export", headers=headers).text
    db.expire_all()
    assert db.get(Designation, stored.id).deleted_at == deleted
    assert add(api, headers, name="Revised")["id"] != row["id"]
    event = db.scalar(select(AuditEvent).where(AuditEvent.action == "designation_delete"))
    assert event.actor_id == actor.id and event.session_id and event.resource_type == "designation"


def test_validation_forgery_authorization_and_service_boundaries(client):
    api, db, settings = client
    assert api.get(BASE).status_code == 401
    mr = create_user(db, "designation-mr@example.com")
    mr_headers = {"Authorization": "Bearer " + login(api, mr.email).json()["access_token"]}
    for path in ("", "/export", "/sample"):
        assert api.get(BASE + path, headers=mr_headers).status_code == 403
    assert review(api, mr_headers, b"not a file").status_code == 403
    headers, actor = admin_headers(api, db)
    for forged in ("createdBy", "created_by", "updatedAt", "updated_by", "deleted_at", "deleted_by", "version"):
        assert api.post(BASE, headers=headers, json={**FIELDS, forged: "forged"}).status_code == 422
    for changes in ({"name": ""}, {"name": "x" * 201}, {"shortName": "x" * 51}, {"shortName": ""},
                    {"level": 0}, {"level": True}, {"level": 1.1}, {"level": "1"}, {"level": 2147483648},
                    {"basicDa": "-1"}, {"hra": "NaN"}, {"professionalTax": "Infinity"}, {"basicDa": True},
                    {"medicalAllowance": "0.001"}, {"travellingAllowance": "1000000000"}, {"name": "Nul\0name"}):
        assert api.post(BASE, headers=headers, json={**FIELDS, **changes}).status_code == 422
    # All retired inputs are forbidden, including formerly valid values.
    for field in ("level", "basicDa", "hra", "medicalAllowance", "travellingAllowance", "specialAllowance", "professionalTax"):
        response = api.post(BASE, headers=headers, json={**FIELDS, field: 1})
        assert response.status_code == 422
        assert response.json()["error"]["fields"][0]["field"] == "body"
    saved = add(api, headers)
    for field in ("level", "basicDa", "hra", "medicalAllowance", "travellingAllowance", "specialAllowance", "professionalTax"):
        assert api.post(f"{BASE}/{saved['id']}/edit", headers=headers,
                        json={**FIELDS, "expected_version": 1, field: 1}).status_code == 422
    add(api, headers, name="Second")
    from app.services.auth import identity_from_token
    identity = identity_from_token(db, mr_headers["Authorization"][7:], settings)
    for work in (lambda: designations.create(db, identity, DesignationFields(**FIELDS)),
                 lambda: designation_transfer.export(db, identity, "", "all", "csv"),
                 lambda: designation_transfer.transfer(db, identity, (HEADER + "New,EX,1,active,0,0,0,0,0,0").encode(), "file.csv")):
        with pytest.raises(designations.DesignationError) as failure:
            work()
        assert failure.value.status == 403


def test_atomic_review_identity_and_compatible_exports(client):
    api, db, settings = client
    headers, actor = admin_headers(api, db)
    data = (",".join(designation_transfer.LEGACY_HEADERS) + "\nFirst,F,1,Active,0.10,0.20,0,0,0,0,Forged,1900,Forged,1900\nSecond,S,2,Inactive,0,0,0,0,0,0,Forged,1900,Forged,1900").encode("utf-8-sig")
    report = review(api, headers, data).json()
    assert report["valid"] and report["validCount"] == 2 and report["invalidCount"] == 0
    assert db.scalar(select(func.count()).select_from(Designation)) == 0
    assert commit(api, headers, data + b"\n", report["digest"]).status_code == 409
    add(api, headers, name="Second")
    assert commit(api, headers, data, report["digest"]).status_code == 409
    assert not db.scalar(select(Designation.id).where(Designation.name == "First"))
    duplicate = review(api, headers, (HEADER + "Same,F,1,active,0,0,0,0,0,0\n SAME ,S,1,inactive,0,0,0,0,0,0").encode()).json()
    assert not duplicate["valid"] and duplicate["invalidCount"] == 1
    clean = (HEADER + "Imported,I,1,active,0.10,0.20,,,,").encode()
    report = review(api, headers, clean).json()
    assert report["valid"]
    fresh = {"Authorization": "Bearer " + login(api, actor.email).json()["access_token"]}
    assert commit(api, fresh, clean, report["digest"]).status_code == 409
    report = review(api, fresh, clean).json()
    assert commit(api, fresh, clean, report["digest"]).json()["imported"] == 1
    for name in ("=SUM(1)", "'literal"):
        add(api, fresh, name=name, shortName="@EX")
    for format in ("csv", "xlsx"):
        response = api.get(BASE + "/export", headers=fresh, params={"format": format})
        assert response.status_code == 200 and response.headers["X-Download-Log"]
        assert f'evexia-designation-master.{format}' in response.headers["content-disposition"]
        parsed = designation_transfer.parse(response.content, f"export.{format}")
        assert not any(row["errors"] for row in parsed)
        assert {row["values"]["name"] for row in parsed} >= {"=SUM(1)", "'literal"}
        for row in list(db.scalars(select(Designation).where(Designation.deleted_at.is_(None)))):
            from app.schemas.designations import DesignationVersion
            from app.services.auth import identity_from_token
            identity = identity_from_token(db, fresh["Authorization"][7:], settings)
            designations.mutate(db, identity, row.id, DesignationVersion(expected_version=row.version), "delete")
        report = review(api, fresh, response.content, f"export.{format}").json()
        assert report["valid"]
        assert commit(api, fresh, response.content, report["digest"], f"export.{format}").status_code == 200
        for row in db.scalars(select(Designation).where(Designation.deleted_at.is_(None))):
            assert row.created_by == actor.id
    assert db.scalar(select(func.count()).select_from(DownloadLog)) == 2


def test_formats_limits_samples_and_multipart(client, monkeypatch):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    for format in ("csv", "xlsx"):
        response = api.get(BASE + "/sample", headers=headers, params={"format": format})
        assert response.status_code == 200 and response.headers["X-Download-Log"]
        assert designation_transfer.parse(response.content, f"sample.{format}")[0]["values"]["name"] == "Example designation"
    data = (HEADER + "Upload,U,1,active,0,0,0,0,0,0").encode()
    response = api.post(BASE + "/import/review", headers=headers, params={"filename": "file.csv"},
                        files={"file": ("file.csv", data, "text/csv")})
    assert response.json()["valid"]
    assert review(api, headers, b"x" * (designation_transfer.MAX_BYTES + 1)).status_code == 413
    for text in (HEADER + ("Row,R,1,active,0,0,0,0,0,0\n" * 1001),
                 HEADER.replace("Level", "version") + "Row,R,1,active,0,0,0,0,0,0",
                 HEADER + '"unterminated'):
        assert review(api, headers, text.encode()).status_code == 422
    assert review(api, headers, b"\xff").status_code == 422
    assert review(api, headers, b"bad zip", "file.xlsx").status_code == 422
    for filename in ("file.xls", "file.xlsm", "file.zip"):
        assert review(api, headers, data, filename).status_code == 422
    rows = [designation_transfer.LEGACY_HEADERS[:10], ["Formula", "F", 1, "active", "=1+1", 0, 0, 0, 0, 0]]
    assert review(api, headers, workbook(rows), "file.xlsx").status_code == 422
    assert review(api, headers, replace_zip(workbook([["a"]]), "xl/worksheets/sheet1.xml", lambda _: b"<!DOCTYPE r [<!ENTITY x SYSTEM 'https://example.invalid'>]><r>&x;</r>"), "file.xlsx").status_code == 422
    add(api, headers)
    monkeypatch.setattr(designation_transfer, "EXPORT_LIMIT", 0)
    assert api.get(BASE + "/export", headers=headers).json()["error"]["code"] == "designation_export_limit"


def test_zone_only_staff_denied_at_routes_and_commit_export_boundaries(client):
    api, db, settings = client
    from test_zone_permissions import setup, staff_login
    from app.services.auth import identity_from_token
    from app.schemas.designations import DesignationVersion
    admin, _, _, staff, password = setup(api, db, ("zone.add", "zone.import", "zone.export", "zone.edit", "zone.delete"))
    row = add(api, admin)
    headers = {"Authorization": "Bearer " + staff_login(api, staff, password).json()["access_token"]}
    for path in ("", "/" + row["id"], "/export", "/sample"):
        assert api.get(BASE + path, headers=headers).status_code == 403
    data = (HEADER + "New,EX,1,active,0,0,0,0,0,0").encode()
    assert review(api, headers, data).status_code == 403
    assert commit(api, headers, data, "0" * 64).status_code == 403
    assert api.post(BASE, headers=headers, json=FIELDS).status_code == 403
    identity = identity_from_token(db, headers["Authorization"][7:], settings)
    for work in (lambda: designation_transfer.transfer(db, identity, data, "file.csv", True, "0" * 64),
                 lambda: designation_transfer.export(db, identity, "", "all", "csv"),
                 lambda: designations.mutate(db, identity, uuid.UUID(row["id"]), DesignationVersion(expected_version=1), "delete")):
        with pytest.raises(designations.DesignationError) as failure:
            work()
        assert failure.value.status == 403


@pytest.mark.parametrize("format", ["csv", "xlsx"])
@pytest.mark.parametrize("headers", [
    designation_transfer.HEADERS[:3], designation_transfer.HEADERS,
    designation_transfer.LEGACY_HEADERS[:10], designation_transfer.LEGACY_HEADERS,
])
def test_exact_reduced_and_legacy_schemas_ignore_retired_fields(client, format, headers):
    api, db, _ = client
    auth, _ = admin_headers(api, db)
    legacy = len(headers) in (10, 14)
    values = ["Compatible", "CP", "active"] if not legacy else [
        "Compatible", "CP", "not a level", "active", "NaN", "-5", "", "retired", "ignored", "Infinity"]
    if len(headers) in (7, 14):
        values += ["Forged", "1900", "Forged", "1900"]
    data = designation_transfer.encode([headers, values], format)
    report = review(api, auth, data, f"compat.{format}").json()
    assert report["valid"] and report["rows"][0]["values"] == dict(name="Compatible", shortName="CP", status="active")
    assert commit(api, auth, data, report["digest"], f"compat.{format}").json() == {"imported": 1}
    export = api.get(BASE + "/export", headers=auth, params={"format": format})
    parsed = designation_transfer.parse(export.content, f"current.{format}")
    assert parsed[0]["values"] == dict(name="Compatible", shortName="CP", status="active")
    for bad in (headers[::-1], [*headers, "Unknown"]):
        assert review(api, auth, designation_transfer.encode([bad, values], format), f"bad.{format}").status_code == 422
