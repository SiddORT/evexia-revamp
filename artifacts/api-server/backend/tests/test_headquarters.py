"""All records/credentials are synthetic and isolated PostgreSQL fixtures."""
import csv
import io
import uuid
import zipfile
import pytest
from openpyxl import load_workbook
from sqlalchemy import func, select
from app.db.models import AuditEvent
from app.db.headquarter_models import Headquarter
from app.services import headquarter_transfer as transfer
from app.services.headquarters import HeadquarterError
from app.schemas.headquarters import abbreviation, HeadquarterFields, HeadquarterEdit
from test_sessions import client, create_user, login
from test_reporting import admin_headers
from test_zones import workbook, replace_zip
from test_zone_permissions import setup, staff_login, bearer

BASE = "/api/v1/admin/headquarters"


def add(api, headers, name="North Mumbai", code=None, status="active"):
    body = {"name": name, "status": status}
    if code is not None:
        body["state_code"] = code
    response = api.post(BASE, headers=headers, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def review(api, headers, data, filename="hq.csv"):
    return api.post(BASE + "/import/review", headers={**headers, "Content-Type": "application/octet-stream"},
                    params={"filename": filename}, content=data)


def commit(api, headers, data, digest, filename="hq.csv"):
    return api.post(BASE + "/import/commit", headers={**headers, "Content-Type": "application/octet-stream"},
                    params={"filename": filename, "digest": digest, "confirm": "true"}, content=data)


def test_persistence_filters_audit_versions_and_tombstone(client):
    api, db, _ = client
    headers, actor = admin_headers(api, db)
    assert api.get(BASE, headers=headers).json()["total"] == 0
    row = add(api, headers, "  North \t Mumbai  ")
    assert row["name"] == "North Mumbai" and row["state_code"] == "NM"
    assert row["createdBy"] == row["updatedBy"] == "Super Admin"
    assert row["createdAt"] == row["updatedAt"]
    assert api.post(BASE, headers=headers, json={"name": "NORTH   mumbai", "status": "inactive"}).status_code == 409
    edit = {"name": "South Mumbai", "status": "active", "expected_version": 1}
    changed = api.post(f"{BASE}/{row['id']}/edit", headers=headers, json=edit).json()
    assert changed["state_code"] == "NM" and changed["version"] == 2
    assert changed["createdAt"] == row["createdAt"] and changed["updatedAt"] > row["updatedAt"]
    assert api.post(f"{BASE}/{row['id']}/edit", headers=headers, json=edit).status_code == 409
    changed = api.post(f"{BASE}/{row['id']}/edit", headers=headers,
                       json={**edit, "state_code": " custom ", "expected_version": 2}).json()
    assert changed["state_code"] == "CUSTOM" and changed["version"] == 3
    assert api.post(f"{BASE}/{row['id']}/status", headers=headers,
                    json={"status": "inactive", "expected_version": 3}).json()["version"] == 4
    for name in ("East", "West", "South"):
        add(api, headers, name, "CUSTOM")  # Codes are not unique.
    matching = api.get(BASE, headers=headers, params={"query": "custom", "status": "inactive", "limit": 1}).json()
    assert matching["total"] == 4 and matching["filtered"] == 1
    assert api.get(BASE, headers=headers, params={"query": "%"}).json()["filtered"] == 0
    first = api.get(BASE, headers=headers, params={"limit": 2}).json()["items"]
    second = api.get(BASE, headers=headers, params={"limit": 2, "offset": 2}).json()["items"]
    assert len({entry["id"] for entry in first + second}) == 4
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"expected_version": 3}).status_code == 409
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"expected_version": 4}).json()["version"] == 5
    db.expire_all()
    retained = db.get(Headquarter, uuid.UUID(row["id"]))
    evidence = (retained.deleted_at, retained.deleted_by)
    assert evidence[0] and evidence[1] == actor.id
    assert retained.updated_at == retained.deleted_at and retained.updated_by == actor.id and retained.created_by == actor.id
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"expected_version": 5}).status_code == 404
    assert api.get(f"{BASE}/{row['id']}", headers=headers).status_code == 404
    assert api.post(f"{BASE}/{row['id']}/status", headers=headers, json={"expected_version": 5, "status": "active"}).status_code == 404
    db.expire_all()
    assert (retained.deleted_at, retained.deleted_by) == evidence
    add(api, headers, "South Mumbai")
    assert db.scalar(select(func.count()).select_from(Headquarter)) == 5
    actions = set(db.scalars(select(AuditEvent.action).where(AuditEvent.resource_type == "headquarter")))
    assert {"headquarter_create", "headquarter_edit", "headquarter_status", "headquarter_delete"} <= actions


@pytest.mark.parametrize("name,code", [
    ("Mumbai", "MU"), ("North Mumbai", "NM"), ("North-Mumbai", "NM"),
    ("123", ""), ("École", "ÉC"), ("e\u0301cole", "ÉC"),
    ("नवी मुंबई", "नम"), ("ßeta", "SSE"), ("𐐨ab", "𐐀A"),
    ("A " * 30, "A" * 16), ("a.b_c/d", "ABCD"), ("東京", "東京"),
])
def test_abbreviation(name, code):
    assert abbreviation(name) == code


def test_validation_override_and_forgery(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    assert add(api, headers, "123", " manual ")["state_code"] == "MANUAL"
    assert api.post(BASE, headers=headers, json={"name": "123", "status": "active"}).status_code == 422
    for field, value in [("name", ""), ("name", "x" * 201), ("name", "a\x00b"),
                         ("name", "\ufeff"), ("state_code", ""), ("state_code", "x" * 17),
                         ("state_code", None), ("state_code", "a\nb"), ("state_code", "a\ufeffb")]:
        assert api.post(BASE, headers=headers, json={"name": "Valid", "state_code": "VA", "status": "active", field: value}).status_code == 422
    for field in ("created_by", "updated_by", "deleted_by", "created_at", "updated_at", "deleted_at", "version", "id", "createdBy"):
        assert api.post(BASE, headers=headers, json={"name": "Forge", "status": "active", field: "forged"}).status_code == 422
    row = add(api, headers, "No new code")
    assert api.post(f"{BASE}/{row['id']}/edit", headers=headers, json={"name": "1234", "status": "active", "expected_version": 1}).json()["state_code"] == row["state_code"]
    assert HeadquarterFields(name=" X ", state_code="ß", status="active").state_code == "SS"
    assert HeadquarterEdit(name="1234", status="active", expected_version=1).state_code is None


def test_anonymous_mr_and_zone_staff_are_denied(client):
    api, db, _ = client
    assert api.get(BASE).status_code == 401
    user = create_user(db, "synthetichqmr@example.com")
    token = login(api, user.email).json()["access_token"]
    headers = {"Authorization": "Bearer " + token}
    assert api.get(BASE, headers=headers).status_code == 403
    _, _, _, record, password = setup(api, db, ["zone.add", "zone.edit", "zone.delete", "zone.export", "zone.import"])
    headers = bearer(staff_login(api, record, password))
    for path in ("", "/sample", "/export", "/" + str(uuid.uuid4())):
        assert api.get(BASE + path, headers=headers).status_code == 403
    for path in ("", "/import/review", "/import/commit", "/" + str(uuid.uuid4()) + "/delete"):
        assert api.post(BASE + path, headers=headers, json={}).status_code == 403


def test_review_blank_generation_override_exact_bytes_and_attribution(client):
    api, db, _ = client
    headers, actor = admin_headers(api, db)
    data = b"HQ Name,State Code,Status,Created By,Created At,Updated By,Updated At\nNorth City,,Active,Forged,1900,Forged,1900\nSecond,manual,Inactive,Forged,1900,Forged,1900"
    report = review(api, headers, data).json()
    assert report["valid"] and [row["state_code"] for row in report["rows"]] == ["NC", "MANUAL"]
    assert db.scalar(select(func.count()).select_from(Headquarter)) == 0
    assert commit(api, headers, data + b"\n", report["digest"]).status_code == 409
    assert commit(api, headers, data, "0" * 64).status_code == 409
    assert commit(api, headers, data, report["digest"]).json()["imported"] == 2
    for row in db.scalars(select(Headquarter)):
        assert row.created_by == row.updated_by == actor.id
        assert row.created_at.year > 1900
    assert commit(api, headers, data, report["digest"]).status_code == 409
    duplicate = b"HQ Name,State Code,Status\nNEW,,active\n new ,N,inactive"
    assert not review(api, headers, duplicate).json()["valid"]
    conflict = b"HQ Name,State Code,Status\nFirst,,active\nThird,,active"
    report = review(api, headers, conflict).json()
    add(api, headers, "THIRD")
    assert commit(api, headers, conflict, report["digest"]).status_code == 409
    assert api.get(BASE, headers=headers, params={"query": "First"}).json()["filtered"] == 0


def test_review_session_binding_and_revocation(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    data = b"HQ Name,State Code,Status\nBound,,active"
    digest = review(api, headers, data).json()["digest"]
    refreshed = api.post("/api/v1/auth/refresh", headers={"Origin": "http://testserver"})
    same = {"Authorization": "Bearer " + refreshed.json()["access_token"]}
    assert review(api, same, data).json()["digest"] == digest
    api.post("/api/v1/auth/logout", headers={"Origin": "http://testserver"})
    assert commit(api, same, data, digest).status_code == 401
    headers, _ = admin_headers(api, db)
    assert commit(api, headers, data, digest).status_code == 409


def test_real_workbook_csv_roundtrip_filtering_samples_and_downloads(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    first = add(api, headers, "=Literal HQ", "+A")
    add(api, headers, "Hidden", "HI", "inactive")
    data = workbook([transfer.HEADERS[:3], ["Excel Office", "", "active"]])
    report = review(api, headers, data, "hq.xlsx").json()
    assert report["valid"] and report["rows"][0]["state_code"] == "EO"
    assert commit(api, headers, data, report["digest"], "hq.xlsx").json()["imported"] == 1
    for format in ("csv", "xlsx"):
        result = api.get(BASE + "/export", headers=headers, params={"format": format, "query": "=Literal"})
        assert result.status_code == 200 and result.headers["x-download-log"]
        assert result.headers["content-disposition"].endswith(f'master.{format}"')
        parsed = transfer.parse(result.content, "backup." + format)
        assert len(parsed) == 1 and parsed[0]["name"] == "=Literal HQ" and parsed[0]["state_code"] == "+A"
        if format == "xlsx":
            book = load_workbook(io.BytesIO(result.content), data_only=False)
            assert book.active["A2"].data_type == "s"
            book.close()
        else:
            rows = list(csv.reader(io.StringIO(result.content.decode("utf-8-sig"))))
            assert rows[0] == transfer.HEADERS and rows[1][0] == "'=Literal HQ"
        assert api.post(f"{BASE}/{first['id']}/delete", headers=headers, json={"expected_version": first["version"]}).status_code == 200
        report = review(api, headers, result.content, "backup." + format).json()
        assert report["valid"]
        assert commit(api, headers, result.content, report["digest"], "backup." + format).json()["imported"] == 1
        first = api.get(BASE, headers=headers, params={"query": "=Literal"}).json()["items"][0]
        sample = api.get(BASE + "/sample", headers=headers, params={"format": format})
        assert sample.status_code == 200 and sample.headers["x-download-log"]
        assert transfer.parse(sample.content, "sample." + format)[0]["state_code"] == "NM"


@pytest.mark.parametrize("data,filename", [
    (b"not a workbook", "hq.xlsx"), (b"HQ Name,State Code,Status,id\nX,X,active,1", "hq.csv"),
    (b"\xff\xfe", "hq.csv"), (b"HQ Name,State Code,Status\nX,X,active", "hq.xls"),
    (b"HQ Name,State Code,Status\nX,X,active", "hq.xlsm"),
    (b"HQ Name,State Code,Status\n" + b"X,X,active\n" * 1001, "hq.csv"),
    (b"x" * (transfer.MAX_BYTES + 1), "hq.csv"),
    (b'HQ Name,State Code,Status\n"unclosed,X,active', "hq.csv"),
])
def test_parser_bounds(data, filename):
    with pytest.raises(HeadquarterError):
        transfer.parse(data, filename)


def test_workbook_formulas_links_archives_and_cell_bounds():
    def with_member(name, content):
        output = io.BytesIO(workbook([transfer.HEADERS[:3], ["X", "X", "active"]]))
        with zipfile.ZipFile(output, "a") as archive:
            archive.writestr(name, content)
        return output.getvalue()
    for data in (
        workbook([transfer.HEADERS[:3], ["=1+1", "X", "active"]]),
        workbook([transfer.HEADERS[:3], ["x" * 10001, "X", "active"]]),
        with_member("xl/externalLinks/externalLink1.xml", b"<x/>"),
        with_member("xl/vbaProject.bin", b"macro"),
        with_member("xl/bomb.xml", b"x" * (4 * 1024 * 1024 + 1)),
        replace_zip(workbook([transfer.HEADERS[:3], ["X", "X", "active"]]), "xl/worksheets/sheet1.xml",
                    lambda data: data.replace(b'r="A2"', b'r="A1002"')),
    ):
        with pytest.raises(HeadquarterError):
            transfer.parse(data, "hq.xlsx")


def test_multipart_overhead_raw_limits_and_export_bound(client, monkeypatch):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    data = b"HQ Name,State Code,Status\nMultipart,,active"
    response = api.post(BASE + "/import/review", headers=headers, params={"filename": "hq.csv"},
                        files={"file": ("hq.csv", data, "text/csv")})
    assert response.status_code == 200 and response.json()["valid"]
    assert api.post(BASE + "/import/review", headers=headers, params={"filename": "hq.csv"},
                    files={"file": ("hq.csv", data)}, data={"unexpected": "field"}).status_code == 422
    assert review(api, headers, b"x" * (transfer.MAX_BYTES + 1)).status_code == 413
    assert api.post(BASE + "/import/review", headers={**headers, "Content-Type": "multipart/form-data; boundary=x"},
                    params={"filename": "hq.csv"}, content=b"x" * (transfer.MAX_BYTES + 65537)).status_code == 413
    add(api, headers, "One")
    add(api, headers, "Two")
    monkeypatch.setattr(transfer, "EXPORT_LIMIT", 1)
    assert api.get(BASE + "/export", headers=headers).status_code == 422
    assert api.get(BASE + "/export", headers=headers, params={"query": "One"}).status_code == 200
