"""Synthetic isolated PostgreSQL only; never uses managed data or credentials."""
import io
import uuid
import pytest
from openpyxl import load_workbook
from sqlalchemy import func, select
from app.db.models import AuditEvent
from app.db.courier_models import CourierPartner
from app.services.courier_transfer import parse, MAX_BYTES
from app.services.couriers import CourierError
from test_sessions import client, create_user, login
from test_reporting import admin_headers
from test_zones import workbook, replace_zip

BASE = "/api/v1/admin/courier-partners"


def add(api, headers, name="Delivery", status="active"):
    result = api.post(BASE, headers=headers, json={"name": name, "status": status})
    assert result.status_code == 201, result.text
    return result.json()


def review(api, headers, data, filename="couriers.csv"):
    return api.post(BASE + "/import/review", headers={**headers, "Content-Type": "application/octet-stream"},
                    params={"filename": filename}, content=data)


def commit(api, headers, data, digest, filename="couriers.csv"):
    return api.post(BASE + "/import/commit", headers={**headers, "Content-Type": "application/octet-stream"},
                    params={"filename": filename, "digest": digest, "confirm": "true"}, content=data)


def test_persistence_filters_versions_creator_and_soft_delete(client):
    api, db, _ = client
    headers, actor = admin_headers(api, db)
    row = add(api, headers, "  City \t Dispatch  ")
    assert row["name"] == "City Dispatch"
    assert row["createdBy"] == row["updatedBy"] == "Super Admin"
    assert row["createdAt"] == row["updatedAt"]
    assert api.post(BASE, headers=headers, json={"name": "CITY   dispatch", "status": "inactive"}).status_code == 409
    edited = api.post(f"{BASE}/{row['id']}/edit", headers=headers,
                     json={"name": "City revised", "status": "active", "expected_version": 1}).json()
    assert edited["createdAt"] == row["createdAt"] and edited["version"] == 2
    assert edited["updatedAt"] > row["updatedAt"]
    assert api.post(f"{BASE}/{row['id']}/status", headers=headers,
                    json={"status": "inactive", "expected_version": 1}).status_code == 409
    assert api.post(f"{BASE}/{row['id']}/status", headers=headers,
                    json={"status": "inactive", "expected_version": 2}).json()["version"] == 3
    for name in ("East", "West", "South"):
        add(api, headers, name)
    result = api.get(BASE, headers=headers, params={"status": "inactive", "query": "city", "limit": 1}).json()
    assert result["total"] == 4 and result["filtered"] == 1 and result["items"][0]["id"] == row["id"]
    assert api.get(BASE, headers=headers, params={"query": "%"}).json()["filtered"] == 0
    first = api.get(BASE, headers=headers, params={"limit": 2}).json()["items"]
    second = api.get(BASE, headers=headers, params={"limit": 2, "offset": 2}).json()["items"]
    assert len({entry["id"] for entry in first + second}) == 4
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"expected_version": 2}).status_code == 409
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"expected_version": 3}).json()["version"] == 4
    db.expire_all()
    stored = db.get(CourierPartner, uuid.UUID(row["id"]))
    assert stored.deleted_at is not None and stored.deleted_by == actor.id
    assert stored.updated_at == stored.deleted_at and stored.updated_by == stored.created_by == actor.id
    assert api.get(f"{BASE}/{row['id']}", headers=headers).status_code == 404
    assert api.get(BASE, headers=headers).json()["total"] == 3
    assert "City revised" not in api.get(BASE + "/export", headers=headers).text
    assert add(api, headers, "City revised")["id"] != row["id"]
    event = db.scalar(select(AuditEvent).where(AuditEvent.action == "courier_delete"))
    assert event.actor_id == actor.id and event.resource_id == stored.id and event.session_id
    # Courier operations do not alter the separate Zone table.
    assert api.get("/api/v1/admin/zones", headers=headers).json()["total"] == 0


def test_authorization_forged_audit_inputs_and_expired_auth(client):
    api, db, _ = client
    assert api.get(BASE).status_code == 401
    mr = create_user(db, "courier-mr@example.com")
    headers = {"Authorization": "Bearer " + login(api, mr.email).json()["access_token"]}
    assert api.get(BASE, headers=headers).status_code == 403
    assert api.get(BASE + "/export", headers=headers).status_code == 403
    assert review(api, headers, b"Courier Partner Name,Status\nPrivate,Active").status_code == 403
    headers, _ = admin_headers(api, db)
    for extra in ({"createdBy": "Forged"}, {"created_by": str(uuid.uuid4())}, {"deleted_at": "now"}, {"version": 50}):
        assert api.post(BASE, headers=headers, json={"name": "Forged", "status": "active", **extra}).status_code == 422
    for name in ("", "  ", "x" * 201):
        assert api.post(BASE, headers=headers, json={"name": name, "status": "active"}).status_code == 422
    api.post("/api/v1/auth/logout", headers={"Origin": "http://testserver"}, json={})
    assert api.post(BASE, headers=headers, json={"name": "Expired", "status": "active"}).status_code == 401


def test_review_confirm_revalidation_and_import_attribution(client):
    api, db, _ = client
    headers, actor = admin_headers(api, db)
    data = b"\xef\xbb\xbfCourier Partner Name,Status,Created By,Created At,Updated By,Updated At\nFirst,Active,Forged,1900,Forged,1900\nSecond,Inactive,Forged,1900,Forged,1900"
    report = review(api, headers, data).json()
    assert report["valid"] and db.scalar(select(func.count()).select_from(CourierPartner)) == 0
    assert commit(api, headers, data + b"\n", report["digest"]).status_code == 409
    assert commit(api, headers, data, "0" * 64).status_code == 409
    assert api.post(BASE + "/import/commit", headers=headers,
                    params={"filename": "couriers.csv", "digest": report["digest"], "confirm": "false"}).status_code == 422
    add(api, headers, "Second")
    assert commit(api, headers, data, report["digest"]).status_code == 409
    assert not db.scalar(select(CourierPartner).where(CourierPartner.name == "First"))
    duplicates = review(api, headers, b"Courier Partner Name,Status\nCity   Dispatch,active\ncity dispatch,inactive").json()
    assert not duplicates["valid"] and duplicates["rows"][1]["errors"]
    invalid = review(api, headers, b"Courier Partner Name,Status\nBad\x00Name,active").json()
    assert not invalid["valid"] and invalid["rows"][0]["errors"]
    clean = b"Courier Partner Name,Status\nImported,active"
    report = review(api, headers, clean).json()
    # A new session cannot reuse the old session's review confirmation.
    renewed_headers = {"Authorization": "Bearer " + login(api, actor.email).json()["access_token"]}
    assert commit(api, renewed_headers, clean, report["digest"]).status_code == 409
    report = review(api, renewed_headers, clean).json()
    assert commit(api, renewed_headers, clean, report["digest"]).json() == {"imported": 1}
    stored = db.scalar(select(CourierPartner).where(CourierPartner.name == "Imported"))
    assert stored.created_by == stored.updated_by == actor.id


@pytest.mark.parametrize("format", ["csv", "xlsx"])
def test_filtered_export_safe_roundtrip_and_audit_ignored(client, format):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    for name in ("=SUM(1)", "'=literal", "+dispatch", "Plain"):
        add(api, headers, name)
    add(api, headers, "Hidden inactive", "inactive")
    assert len(api.get(BASE, headers=headers, params={"limit": 2}).json()["items"]) == 2
    response = api.get(BASE + "/export", headers=headers, params={"status": "active", "format": format})
    assert response.status_code == 200
    assert response.headers["content-disposition"].endswith(f'.{format}"')
    assert response.headers["content-type"].startswith("text/csv" if format == "csv" else "application/vnd.openxml")
    if format == "xlsx":
        book = load_workbook(io.BytesIO(response.content))
        assert all(cell.data_type != "f" for row in book.active for cell in row)
        book.close()
    assert {row["name"] for row in parse(response.content, "couriers." + format)} == {"=SUM(1)", "'=literal", "+dispatch", "Plain"}
    for row in list(db.scalars(select(CourierPartner))):
        api.post(f"{BASE}/{row.id}/delete", headers=headers, json={"expected_version": row.version})
    report = review(api, headers, response.content, "couriers." + format).json()
    assert report["valid"]
    assert commit(api, headers, response.content, report["digest"], "couriers." + format).json()["imported"] == 4


def test_parser_security_and_upload_layers(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    valid = workbook([["Courier Partner Name", "Status"], ["Workbook", "Active"]])
    assert review(api, headers, valid, "couriers.xlsx").json()["valid"]
    hostile = [
        (b"\xff", "couriers.csv"), (b"Not a zip", "couriers.xlsx"), (valid, "couriers.xls"),
        (b"Wrong,Status\nName,active", "couriers.csv"),
        (b'Courier Partner Name,Status\n"unterminated,active', "couriers.csv"),
        (workbook([["Courier Partner Name", "Status"], ["=1+1", "Active"]]), "couriers.xlsx"),
        (replace_zip(valid, "xl/worksheets/sheet1.xml", lambda x: x.replace(b'r="A2"', b'r="ZZ99999"')), "couriers.xlsx"),
        (replace_zip(valid, "xl/_rels/workbook.xml.rels", lambda x: x.replace(b'Target=', b'TargetMode="External" Target=', 1)), "couriers.xlsx"),
        (replace_zip(valid, "[Content_Types].xml", lambda x: x.replace(b'spreadsheetml.sheet.main+xml', b'spreadsheetml.macroEnabled.main+xml')), "couriers.xlsx"),
        (replace_zip(valid, "xl/worksheets/sheet1.xml", lambda x: b'<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>' + x), "couriers.xlsx"),
        (workbook([["Courier Partner Name", "Status"], ["x" * 10001, "active"]]), "couriers.xlsx"),
    ]
    for data, filename in hostile:
        assert review(api, headers, data, filename).status_code == 422
    assert review(api, headers, b"x" * (MAX_BYTES + 1)).status_code == 413
    assert review(api, headers, b"Courier Partner Name,Status\n" + b"Partner,Active\n" * 1001).status_code == 422
    assert api.post(BASE + "/import/review", headers={**headers, "Content-Type": "application/octet-stream"},
                    params={"filename": "couriers.csv"}, content=iter([b"x" * 1024 * 1024] * 3)).status_code == 413
    assert api.post(BASE, headers=headers, content=b"x" * (1024 * 1024 + 1)).status_code == 413
    data = b"Courier Partner Name,Status\nMultipart,active"
    assert api.post(BASE + "/import/review", headers=headers, params={"filename": "couriers.csv"},
                    files={"file": ("couriers.csv", data, "text/csv")}).json()["valid"]
    assert api.post(BASE + "/import/review", headers=headers, params={"filename": "couriers.csv"},
                    files={"file": ("couriers.csv", b"x" * (MAX_BYTES + 1))}).status_code == 413
    assert api.post(BASE + "/import/review", headers=headers, params={"filename": "couriers.csv"},
                    files=[("file", ("a.csv", data)), ("file", ("b.csv", data))]).status_code == 422


def test_export_5000_bound_is_explicit(client):
    api, db, _ = client
    headers, actor = admin_headers(api, db)
    db.add_all([CourierPartner(name=f"Bound {index}", status="active", created_by=actor.id, updated_by=actor.id)
                for index in range(5001)])
    db.commit()
    assert api.get(BASE + "/export", headers=headers).json()["error"]["code"] == "courier_export_limit"
    assert api.get(BASE + "/export", headers=headers, params={"query": "Bound 5000"}).status_code == 200
    assert api.get(BASE + "/export", headers=headers, params={"query": "Bound 1"}).text.count("\r\n") > 1000
