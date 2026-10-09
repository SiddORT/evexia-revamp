"""Synthetic directory measurements; run only through test-api-foundation.sh."""
import csv
import io
import time
import uuid
from contextlib import contextmanager
import pytest

from sqlalchemy import event, insert, update
from openpyxl import load_workbook
from app.services import patients
from app.core.security import utcnow
from app.db.models import Patient, MRProfile, User
from app.db.mr_models import MRDirectory
from app.db.zone_models import Zone
from app.db.patient_models import PatientDirectory
from app.db.doctor_models import DoctorDirectory
from app.schemas.patients import PatientFields
from app.services.directory_inventory import FIELDS, INDEX_COLUMNS
from test_sessions import client, create_user, login
from test_patients import BASE, setup_patient, fields, add


def clone_values(row, table):
    # New UUIDs require new authenticated envelopes, never copied ciphertext.
    excluded = {"id", "deleted_at", "deleted_by", *INDEX_COLUMNS[table]}
    values = {column.key: getattr(row, column.key)
              for column in type(row).__mapper__.column_attrs
              if column.key not in excluded and not column.key.endswith("_ciphertext")}
    return {**values, **{field: getattr(row, field) for field in FIELDS[table]}}


def all_search_pages(api, headers, params):
    records, cursor = [], None
    for _ in range(25):
        response = api.get(BASE, headers=headers, params={**params, "offset": 0,
                           **({"cursor": cursor} if cursor else {})})
        assert response.status_code == 200, response.text
        page = response.json()
        records.extend(page["items"])
        cursor = page["nextCursor"]
        if not cursor:
            return records
    pytest.fail("Search continuation exceeded the finite synthetic-fixture budget")


@contextmanager
def measured(db, name):
    statements = []
    def capture(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)
    event.listen(db.bind, "before_cursor_execute", capture)
    start = time.perf_counter()
    try:
        yield statements
    finally:
        event.remove(db.bind, "before_cursor_execute", capture)
        print(f"\n{name}: {len(statements)} SELECTs, {time.perf_counter() - start:.3f}s")


def test_large_directory_measurements(client):
    api, db, _ = client
    headers, actor, mr, _, doctor = setup_patient(api, db)
    prototype = db.get(DoctorDirectory, uuid.UUID(doctor["id"]))
    values = clone_values(prototype, "doctor_directory")
    doctor_ids = [uuid.uuid4() for _ in range(501)]
    db.add_all([
        DoctorDirectory(**{**values, "id": key, "registrationNumber": f"SCALE-{i}"})
        for i, key in enumerate(doctor_ids)])
    ids = [uuid.uuid4() for _ in range(5001)]
    db.execute(insert(Patient), [
        dict(id=key, assigned_mr_id=uuid.UUID(mr["id"]), is_active=i < 5000, version=i + 1)
        for i, key in enumerate(ids)])
    body = PatientFields(**fields(doctor)).model_dump()
    now = utcnow()
    db.add_all([
        PatientDirectory(**{**body, "id": key, "name": f"Synthetic Scale {i:05}",
         "code": f"PAT-SCALE-{i:05}", "doctorId": doctor_ids[i % 501],
         "status": "active" if i < 5000 else "inactive",
         "created_by": actor.id, "updated_by": actor.id, "created_at": now, "updated_at": now})
        for i, key in enumerate(ids)])
    db.commit()
    pages = []
    for params in ({"limit": 100}, {"limit": 100, "offset": 100},
                   {"query": "Synthetic", "limit": 100, "offset": 4900},
                   {"query": "Scale 00001"}, {"query": "absent"},
                   {"limit": 100, "offset": 5000}):
        db.expire_all()
        with measured(db, f"list {params}") as statements:
            response = api.get(BASE, headers=headers, params=params)
        assert response.status_code == 200, response.text
        assert len(statements) <= 15, "List projection must not read per Patient/Doctor/author"
        page = response.json()
        assert page["total"] == 5001
        pages.append(page)
    assert not ({r["id"] for r in pages[0]["items"]} & {r["id"] for r in pages[1]["items"]})
    assert pages[3]["filtered"] is None and pages[3]["partial"]
    matches = all_search_pages(api, headers, {"query": "Scale 00001"})
    assert len(matches) == 1 and matches[0]["version"] == 2
    assert pages[4]["filtered"] is None and pages[4]["partial"]
    assert not all_search_pages(api, headers, {"query": "absent"})
    assert len(pages[5]["items"]) == 1
    for format in ("csv", "xlsx"):
        db.expire_all()
        with measured(db, f"5000-row {format} export") as statements:
            response = api.get(BASE + "/export", headers={**headers, "X-Download-Initiation": str(uuid.uuid4())},
                               params={"status": "active", "format": format})
        assert response.status_code == 200, response.text[:300]
        assert len(statements) <= 32, "Export reads must grow by 500-key batches, not records"
        if format == "csv":
            rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
            assert len(rows) == 5001
            assert {r[0] for r in rows[1:]} == {f"PAT-SCALE-{i:05}" for i in range(5000)}
        else:
            workbook = load_workbook(io.BytesIO(response.content), read_only=True)
            excel_rows = list(workbook.active.values)
            workbook.close()
            assert len(excel_rows) == 5001
            # CSV has a BOM and forces digit-only identifiers to text; XLSX
            # already stores strings and represents blank cells as None.
            normalized_csv = [tuple(value[1:] if index in (7, 13) and value.startswith("'") else value
                                    for index, value in enumerate(row)) for row in rows]
            assert [tuple(value or "" for value in row) for row in excel_rows] == normalized_csv
    for params in ({"query": "Scale 00001"}, {"mr_id": mr["id"], "status": "inactive"},
                   {"query": "absent"}, {"zone_id": "missing"}):
        page = api.get(BASE, headers=headers, params={**params, "limit": 100}).json()
        response = api.get(BASE + "/export", headers={**headers, "X-Download-Initiation": str(uuid.uuid4())},
                           params=params)
        assert response.status_code == 200
        exported = list(csv.reader(io.StringIO(response.text)))[1:]
        expected = all_search_pages(api, headers, params) if params.get("query") else page["items"]
        assert len(exported) == len(expected)
        assert [r[0] for r in exported] == [r["code"] for r in expected]
    with measured(db, "5001-row rejected export"):
        response = api.get(BASE + "/export", headers=headers)
    assert response.status_code == 409 and "5,000" in response.text


def test_complete_compact_choices_and_explicit_cap(client, monkeypatch):
    api, db, _ = client
    headers, actor, mr, zone, _ = setup_patient(api, db)
    prototype = db.get(MRDirectory, uuid.UUID(mr["id"]))
    values = clone_values(prototype, "mr_directory")
    template = db.get(User, db.get(MRProfile, prototype.id).user_id)
    user_ids = [uuid.uuid4() for _ in range(105)]
    mr_ids = [uuid.uuid4() for _ in user_ids]
    db.execute(insert(User), [dict(id=key, username=f"scale.reference.{i}",
                                  email=f"scale.reference.{i}@example.com",
                                  password_hash=template.password_hash, system_role="mr", identity_version=1)
                             for i, key in enumerate(user_ids)])
    db.execute(insert(MRProfile), [dict(id=key, user_id=user_id, is_active=True)
                                  for key, user_id in zip(mr_ids, user_ids)])
    db.add_all([MRDirectory(**{**values, "id": key, "name": f"ZZ Scale MR {i:03}",
                                     "email": f"scale.reference.{i}@example.com",
                                     "status": "inactive" if i == 104 else "active",
                                     "employeeCode": f"SCALE-MR-{i}"})
                                    for i, key in enumerate(mr_ids)])
    db.commit()
    db.expire_all()
    with measured(db, "106 compact filter choices") as statements:
        response = api.get(BASE + "/filters", headers=headers)
    assert response.status_code == 200, response.text
    result = response.json()
    # Revocation is serialized by one policy-lock query, not a per-choice query.
    policy_locks = [statement for statement in statements if "pg_advisory_xact_lock" in statement]
    assert len(policy_locks) == 1
    assert len(statements) - len(policy_locks) <= 12, "Compact choices must stay bounded including crypto-readiness checks"
    assert result["limit"] == 10000 and len(result["items"]) == 106
    inactive = next(row for row in result["items"] if row["id"] == str(mr_ids[-1]))
    assert inactive["status"] == "inactive"
    assert all(set(row) == {"id", "name", "status", "zoneId", "zoneName"} for row in result["items"])
    monkeypatch.setattr(patients, "FILTER_CHOICE_LIMIT", 105)
    failed = api.get(BASE + "/filters", headers=headers)
    assert failed.status_code == 409 and failed.json()["error"]["code"] == "patient_filter_limit"
    monkeypatch.setattr(patients, "FILTER_CHOICE_LIMIT", 106)
    db.execute(update(MRDirectory).where(MRDirectory.id == mr_ids[-1]).values(deleted_at=utcnow(), deleted_by=actor.id))
    db.execute(update(Zone).where(Zone.id == uuid.UUID(zone)).values(deleted_at=utcnow(), deleted_by=actor.id))
    db.commit()
    result = api.get(BASE + "/filters", headers=headers).json()
    assert len(result["items"]) == 105
    assert all(row["zoneId"] is None and row["zoneName"] == "" for row in result["items"])
    assert api.get(BASE + "/filters").status_code == 401
    user = create_user(db, "patient-filter-denied@example.com")
    token = login(api, user.email).json()["access_token"]
    assert api.get(BASE + "/filters", headers={"Authorization": f"Bearer {token}"}).status_code == 403


def test_batched_lifecycle_labels_saved_choices_and_missing_references(client):
    api, db, _ = client
    headers, actor, mr, zone, doctor = setup_patient(api, db)
    saved = add(api, headers, fields(doctor))
    db.execute(update(DoctorDirectory).where(DoctorDirectory.id == uuid.UUID(doctor["id"])).values(status="inactive"))
    db.execute(update(Zone).where(Zone.id == uuid.UUID(zone)).values(status="inactive"))
    db.commit()
    page = api.get(BASE, headers=headers).json()["items"][0]
    detail = api.get(BASE + "/" + saved["id"], headers=headers).json()
    assert page == detail
    assert page["doctorName"] == doctor["name"] and page["mrName"] == mr["name"]
    assert page["createdBy"] == page["updatedBy"] == "Super Admin"
    assert page["assignmentWarnings"] == [
        "Doctor inactive; unchanged assignment may be retained.",
        "Zone is inactive; the unchanged assignment may be retained."]
    choices = api.get(BASE + "/references", headers=headers,
                      params={"query": "absent", "include_saved": doctor["id"]}).json()
    assert choices["total"] is None and choices["partial"] and choices["nextCursor"] is None
    assert len(choices["items"]) == 1
    assert choices["items"][0]["id"] == doctor["id"] and not choices["items"][0]["usable"]
    db.execute(update(MRDirectory).where(MRDirectory.id == uuid.UUID(mr["id"])).values(
        deleted_at=utcnow(), deleted_by=actor.id))
    db.commit()
    page = api.get(BASE, headers=headers).json()["items"][0]
    assert page["mrId"] is None and page["mrName"] == "" and page["zoneId"] is None and page["zoneName"] == ""
    assert page["assignmentWarnings"][-1] == "Missing/deleted MR. Reassign explicitly."
    assert api.get(BASE, headers=headers, params={"mr_id": "missing", "zone_id": "missing"}).json()["filtered"] == 1
    row = db.get(PatientDirectory, uuid.UUID(saved["id"]))
    context = patients.projection_context(db, [row])
    context["doctors"].clear()
    context["labels"].clear()
    with measured(db, "pure projection with missing references") as statements:
        result = patients.projection(None, row, context)
    assert not statements
    assert result["doctorName"] == "" and result["mrName"] == "" and result["zoneName"] == ""
    assert result["assignmentWarnings"] == ["Missing Doctor; repair explicitly."]
    assert result["createdBy"] == result["updatedBy"] == "Backend user"
    context["owners"].clear()
    with pytest.raises(patients.PatientError) as missing:
        patients.projection(None, row, context)
    assert missing.value.code == "patient_identity_missing"
