"""Isolated live Patient API, identity/relationship and bounded transfer regressions."""
import csv
import io
import uuid
import pytest
from openpyxl import Workbook
from pydantic import ValidationError
from sqlalchemy import select, text
from app.db.models import AuditEvent, Patient, MRProfile
from app.db.patient_models import PatientDirectory
from app.db.doctor_models import DoctorDirectory
from app.schemas.patients import PatientFields
from app.services import patient_transfer
from test_sessions import client
from test_doctors import setup_doctor, fields as doctor_fields, add as add_doctor, edit as edit_doctor
from test_mrs import fields as mr_fields, add as add_mr

BASE = "/api/v1/admin/patients"


def fields(doctor, **changes):
    return {**dict(name="Synthetic Patient", gender="prefer not to say", phone="9000000000", dialCountry="IN",
                   email="", dateOfBirth="2000-02-29", doctorId=doctor["id"], instructionsLanguage="Hindi",
                   status="active", addressLine1="Patient Street", addressLine2="", landmark="Landmark",
                   pincode="110001", city="Delhi", state="Delhi", country="India"), **changes}


def setup_patient(api, db):
    headers, actor, mr, zone = setup_doctor(api, db)
    doctor = add_doctor(api, headers, doctor_fields(mr))
    return headers, actor, mr, zone, doctor


def add(api, headers, body):
    response = api.post(BASE, headers=headers, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def edit(api, headers, record, body):
    return api.post(BASE + "/" + record["id"] + "/edit", headers=headers,
                    json={**body, "expected_version": record["version"]})


def review(api, headers, data, filename="patients.csv"):
    return api.post(BASE + "/import/review", headers={**headers, "Content-Type": "application/octet-stream"},
                    content=data, params={"filename": filename})


def commit(api, headers, data, digest, filename="patients.csv"):
    return api.post(BASE + "/import/commit", headers={**headers, "Content-Type": "application/octet-stream"},
                    content=data, params={"filename": filename, "digest": digest, "confirm": True})


def csv_file(bodies, doctor, legacy=False):
    columns = patient_transfer.LEGACY_COLUMNS if legacy else patient_transfer.COLUMNS
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([title for _, title in columns])
    for index, body in enumerate(bodies):
        values = dict(body, code=f"PAT-LEGACY-{index:06}", doctorId="DOC-LOCAL-001",
                      doctorRegistrationNumber=doctor["registrationNumber"])
        writer.writerow([values[key] for key, _ in columns])
    return output.getvalue().encode()


@pytest.mark.parametrize("changes", [
    {"dateOfBirth": "2020-02-30"}, {"dateOfBirth": "2099-01-01"}, {"dateOfBirth": "2000-01-01T00:00:00"},
    {"phone": "123"}, {"dialCountry": "ZZ"}, {"email": "bad"}, {"gender": "unknown"},
    {"assigned_mr_id": str(uuid.uuid4())}, {"createdBy": "forged"}, {"version": 1}, {"password": "unsupported"},
    {"id": str(uuid.uuid4())}, {"code": "PAT-FORGED"}, {"pincode": "A"}, {"addressLine1": ""},
])
def test_validation(changes):
    with pytest.raises(ValidationError):
        PatientFields(**fields({"id": str(uuid.uuid4())}, **changes))


@pytest.mark.parametrize("dial,number,prefix", [("IN", "9000000000", "+91"), ("US", "2025550100", "+1"),
                                              ("GB", "0712345678", "+44"), ("AE", "123456789", "+971")])
def test_all_supported_phone_country_roundtrips(client, dial, number, prefix):
    api, db, _ = client
    headers, _, _, _, doctor = setup_patient(api, db)
    record = add(api, headers, fields(doctor, dialCountry=dial, phone=number))
    assert record["dialCountry"] == dial and record["phone"] == number and record["country"] == "India"
    exported = api.get(BASE + "/export", headers={**headers, "X-Download-Initiation": str(uuid.uuid4())})
    assert prefix + number in exported.text
    assert patient_transfer.parse(exported.content, "patients.csv")[0]["values"]["phone"] == number


def test_full_fields_identity_only_and_duplicates(client):
    api, db, _ = client
    headers, actor, mr, zone, doctor = setup_patient(api, db)
    identity = Patient(assigned_mr_id=uuid.UUID(mr["id"]), version=4, is_active=True)
    db.add(identity); db.commit()
    empty = api.get(BASE, headers=headers)
    assert empty.json()["total"] == 0
    record = add(api, headers, fields(doctor))
    assert record["id"] != record["code"] and record["code"].startswith("PAT-")
    detail = api.get(BASE + "/" + record["id"], headers=headers)
    assert detail.headers["Cache-Control"] == "no-store"
    for key, value in fields(doctor).items():
        assert detail.json()[key] == value
    assert detail.json()["mrId"] == mr["id"] and detail.json()["zoneId"] == zone
    assert detail.json()["createdBy"] == "Super Admin"
    duplicate = api.post(BASE, headers=headers, json=fields(doctor, name="  synthetic patient  ", phone="90000 00000"))
    assert duplicate.status_code == 409
    # None of these fields are individually unique.
    add(api, headers, fields(doctor, dateOfBirth="2001-01-01"))
    updated = edit(api, headers, record, fields(doctor, name="Changed", email="patient@example.com",
                                               dialCountry="AE", phone="123 456 789", country="United Arab Emirates",
                                               pincode="AB-123", addressLine2="Second line"))
    assert updated.status_code == 200, updated.text
    assert updated.json()["phone"] == "123456789" and updated.json()["version"] == 2
    assert edit(api, headers, record, fields(doctor)).status_code == 409
    db.expire_all()
    owner = db.get(Patient, uuid.UUID(record["id"]))
    assert owner.assigned_mr_id == uuid.UUID(mr["id"]) and owner.version == 2
    assert db.get(PatientDirectory, identity.id) is None and db.get(Patient, identity.id).version == 4
    events = db.scalars(select(AuditEvent).where(AuditEvent.resource_id == owner.id)).all()
    assert {event.action for event in events} >= {"patient_directory_create", "patient_directory_edit"}
    assert all(event.reason is None and event.resource_type == "patient" for event in events)
    assert set(AuditEvent.__table__.columns.keys()) == {
        "id", "actor_id", "action", "resource_type", "resource_id",
        "request_id", "session_id", "reason", "outcome", "created_at",
    }, "Audit schema must remain metadata-only, with no patient business payload"


def test_shift_status_domain_guard_and_current_zone_filters(client):
    api, db, _ = client
    headers, _, mr, zone, doctor = setup_patient(api, db)
    patient = add(api, headers, fields(doctor))
    mr_row = db.get(MRProfile, uuid.UUID(mr["id"]))
    from app.db.mr_models import MRDirectory
    source = db.get(MRDirectory, mr_row.id)
    target = add_mr(api, headers, mr_fields(str(source.hq), zone, username="target.patient.mr", code="TARGET"))["record"]
    shifted = edit_doctor(api, headers, doctor, doctor_fields(target))
    assert shifted.status_code == 200, shifted.text
    current = api.get(BASE + "/" + patient["id"], headers=headers).json()
    assert current["version"] == 2 and current["mrId"] == target["id"]
    db.expire_all()
    assert str(db.get(Patient, uuid.UUID(patient["id"])).assigned_mr_id) == target["id"]
    assert api.get(BASE, headers=headers, params={"mr_id": mr["id"]}).json()["filtered"] == 0
    assert api.get(BASE, headers=headers, params={"mr_id": target["id"], "zone_id": zone}).json()["filtered"] == 1
    guarded = api.post("/api/v1/domain/patients/" + patient["id"] + "/assignment", headers=headers,
                       json={"assigned_mr_id": mr["id"]})
    assert guarded.status_code == 409
    response = api.post(BASE + "/" + patient["id"] + "/status", headers=headers,
                        json={"status": "inactive", "expected_version": current["version"]})
    assert response.status_code == 200, response.text
    db.expire_all()
    assert not db.get(Patient, uuid.UUID(patient["id"])).is_active
    # Doctor shift still moves inactive Patients atomically, preserving inactive state.
    bulk = api.post("/api/v1/admin/doctors/bulk", headers=headers, json={
        "operation": "shift", "mrId": mr["id"], "selected": [{"id": doctor["id"], "expected_version": shifted.json()["version"]}]})
    assert bulk.status_code == 200, bulk.text
    db.expire_all()
    owner = db.get(Patient, uuid.UUID(patient["id"]))
    assert str(owner.assigned_mr_id) == mr["id"] and not owner.is_active and owner.version == 4
    new_zone = api.post("/api/v1/admin/zones", headers=headers, json={"name": "Current Patient Zone", "status": "active"}).json()
    shifted_mr = api.post("/api/v1/admin/mrs/" + mr["id"] + "/edit", headers=headers,
                          json={**mr_fields(str(source.hq), new_zone["id"]), "expected_version": mr["version"]})
    assert shifted_mr.status_code == 200, shifted_mr.text
    assert api.get(BASE, headers=headers, params={"zone_id": zone}).json()["filtered"] == 0
    assert api.get(BASE, headers=headers, params={"zone_id": new_zone["id"]}).json()["filtered"] == 1
    exported = api.get(BASE + "/export", headers={**headers, "X-Download-Initiation": str(uuid.uuid4())},
                       params={"zone_id": new_zone["id"]})
    assert new_zone["name"] in exported.text


def test_csv_xlsx_review_atomic_commit_and_legacy(client):
    api, db, _ = client
    headers, _, _, _, doctor = setup_patient(api, db)
    data = csv_file([fields(doctor), fields(doctor, name="Other", gender="Female", phone="8000000000")], doctor, legacy=True)
    report = review(api, headers, data)
    assert report.status_code == 200, report.text
    assert report.json()["valid"] and len(report.json()["rows"]) == 2
    assert api.get(BASE, headers=headers).json()["total"] == 0
    assert commit(api, headers, data + b"\n", report.json()["digest"]).status_code == 409
    assert commit(api, headers, data, report.json()["digest"], "changed.csv").status_code == 409
    saved = commit(api, headers, data, report.json()["digest"])
    assert saved.status_code == 200 and saved.json()["imported"] == 2, saved.text
    assert commit(api, headers, data, report.json()["digest"]).status_code == 409
    assert api.get(BASE, headers=headers).json()["total"] == 2
    page = api.get(BASE, headers=headers, params={"limit": 1}).json()
    assert page["total"] == 2 and len(page["items"]) == 1
    for format in ("csv", "xlsx"):
        exported = api.get(BASE + "/export", headers={**headers, "X-Download-Initiation": str(uuid.uuid4())},
                           params={"format": format})
        assert exported.status_code == 200 and exported.headers["X-Download-Log"], exported.text
        parsed = patient_transfer.parse(exported.content, "export." + format)
        assert len(parsed) == (2 if format == "csv" else 3)
        assert {"9000000000", "8000000000"}.issubset({row["values"]["phone"] for row in parsed})
        assert all(row["values"]["doctorId"] == "" for row in parsed)
        # Encode an independent valid batch as real XLSX; no numeric DOB/phone loss.
        new = fields(doctor, name="Excel " + format, dialCountry="GB", phone="0712345678", pincode="SW1A 1AA", country="United Kingdom")
        values = dict(new, code="", doctorId="", doctorRegistrationNumber=doctor["registrationNumber"])
        workbook = patient_transfer.encode([[values[key] for key, _ in patient_transfer.COLUMNS]], "xlsx")
        excel = review(api, headers, workbook, "patients.xlsx")
        assert excel.status_code == 200 and excel.json()["valid"], excel.text
        done = commit(api, headers, workbook, excel.json()["digest"], "patients.xlsx")
        assert done.status_code == 200 and done.json()["imported"] == 1


def test_reference_retention_search_and_no_automatic_repair(client):
    api, db, _ = client
    headers, _, mr, _, doctor = setup_patient(api, db)
    record = add(api, headers, fields(doctor))
    response = api.post("/api/v1/admin/doctors/" + doctor["id"] + "/status", headers=headers,
                        json={"status": "inactive", "expected_version": doctor["version"]})
    assert response.status_code == 200
    assert edit(api, headers, record, fields(doctor, name="Retained")).status_code == 200
    assert api.post(BASE, headers=headers, json=fields(doctor, name="New")).status_code == 409
    assert api.get(BASE + "/references", headers=headers, params={"query": "Synthetic", "limit": 1}).json()["items"][0]["usable"] is False
    searched = api.get(BASE, headers=headers, params={"query": record["code"]}).json()
    assert searched["filtered"] is None and searched["partial"] and len(searched["items"]) == 1
    assert api.get(BASE + "/" + str(uuid.uuid4()), headers=headers).status_code == 404


def test_invalid_workbooks_limits_and_access(client):
    api, db, _ = client
    headers, _, _, _, doctor = setup_patient(api, db)
    data = csv_file([fields(doctor)], doctor)
    for filename in ("patients.xls", "patients.xlsm"):
        assert review(api, headers, data, filename).status_code == 422
    assert review(api, headers, b"x" * (2 * 1024 * 1024 + 1)).status_code == 413
    assert review(api, headers, data.replace(b"Doctor ID", b"assigned_mr_id")).status_code == 422
    bad = data.replace(doctor["registrationNumber"].encode(), b"missing-registration")
    report = review(api, headers, bad)
    assert report.status_code == 200 and not report.json()["valid"]
    assert api.get(BASE, headers=headers).json()["total"] == 0
    book = Workbook(); sheet = book.active
    sheet.append(patient_transfer.HEADERS); sheet.append(["=1+1"] * len(patient_transfer.HEADERS))
    output = io.BytesIO(); book.save(output); book.close()
    assert review(api, headers, output.getvalue(), "formula.xlsx").status_code == 422
    for path in ("", "/references", "/sample", "/export", "/" + str(uuid.uuid4())):
        assert api.get(BASE + path).status_code == 401
    from test_zone_permissions import setup as staff_setup, staff_login, bearer
    _, _, _, staff, password = staff_setup(api, db, grants=("zone.add", "zone.edit", "zone.import", "zone.export"))
    staff_headers = bearer(staff_login(api, staff, password))
    for path in ("", "/references", "/sample", "/export"):
        assert api.get(BASE + path, headers=staff_headers).status_code == 403
    assert api.post(BASE, headers=staff_headers, json=fields(doctor)).status_code == 403
    assert review(api, staff_headers, data).status_code == 403


def test_migration_preserves_existing_owners_and_empty_directory(client):
    _, db, _ = client
    assert db.scalar(text("SELECT count(*) FROM pg_indexes WHERE tablename='patient_directory' AND indexname='uq_patient_duplicate_cipher'")) == 1
    assert db.scalar(text("SELECT count(*) FROM patient_directory")) == 0


def test_transfer_limits_roundtrip_and_reference_snapshot(client, monkeypatch):
    api, db, _ = client
    headers, _, _, _, doctor = setup_patient(api, db)
    data = csv_file([fields(doctor)], doctor)
    report = review(api, headers, data).json()
    changed = api.post("/api/v1/admin/doctors/" + doctor["id"] + "/status", headers=headers,
                       json={"expected_version": 1, "status": "inactive"})
    assert changed.status_code == 200
    assert commit(api, headers, data, report["digest"]).status_code == 409
    assert api.get(BASE, headers=headers).json()["total"] == 0
    api.post("/api/v1/admin/doctors/" + doctor["id"] + "/status", headers=headers,
             json={"expected_version": 2, "status": "active"})
    assert review(api, headers, csv_file([fields(doctor)] * 1001, doctor)).status_code == 422
    assert review(api, headers, data.replace(b"Synthetic Patient", b"x" * 10001)).status_code == 422
    new_report = review(api, headers, data).json()
    assert commit(api, headers, data, new_report["digest"]).status_code == 200
    # Export/import into an explicitly emptied isolated fixture, preserving code and text.
    for format in ("csv", "xlsx"):
        exported = api.get(BASE + "/export", headers={**headers, "X-Download-Initiation": str(uuid.uuid4())},
                           params={"format": format}).content
        record = api.get(BASE, headers=headers).json()["items"][0]
        db.execute(text("DELETE FROM patient_directory")); db.commit()
        reviewed = review(api, headers, exported, "backup." + format)
        assert reviewed.status_code == 200 and reviewed.json()["valid"], reviewed.text
        assert commit(api, headers, exported, reviewed.json()["digest"], "backup." + format).json()["imported"] == 1
        restored = api.get(BASE, headers=headers).json()["items"][0]
        assert restored["code"] == record["code"] and restored["phone"] == record["phone"]
        assert restored["dateOfBirth"] == record["dateOfBirth"] and restored["doctorId"] == record["doctorId"]
    # A lower synthetic cap proves explicit overflow behavior without seeding 5,001 patients.
    monkeypatch.setattr(patient_transfer, "EXPORT_LIMIT", 0)
    response = api.get(BASE + "/export", headers={**headers, "X-Download-Initiation": str(uuid.uuid4())})
    assert response.status_code == 409 and response.json()["error"]["code"] == "patient_export_limit"
