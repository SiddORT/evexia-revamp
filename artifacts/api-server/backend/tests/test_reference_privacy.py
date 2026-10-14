"""Current schema/runtime contracts. Synthetic disposable database only."""
import uuid
import pytest
from sqlalchemy import text
from app.db.mr_models import MRDirectory
from app.db.headquarter_models import Headquarter
from app.db.zone_models import Zone
from app.db.vendor_models import Vendor
from app.db.product_category_models import ProductCategory
from app.db.location_models import StorageLocation
from app.services import directory_runtime, directory_rotation
from app.services.directory_inventory import VENDOR_FIELDS, DirectoryCryptoError, PRIVACY_REVISION
from app.core.security import utcnow
from test_sessions import client
from test_reporting import admin_headers
from test_allergens import references, add as add_allergen, fields as allergen_fields, BASE as ALLERGENS
from test_mrs import setup, fields as mr_fields, add as add_mr, BASE as MRS
from test_vendors import add as add_vendor, BASE as VENDORS


def test_allergen_saved_names_survive_rename_same_id_edits_status_and_deleted_references(client):
    api, db, _ = client
    headers, actor = admin_headers(api, db)
    category, location = references(api, headers)
    row = add_allergen(api, headers, category, location)
    c = db.get(ProductCategory, uuid.UUID(category["id"]))
    s = db.get(StorageLocation, uuid.UUID(location["id"]))
    c.name, s.name = "Current category", "Current location"
    c.status, s.status = "inactive", "inactive"
    db.commit()
    response = api.get(ALLERGENS + "/" + row["id"], headers=headers).json()
    assert response["category_name"] == category["name"]
    assert response["storage_location_name"] == location["name"]
    assert response["category_status"] == "inactive"
    edited = api.post(ALLERGENS + "/" + row["id"] + "/edit", headers=headers,
        json={**allergen_fields(category, location), "expected_version": row["version"]})
    assert edited.status_code == 200, edited.text
    assert edited.json()["category_name"] == category["name"]
    assert api.get(ALLERGENS, headers=headers, params={"query": category["name"]}).json()["filtered"] == 1
    assert api.get(ALLERGENS, headers=headers, params={"query": "Current category"}).json()["filtered"] == 0
    for model in (c, s):
        model.deleted_at, model.deleted_by = utcnow(), actor.id
    db.commit()
    saved = api.get(ALLERGENS + "/" + row["id"], headers=headers).json()
    assert saved["category_name"] == category["name"] and saved["category_status"] == "deleted"
    replacement_c, replacement_s = references(api, headers)
    updated = api.post(ALLERGENS + "/" + row["id"] + "/edit", headers=headers,
        json={**allergen_fields(replacement_c, replacement_s), "expected_version": edited.json()["version"]})
    assert updated.status_code == 200, updated.text
    assert updated.json()["category_name"] == replacement_c["name"]
    for format in ("csv", "xlsx"):
        exported = api.get(ALLERGENS + "/export", headers=headers, params={"format": format})
        assert exported.status_code == 200


def test_mr_snapshots_same_id_edits_reassignment_manager_encryption_and_nulls(client):
    api, db, _ = client
    headers, actor, hq, zone = setup(api, db)
    parent = add_mr(api, headers, mr_fields(hq, zone, name="Original Manager", code="P", username="snapshot.parent"))["record"]
    body = {**mr_fields(hq, zone, code="C", username="snapshot.child"), "reportingManagerId": parent["id"]}
    child = add_mr(api, headers, body)["record"]
    p = db.get(MRDirectory, uuid.UUID(parent["id"]))
    p.name = "Renamed Manager"
    db.get(Headquarter, uuid.UUID(hq)).name = "Renamed HQ"
    db.get(Zone, uuid.UUID(zone)).name = "Renamed Zone"
    db.commit()
    current = api.get(MRS + "/" + child["id"], headers=headers).json()
    assert current["reportingManagerName"] == "Original Manager"
    assert current["hqName"] == child["hqName"] and current["zoneName"] == child["zoneName"]
    edited = api.post(MRS + "/" + child["id"] + "/edit", headers=headers,
                     json={**body, "expected_version": child["version"]})
    assert edited.status_code == 200, edited.text
    assert edited.json()["reportingManagerName"] == "Original Manager"
    stored = db.execute(text('SELECT reporting_manager_name_ciphertext FROM mr_directory WHERE id=:id'),
                        {"id": child["id"]}).scalar_one()
    assert stored.startswith("v1:") and "Original Manager" not in stored
    other = add_mr(api, headers, mr_fields(hq, zone, name="New Manager", code="N", username="snapshot.new"))["record"]
    updated = api.post(MRS + "/" + child["id"] + "/edit", headers=headers,
        json={**body, "reportingManagerId": other["id"], "expected_version": edited.json()["version"]})
    assert updated.status_code == 200, updated.text
    assert updated.json()["reportingManagerName"] == "New Manager"
    removed = api.post(MRS + "/" + child["id"] + "/edit", headers=headers,
        json={**body, "reportingManagerId": None, "expected_version": updated.json()["version"]})
    assert removed.status_code == 200, removed.text
    assert removed.json()["reportingManagerName"] == ""
    assert db.execute(text("SELECT reporting_manager_name_ciphertext FROM mr_directory WHERE id=:id"),
                      {"id": child["id"]}).scalar_one() is None


def test_vendor_ciphertext_storage_aad_and_search_exports(client, monkeypatch):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    saved = add_vendor(api, headers)
    row = db.get(Vendor, uuid.UUID(saved["id"]))
    columns = set(db.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='vendors'")).scalars())
    assert not set(VENDOR_FIELDS) & columns
    assert {"vendorName", "gstNo"} <= columns
    crypto = directory_runtime.crypto()
    for field in VENDOR_FIELDS:
        value = getattr(row, field + "_ciphertext")
        assert value.startswith("v1:") and saved[field] not in value
        assert crypto.decrypt("vendors", row.id, field, value) == saved[field]
        with pytest.raises(DirectoryCryptoError):
            crypto.decrypt("vendors", uuid.uuid4(), field, value)
    for term in ("Synthetic Contact", "contact@example.test", "Main Road", "98765"):
        response = api.get(VENDORS, headers=headers, params={"query": term})
        assert response.status_code == 200, response.text
        assert response.json()["filtered"] == 1
        for format in ("csv", "xlsx"):
            assert api.get(VENDORS + "/export", headers=headers, params={"query": term, "format": format}).status_code == 200
    monkeypatch.setattr(directory_runtime, "EXPORT_SCAN_LIMIT", 0)
    limited = api.get(VENDORS, headers=headers, params={"query": "Contact"})
    assert limited.status_code == 409 and limited.json()["error"]["code"] == "vendor_search_limit"


def test_new_inventory_is_revision_scoped_and_vendor_tampering_fails_closed(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    row = add_vendor(api, headers)
    assert "vendors" in directory_rotation._fields(db)
    inventory = directory_rotation._inventory(db, directory_runtime.crypto(), directory_runtime.crypto().index_key)
    assert inventory["counts"]["vendors"] == 1
    db.execute(text("UPDATE alembic_version SET version_num='0035_account_identifiers'"))
    assert "vendors" not in directory_rotation._fields(db)
    assert "reporting_manager_name" not in directory_rotation._fields(db)["mr_directory"]
    db.execute(text("UPDATE alembic_version SET version_num=:revision"), {"revision": PRIVACY_REVISION})
    db.execute(text('UPDATE vendors SET "emailId_ciphertext"=\'broken\' WHERE id=:id'), {"id": row["id"]})
    db.commit()
    assert api.get(VENDORS + "/" + row["id"], headers=headers).status_code == 503
