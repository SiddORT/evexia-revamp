"""Synthetic isolated PostgreSQL only; never uses managed data or credentials."""
import io
import uuid
import pytest
from openpyxl import load_workbook
from sqlalchemy import func, select
from app.db.models import AuditEvent
from app.db.location_models import StorageLocation
from app.services.location_transfer import parse, MAX_BYTES
from app.services.locations import LocationError
from test_sessions import client, create_user, login
from test_reporting import admin_headers
from test_zones import workbook, replace_zip

BASE = "/api/v1/admin/storage-locations"


def add(api, headers, name="Supply room", status="active", address="Building A"):
    result = api.post(BASE, headers=headers, json={"name": name, "address": address, "status": status})
    assert result.status_code == 201, result.text
    return result.json()


def review(api, headers, data, filename="locations.csv"):
    return api.post(BASE + "/import/review", headers={**headers, "Content-Type": "application/octet-stream"},
                    params={"filename": filename}, content=data)


def commit(api, headers, data, digest, filename="locations.csv"):
    return api.post(BASE + "/import/commit", headers={**headers, "Content-Type": "application/octet-stream"},
                    params={"filename": filename, "digest": digest, "confirm": "true"}, content=data)


def test_persistence_filters_versions_creator_and_soft_delete(client):
    api, db, _ = client
    headers, actor = admin_headers(api, db)
    row = add(api, headers, "  City \t Dispatch  ")
    assert row["name"] == "City Dispatch"
    assert row["createdBy"] == row["updatedBy"] == "Super Admin"
    assert row["createdAt"] == row["updatedAt"]
    assert api.post(BASE, headers=headers, json={"name": "CITY   dispatch", "address": "Building A", "status": "inactive"}).status_code == 409
    edited = api.post(f"{BASE}/{row['id']}/edit", headers=headers,
                     json={"name": "City revised", "address": "Building B", "status": "active", "expected_version": 1}).json()
    assert edited["createdAt"] == row["createdAt"] and edited["version"] == 2
    assert edited["updatedAt"] > row["updatedAt"]
    assert edited["address"] == "Building B"
    assert api.get(BASE, headers=headers, params={"query": "building b", "limit": 1}).json()["filtered"] == 1
    assert api.post(f"{BASE}/{row['id']}/status", headers=headers,
                    json={"status": "inactive", "expected_version": 1}).status_code == 409
    assert api.post(f"{BASE}/{row['id']}/status", headers=headers,
                    json={"status": "inactive", "expected_version": 2}).json()["version"] == 3
    assert api.post(BASE, headers=headers, json={"name": "CITY REVISED", "address": "Different", "status": "active"}).status_code == 409
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
    stored = db.get(StorageLocation, uuid.UUID(row["id"]))
    assert stored.deleted_at is not None and stored.deleted_by == actor.id
    assert stored.updated_at == stored.deleted_at and stored.updated_by == stored.created_by == actor.id
    deletion_time = stored.deleted_at
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"expected_version": 4}).status_code == 404
    assert api.post(f"{BASE}/{row['id']}/edit", headers=headers,
                    json={"name": "Changed tombstone", "address": "No", "status": "active", "expected_version": 4}).status_code == 404
    db.expire_all()
    assert db.get(StorageLocation, stored.id).deleted_at == deletion_time
    assert api.get(f"{BASE}/{row['id']}", headers=headers).status_code == 404
    assert api.get(BASE, headers=headers).json()["total"] == 3
    assert "City revised" not in api.get(BASE + "/export", headers=headers).text
    assert add(api, headers, "City revised")["id"] != row["id"]
    event = db.scalar(select(AuditEvent).where(AuditEvent.action == "location_delete"))
    assert event.actor_id == actor.id and event.resource_id == stored.id and event.session_id
    # Location operations do not alter the separate Zone table.
    assert api.get("/api/v1/admin/zones", headers=headers).json()["total"] == 0


def test_authorization_forged_audit_inputs_and_expired_auth(client):
    api, db, _ = client
    assert api.get(BASE).status_code == 401
    mr = create_user(db, "location-mr@example.com")
    headers = {"Authorization": "Bearer " + login(api, mr.email).json()["access_token"]}
    assert api.get(BASE, headers=headers).status_code == 403
    assert api.get(BASE + "/export", headers=headers).status_code == 403
    assert review(api, headers, b"Storage Location,Address,Status\nPrivate,Active").status_code == 403
    headers, _ = admin_headers(api, db)
    for extra in ({"createdBy": "Forged"}, {"created_by": str(uuid.uuid4())}, {"deleted_at": "now"},
                  {"deleted_by": str(uuid.uuid4())}, {"created_at": "1900"}, {"updated_at": "1900"},
                  {"updated_by": str(uuid.uuid4())}, {"version": 50}):
        assert api.post(BASE, headers=headers, json={"name": "Forged", "address": "Building A", "status": "active", **extra}).status_code == 422
    for name in ("", "  ", "x" * 201):
        assert api.post(BASE, headers=headers, json={"name": name, "address": "Building A", "status": "active"}).status_code == 422
    for address in ("", "  ", "x" * 2001, "Nul\x00address"):
        assert api.post(BASE, headers=headers, json={"name": "Bounded", "address": address, "status": "active"}).status_code == 422
    assert api.post(BASE, headers=headers, json={"name": "Missing address", "status": "active"}).status_code == 422
    api.post("/api/v1/auth/logout", headers={"Origin": "http://testserver"}, json={})
    assert api.post(BASE, headers=headers, json={"name": "Expired", "address": "Building A", "status": "active"}).status_code == 401


def test_review_confirm_revalidation_and_import_attribution(client):
    api, db, _ = client
    headers, actor = admin_headers(api, db)
    data = b"\xef\xbb\xbfStorage Location,Address,Status,Created By,Created At,Updated By,Updated At\nFirst,Building A,Active,Forged,1900,Forged,1900\nSecond,Building A,Inactive,Forged,1900,Forged,1900"
    report = review(api, headers, data).json()
    assert report["valid"] and db.scalar(select(func.count()).select_from(StorageLocation)) == 0
    assert commit(api, headers, data + b"\n", report["digest"]).status_code == 409
    assert commit(api, headers, data, "0" * 64).status_code == 409
    assert api.post(BASE + "/import/commit", headers=headers,
                    params={"filename": "locations.csv", "digest": report["digest"], "confirm": "false"}).status_code == 422
    add(api, headers, "Second")
    assert commit(api, headers, data, report["digest"]).status_code == 409
    assert not db.scalar(select(StorageLocation).where(StorageLocation.name == "First"))
    duplicates = review(api, headers, b"Storage Location,Address,Status\nCity   Dispatch,Building A,active\ncity dispatch,Building A,inactive").json()
    assert not duplicates["valid"] and duplicates["rows"][1]["errors"]
    invalid = review(api, headers, b"Storage Location,Address,Status\nBad\x00Name,Building A,active").json()
    assert not invalid["valid"] and invalid["rows"][0]["errors"]
    clean = b"Storage Location,Address,Status\nImported,Building A,active"
    report = review(api, headers, clean).json()
    # A new session cannot reuse the old session's review confirmation.
    renewed_headers = {"Authorization": "Bearer " + login(api, actor.email).json()["access_token"]}
    assert commit(api, renewed_headers, clean, report["digest"]).status_code == 409
    report = review(api, renewed_headers, clean).json()
    assert commit(api, renewed_headers, clean, report["digest"]).json() == {"imported": 1}
    stored = db.scalar(select(StorageLocation).where(StorageLocation.name == "Imported"))
    assert stored.created_by == stored.updated_by == actor.id
    audited = b"Storage Location,Address,Status,Created By,Created At,Updated By,Updated At\nAudit ignored,Office,active,Forged,1900,Forged,1900"
    report = review(api, renewed_headers, audited).json()
    assert commit(api, renewed_headers, audited, report["digest"]).status_code == 200
    stored = db.scalar(select(StorageLocation).where(StorageLocation.name == "Audit ignored"))
    assert stored.created_by == stored.updated_by == actor.id and stored.created_at.year > 1900
    assert stored.created_at == stored.updated_at


@pytest.mark.parametrize("format", ["csv", "xlsx"])
def test_filtered_export_safe_roundtrip_and_audit_ignored(client, format):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    for name in ("=SUM(1)", "'=literal", "+dispatch", "Plain"):
        add(api, headers, name, address="'=street" if name == "Plain" else "@Office")
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
    assert {row["name"] for row in parse(response.content, "locations." + format)} == {"=SUM(1)", "'=literal", "+dispatch", "Plain"}
    assert {row["address"] for row in parse(response.content, "locations." + format)} == {"'=street", "@Office"}
    for row in list(db.scalars(select(StorageLocation))):
        api.post(f"{BASE}/{row.id}/delete", headers=headers, json={"expected_version": row.version})
    report = review(api, headers, response.content, "locations." + format).json()
    assert report["valid"]
    assert commit(api, headers, response.content, report["digest"], "locations." + format).json()["imported"] == 4


def test_parser_security_and_upload_layers(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    valid = workbook([["Storage Location", "Address", "Status"], ["Workbook", "Building A", "Active"]])
    assert review(api, headers, valid, "locations.xlsx").json()["valid"]
    hostile = [
        (b"\xff", "locations.csv"), (b"Not a zip", "locations.xlsx"), (valid, "locations.xls"),
        (b"Wrong,Status\nName,active", "locations.csv"),
        (b'Storage Location,Address,Status\n"unterminated,active', "locations.csv"),
        (workbook([["Storage Location", "Address", "Status"], ["=1+1", "Building A", "Active"]]), "locations.xlsx"),
        (replace_zip(valid, "xl/worksheets/sheet1.xml", lambda x: x.replace(b'r="A2"', b'r="ZZ99999"')), "locations.xlsx"),
        (replace_zip(valid, "xl/_rels/workbook.xml.rels", lambda x: x.replace(b'Target=', b'TargetMode="External" Target=', 1)), "locations.xlsx"),
        (replace_zip(valid, "[Content_Types].xml", lambda x: x.replace(b'spreadsheetml.sheet.main+xml', b'spreadsheetml.macroEnabled.main+xml')), "locations.xlsx"),
        (replace_zip(valid, "xl/worksheets/sheet1.xml", lambda x: b'<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>' + x), "locations.xlsx"),
        (workbook([["Storage Location", "Address", "Status"], ["x" * 10001, "Building A", "active"]]), "locations.xlsx"),
    ]
    for data, filename in hostile:
        assert review(api, headers, data, filename).status_code == 422
    assert review(api, headers, b"x" * (MAX_BYTES + 1)).status_code == 413
    assert review(api, headers, b"Storage Location,Address,Status\n" + b"Partner,Building A,Active\n" * 1001).status_code == 422
    assert api.post(BASE + "/import/review", headers={**headers, "Content-Type": "application/octet-stream"},
                    params={"filename": "locations.csv"}, content=iter([b"x" * 1024 * 1024] * 3)).status_code == 413
    assert api.post(BASE, headers=headers, content=b"x" * (1024 * 1024 + 1)).status_code == 413
    data = b"Storage Location,Address,Status\nMultipart,Building A,active"
    assert api.post(BASE + "/import/review", headers=headers, params={"filename": "locations.csv"},
                    files={"file": ("locations.csv", data, "text/csv")}).json()["valid"]
    assert api.post(BASE + "/import/review", headers=headers, params={"filename": "locations.csv"},
                    files={"file": ("locations.csv", b"x" * (MAX_BYTES + 1))}).status_code == 413
    assert api.post(BASE + "/import/review", headers=headers, params={"filename": "locations.csv"},
                    files=[("file", ("a.csv", data)), ("file", ("b.csv", data))]).status_code == 422
    for header in ("Storage Location,Address,Status,ID", "Storage Location,Address,Status,version",
                   "Storage Location,Address,Status,deleted_at", "Storage Location ,Address,Status"):
        assert review(api, headers, (header + "\nName,Office,active,ignored").encode()).status_code == 422
    assert not review(api, headers, b"Storage Location,Address,Status\nName,,active").json()["valid"]
    # The global request layer and endpoint extraction layer preserve both bounds.
    from app.core.request_limits import body_limit
    assert body_limit("POST", BASE + "/import/review", 10) == MAX_BYTES + 65536
    assert body_limit("POST", "/api/v1/files", 10) == 10
    assert body_limit("POST", BASE, 10) == 1048576
    assert api.post(BASE + "/import/review", headers={**headers, "Content-Type": "application/octet-stream",
                    "Content-Length": str(MAX_BYTES + 65537)}, params={"filename": "locations.csv"}, content=b"x").status_code == 413
    assert api.post(BASE + "/import/review", headers=headers, params={"filename": "locations.csv"},
                    files={"file": ("x" * 66000 + ".csv", data)}).status_code == 422


def test_export_5000_bound_is_explicit(client):
    api, db, _ = client
    headers, actor = admin_headers(api, db)
    db.add_all([StorageLocation(name=f"Bound {index}", address="Building A", status="active", created_by=actor.id, updated_by=actor.id)
                for index in range(5001)])
    db.commit()
    assert api.get(BASE + "/export", headers=headers).json()["error"]["code"] == "location_export_limit"
    assert api.get(BASE + "/export", headers=headers, params={"query": "Bound 5000"}).status_code == 200
    assert api.get(BASE + "/export", headers=headers, params={"query": "Bound 1"}).text.count("\r\n") > 1000
