"""Synthetic fixtures only; no managed database or account credentials."""
import io
import uuid
import pytest
from openpyxl import load_workbook
from sqlalchemy import func, select
from app.db.models import AuditEvent
from app.db.product_category_models import ProductCategory
from app.services import product_categories as service, product_category_transfer as transfer
from app.schemas.product_categories import ProductCategoryFields
from test_sessions import client, create_user, login
from test_reporting import admin_headers
from test_zones import workbook
from test_zone_permissions import setup, staff_login, bearer

BASE = "/api/v1/admin/product-categories"


def add(api, headers, name="Diagnostic reagents", price="125.5", status="active", description=""):
    response = api.post(BASE, headers=headers, json={
        "name": name, "description": description, "unit_price": price, "status": status})
    assert response.status_code == 201, response.text
    return response.json()


def review(api, headers, data, filename="categories.csv"):
    return api.post(BASE + "/import/review", headers={**headers, "Content-Type": "application/octet-stream"},
                    params={"filename": filename}, content=data)


def commit(api, headers, data, digest, filename="categories.csv"):
    return api.post(BASE + "/import/commit", headers={**headers, "Content-Type": "application/octet-stream"},
                    params={"filename": filename, "digest": digest, "confirm": "true"}, content=data)


def test_crud_audit_soft_deletion_and_versions(client):
    api, db, _ = client
    headers, actor = admin_headers(api, db)
    assert api.get(BASE, headers=headers).json()["total"] == 0
    row = add(api, headers, "  Diagnostic   reagents  ", description="  Example  ")
    assert row["name"] == "Diagnostic reagents" and row["description"] == "Example"
    assert row["unit_price"] == "125.500000"
    assert row["createdBy"] == row["updatedBy"] == "Super Admin"
    assert row["createdAt"] == row["updatedAt"]
    assert api.post(BASE, headers=headers, json={
        "name": "DIAGNOSTIC reagents", "unit_price": "0", "status": "inactive"}).status_code == 409
    assert api.get(BASE + "/" + row["id"], headers=headers).json() == row
    body = dict(name="Updated", description="", unit_price="999999999999.999999", status="inactive", expected_version=1)
    changed = api.post(f"{BASE}/{row['id']}/edit", headers=headers, json=body).json()
    assert changed["version"] == 2 and changed["unit_price"] == body["unit_price"]
    assert changed["createdAt"] == row["createdAt"] and changed["updatedAt"] > row["updatedAt"]
    assert api.post(f"{BASE}/{row['id']}/edit", headers=headers, json=body).status_code == 409
    for version, status in [(2, "active"), (3, "inactive")]:
        changed = api.post(f"{BASE}/{row['id']}/status", headers=headers,
                           json={"status": status, "expected_version": version}).json()
        assert changed["version"] == version + 1 and changed["createdAt"] == row["createdAt"]
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"expected_version": 3}).status_code == 409
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"expected_version": 4}).json()["version"] == 5
    db.expire_all()
    tombstone = db.get(ProductCategory, uuid.UUID(row["id"]))
    evidence = (tombstone.deleted_at, tombstone.deleted_by)
    assert evidence[0] and evidence[1] == actor.id
    assert tombstone.updated_at == tombstone.deleted_at and tombstone.updated_by == actor.id
    from datetime import datetime
    assert tombstone.created_by == actor.id and tombstone.created_at == datetime.fromisoformat(row["createdAt"].replace("Z", "+00:00"))
    for suffix, body in [("/delete", {"expected_version": 5}), ("/status", {"expected_version": 5, "status": "active"}),
                         ("/edit", {**body, "expected_version": 5})]:
        assert api.post(f"{BASE}/{row['id']}{suffix}", headers=headers, json=body).status_code == 404
    assert api.get(f"{BASE}/{row['id']}", headers=headers).status_code == 404
    assert api.get(BASE, headers=headers).json()["total"] == 0
    db.expire_all()
    assert (tombstone.deleted_at, tombstone.deleted_by) == evidence
    add(api, headers, "UPDATED")
    assert db.scalar(select(func.count()).select_from(ProductCategory)) == 2
    events = list(db.scalars(select(AuditEvent).where(AuditEvent.resource_type == "product_category")))
    assert {"product_category_create", "product_category_edit", "product_category_status", "product_category_delete"} <= {e.action for e in events}
    assert all(e.actor_id == actor.id and e.session_id and e.request_id for e in events)


@pytest.mark.parametrize("price", ["0", "0.000001", "125.5", "999999999999.999999", "000125.500000"])
def test_exact_prices(client, price):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    row = add(api, headers, price=price)
    assert row["unit_price"] == ProductCategoryFields(name="X", unit_price=price, status="active").unit_price
    db.expire_all()
    assert format(db.get(ProductCategory, uuid.UUID(row["id"])).unit_price, ".6f") == row["unit_price"]


@pytest.mark.parametrize("price", ["-1", "-0", "NaN", "Infinity", "1e2", "1.0000000", "1000000000000", "", "1,000", "0.0000001", 125.5, 0, True, None])
def test_price_rejection_without_rounding(client, price):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    assert api.post(BASE, headers=headers, json={"name": "Invalid", "unit_price": price, "status": "active"}).status_code == 422
    assert db.scalar(select(func.count()).select_from(ProductCategory)) == 0


def test_names_text_forgery_and_version_validation(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    good = {"name": "Valid", "description": "", "unit_price": "0", "status": "active"}
    for field, value in [("name", ""), ("name", "x" * 201), ("description", "x" * 2001),
                         ("name", "a\0b"), ("description", "a\0b"), ("status", "unknown")]:
        assert api.post(BASE, headers=headers, json={**good, field: value}).status_code == 422
    for field in ("created_by", "updated_by", "deleted_by", "created_at", "updated_at", "deleted_at", "version", "id", "createdBy"):
        assert api.post(BASE, headers=headers, json={**good, field: "forged"}).status_code == 422
    row = add(api, headers)
    for version in (None, 0, "1", 1.0, True):
        assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"expected_version": version}).status_code == 422


def test_combined_price_status_search_pagination_and_export(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    for index, price in enumerate(("0", "0.000001", "125.5", "999999999999.999999")):
        add(api, headers, f"Search {index}", price, description="Shared literal %")
    add(api, headers, "Inactive", "125.5", "inactive")
    params = {"query": "shared", "status": "active", "min_price": "0", "max_price": "125.5", "limit": 1}
    result = api.get(BASE, headers=headers, params=params).json()
    assert result["total"] == 5 and result["filtered"] == 3 and len(result["items"]) == 1
    ids = {api.get(BASE, headers=headers, params={**params, "offset": i}).json()["items"][0]["id"] for i in range(3)}
    assert len(ids) == 3
    exported = api.get(BASE + "/export", headers=headers, params=params)
    assert len(transfer.parse(exported.content, "backup.csv")) == result["filtered"]
    assert api.get(BASE, headers=headers, params={"min_price": "0", "max_price": "0"}).json()["filtered"] == 1
    assert api.get(BASE, headers=headers, params={"query": "%"}).json()["filtered"] == 4
    assert api.get(BASE, headers=headers, params={"query": "125.5"}).json()["filtered"] == 2
    for bounds in ({"min_price": "1", "max_price": "0"}, {"min_price": "-1"}, {"max_price": "NaN"}, {"max_price": "1.0000001"}):
        for suffix in ("", "/export"):
            assert api.get(BASE + suffix, headers=headers, params=bounds).status_code == 422
    assert api.get(BASE, headers=headers, params={"min_price": "", "max_price": ""}).json()["filtered"] == 5


def test_permission_denials_at_routes_and_service_boundaries(client):
    api, db, settings = client
    from app.services.auth import identity_from_token
    assert api.get(BASE).status_code == 401
    mr = create_user(db, "syntheticcategorymr@example.com")
    token = login(api, mr.email).json()["access_token"]
    _, _, _, staff, password = setup(api, db, ["zone.add", "zone.edit", "zone.delete", "zone.export", "zone.import"])
    staff_token = staff_login(api, staff, password).json()["access_token"]
    for token in (token, staff_token):
        headers = {"Authorization": "Bearer " + token}
        for suffix in ("", "/sample", "/export", "/" + str(uuid.uuid4())):
            assert api.get(BASE + suffix, headers=headers).status_code == 403
        for suffix in ("", "/import/review", "/import/commit", "/" + str(uuid.uuid4()) + "/edit",
                       "/" + str(uuid.uuid4()) + "/status", "/" + str(uuid.uuid4()) + "/delete"):
            assert api.post(BASE + suffix, headers=headers, json={}).status_code == 403
        actor = identity_from_token(db, token, settings)
        for operation in (
            lambda: service.create(db, actor, ProductCategoryFields(name="Denied", unit_price="0", status="active")),
            lambda: transfer.export(db, actor, "", "all", "csv"),
            lambda: transfer.transfer(db, actor, b"invalid", "bad.csv"),
            lambda: service.mutate(db, actor, uuid.uuid4(), None, "delete"),
        ):
            with pytest.raises(service.ProductCategoryError) as denied:
                operation()
            assert denied.value.status == 403


def test_import_bytes_session_audit_ownership_and_atomic_conflicts(client):
    api, db, _ = client
    headers, actor = admin_headers(api, db)
    data = b"Product Category Name,Description,Unit Price,Status,Created By,Created At,Updated By,Updated At\nImport A,,999999999999.999999,Active,Forged,1900,Forged,1900\nImport B,Description,0,Inactive,Forged,1900,Forged,1900"
    result = review(api, headers, data).json()
    assert result["valid"] and db.scalar(select(func.count()).select_from(ProductCategory)) == 0
    assert commit(api, headers, data + b"\n", result["digest"]).status_code == 409
    assert commit(api, headers, data, "0" * 64).status_code == 409
    assert commit(api, headers, data, result["digest"]).json()["imported"] == 2
    for row in db.scalars(select(ProductCategory)):
        assert row.created_by == row.updated_by == actor.id and row.created_at.year > 1900
    assert commit(api, headers, data, result["digest"]).status_code == 409
    data = b"Product Category Name,Description,Unit Price,Status\nFresh A,,0,active\nFresh B,,0,active"
    result = review(api, headers, data).json()
    add(api, headers, "FRESH B")
    assert commit(api, headers, data, result["digest"]).status_code == 409
    assert api.get(BASE, headers=headers, params={"query": "Fresh A"}).json()["filtered"] == 0
    duplicate = b"Product Category Name,Description,Unit Price,Status\nNew,,0,active\n new ,,0,inactive"
    assert not review(api, headers, duplicate).json()["valid"]
    invalid = b"Product Category Name,Description,Unit Price,Status\nValid,,0,active\nBad,,0.0000001,active"
    report = review(api, headers, invalid).json()
    assert not report["valid"] and report["rows"][1]["errors"]
    assert commit(api, headers, invalid, report["digest"]).status_code == 409
    bound = b"Product Category Name,Description,Unit Price,Status\nBound,,0,active"
    digest = review(api, headers, bound).json()["digest"]
    refreshed = api.post("/api/v1/auth/refresh", headers={"Origin": "http://testserver"}).json()["access_token"]
    same = {"Authorization": "Bearer " + refreshed}
    assert review(api, same, bound).json()["digest"] == digest
    api.post("/api/v1/auth/logout", headers={"Origin": "http://testserver"})
    assert commit(api, same, bound, digest).status_code == 401
    headers, _ = admin_headers(api, db)
    assert commit(api, headers, bound, digest).status_code == 409


def test_csv_xlsx_old_current_roundtrips_exact_prices_and_download_ledger(client, monkeypatch):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    for fmt in ("csv", "xlsx"):
        row = add(api, headers, "=Literal", "999999999999.999999", description="'=authored")
        response = api.get(BASE + "/export", headers=headers, params={"format": fmt})
        assert response.status_code == 200 and response.headers["x-download-log"]
        assert f'evexia-product-category-master.{fmt}' in response.headers["content-disposition"]
        parsed = transfer.parse(response.content, "backup." + fmt)
        assert parsed[0]["name"] == "=Literal" and parsed[0]["description"] == "'=authored"
        assert parsed[0]["unit_price"] == "999999999999.999999"
        if fmt == "xlsx":
            book = load_workbook(io.BytesIO(response.content), data_only=False)
            assert all(c.data_type == "s" for c in book.active[2])
            book.close()
        api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={"expected_version": 1})
        report = review(api, headers, response.content, "backup." + fmt).json()
        assert report["valid"]
        assert commit(api, headers, response.content, report["digest"], "backup." + fmt).json()["imported"] == 1
        restored = api.get(BASE, headers=headers).json()["items"][0]
        assert restored["createdAt"] != row["createdAt"]
        api.post(f"{BASE}/{restored['id']}/delete", headers=headers, json={"expected_version": 1})
        old = transfer.encode([transfer.HEADERS[:4], ["Legacy " + fmt, "", "125.5", "active"]], fmt)
        report = review(api, headers, old, "old." + fmt).json()
        assert commit(api, headers, old, report["digest"], "old." + fmt).json()["imported"] == 1
        current = api.get(BASE, headers=headers).json()["items"][0]
        assert current["unit_price"] == "125.500000"
        api.post(f"{BASE}/{current['id']}/delete", headers=headers, json={"expected_version": 1})
        sample = api.get(BASE + "/sample", headers=headers, params={"format": fmt})
        assert sample.status_code == 200 and sample.headers["x-download-log"]
        assert transfer.parse(sample.content, "sample." + fmt)[0]["unit_price"] == "125.500000"
    def fail(*args, **kwargs):
        raise service.ProductCategoryError("Ledger unavailable")
    monkeypatch.setattr("app.api.v1.product_categories.server_record", fail)
    assert api.get(BASE + "/sample", headers=headers).status_code == 503


def test_numeric_workbook_prices_use_original_xml_not_binary_floats():
    from test_zones import replace_zip
    data = workbook([transfer.HEADERS[:4], ["Numeric", "", 125.5, "active"]])
    assert transfer.parse(data, "numeric.xlsx")[0]["unit_price"] == "125.500000"
    for lexeme, expected in [("999999999999.999999", "999999999999.999999"),
                             ("1e-06", "0.000001"), ("125.500001", "125.500001")]:
        changed = replace_zip(data, "xl/worksheets/sheet1.xml", lambda content: content.replace(b"<v>125.5</v>", f"<v>{lexeme}</v>".encode()))
        assert transfer.parse(changed, "numeric.xlsx")[0]["unit_price"] == expected
    for lexeme in ("125.5000001", "1000000000000", "-1", "NaN"):
        changed = replace_zip(data, "xl/worksheets/sheet1.xml", lambda content: content.replace(b"<v>125.5</v>", f"<v>{lexeme}</v>".encode()))
        try:
            assert transfer.parse(changed, "numeric.xlsx")[0]["errors"]
        except service.ProductCategoryError:
            pass  # An invalid numeric producer can also fail the workbook parser.
