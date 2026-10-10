"""Global phone persistence, encryption and transfer checks on disposable PG."""
import uuid
import csv
import io
import pytest
from sqlalchemy import text
from app.schemas.phone import normalize_phone, DIAL
from app.services import mr_transfer, doctor_transfer, patient_transfer
from test_sessions import client
from test_mrs import setup, fields as mr_fields, add as add_mr
from test_doctors import fields as doctor_fields, add as add_doctor
from test_patients import fields as patient_fields, add as add_patient
from test_staff import BODY as STAFF_BODY
from test_vendors import FIELDS as VENDOR_BODY


@pytest.mark.parametrize("master", ["doctor", "patient", "mr", "staff", "vendor"])
def test_international_and_legacy_validation(master):
    assert normalize_phone("+39 02 12345678", "IT", master) == "0212345678"
    assert normalize_phone("+1 416 555 0123", "CA", master) == "4165550123"
    assert normalize_phone("+44 1481 256789", "GG", master) == "1481256789"
    with pytest.raises(ValueError):
        normalize_phone("123", "FR", master)
    with pytest.raises(ValueError):
        normalize_phone("+49 30 123456", "FR", master)
    if master in ("staff", "vendor"):
        with pytest.raises(ValueError):
            normalize_phone("1234567890", "IN", master)
    else:
        assert normalize_phone("1234567890", "IN", master) == "1234567890"


def test_all_five_create_edit_reload_and_transfers(client):
    api, db, _ = client
    headers, actor, hq, zone = setup(api, db)
    mr_body = {**mr_fields(hq, zone), "phone": "81234567", "dialCountry": "SG"}
    mr = add_mr(api, headers, mr_body)["record"]
    doctor_body = doctor_fields(mr, phone="81234567", alternatePhone="91234567", dialCountry="SG")
    doctor = add_doctor(api, headers, doctor_body)
    patient_body = patient_fields(doctor, phone="81234567", dialCountry="SG")
    patient = add_patient(api, headers, patient_body)
    staff_body = {**STAFF_BODY, "designation_id": mr["designation_id"], "phone": "81234567", "dialCountry": "SG"}
    staff_response = api.post("/api/v1/admin/staff", headers=headers, json=staff_body)
    assert staff_response.status_code == 201, staff_response.text
    staff = staff_response.json()["record"]
    vendor_body = {**VENDOR_BODY, "phoneNo": "81234567", "dialCountry": "SG"}
    vendor_response = api.post("/api/v1/admin/vendors", headers=headers, json=vendor_body)
    assert vendor_response.status_code == 201, vendor_response.text
    vendor = vendor_response.json()
    entries = [
        ("mrs", mr, mr_body, "phone"), ("doctors", doctor, doctor_body, "phone"),
        ("patients", patient, patient_body, "phone"), ("staff", staff, staff_body, "phone"),
        ("vendors", vendor, vendor_body, "phoneNo"),
    ]
    for kind, record, body, field in entries:
        base = f"/api/v1/admin/{kind}"
        assert record["dialCountry"] == "SG" and record[field] == "81234567"
        changed = {**body, "dialCountry": "IT", field: "+39 02 12345678"}
        if kind == "doctors":
            changed["alternatePhone"] = "+39 02 87654321"
        result = api.post(f"{base}/{record['id']}/edit", headers=headers,
                          json={**changed, "expected_version": record["version"]})
        assert result.status_code == 200, result.text
        saved = api.get(f"{base}/{record['id']}", headers=headers).json()
        assert saved["dialCountry"] == "IT" and saved[field] == "0212345678"
        if kind == "doctors":
            assert saved["alternatePhone"] == "0287654321"
        if kind in ("mrs", "doctors", "patients"):
            for format in ("csv", "xlsx"):
                export = api.get(base + "/export", headers=headers, params={"format": format})
                assert export.status_code == 200, export.text
                transfer = {"mrs": mr_transfer, "doctors": doctor_transfer, "patients": patient_transfer}[kind]
                rows = transfer.parse(export.content, "backup." + format)
                assert rows[0]["values"]["dialCountry"] == "IT"
                # Create-only imports need new business identities, not a rewrite.
                incoming = dict(rows[0]["values"])
                if kind == "mrs":
                    incoming.update(employeeCode=f"IMPORT-{format}", userId=f"import.{format}")
                elif kind == "doctors":
                    incoming["registrationNumber"] = f"IMPORT-{format}"
                else:
                    incoming.update(code=f"PAT-IMPORT-{format.upper()}", name=f"Imported Patient {format}")
                payload = transfer.encode([[incoming[key] for key, _ in transfer.COLUMNS]], format)
                request_headers = {**headers, "Content-Type": "application/octet-stream"}
                review = api.post(base + "/import/review", headers=request_headers,
                    content=payload, params={"filename": "roundtrip." + format})
                assert review.status_code == 200 and review.json()["valid"], review.text
                commit = api.post(base + "/import/commit", headers=request_headers,
                    content=payload, params={"filename": "roundtrip." + format, "digest": review.json()["digest"], "confirm": True})
                assert commit.status_code == 200, commit.text
    cipher = db.execute(text('SELECT "dialCountry_ciphertext" FROM mr_directory WHERE id=:id'),
                        {"id": uuid.UUID(mr["id"])}).scalar_one()
    assert cipher.startswith("v1:") and cipher != "IT"
    # The protected patient identity includes ISO region, not just calling code.
    duplicate = api.post("/api/v1/admin/patients", headers=headers,
        json={**patient_body, "dialCountry": "IT", "phone": "0212345678"})
    assert duplicate.status_code == 409
    canada = add_patient(api, headers, patient_fields(doctor, name="Shared code", dialCountry="CA", phone="4165550123"))
    us = add_patient(api, headers, patient_fields(doctor, name="Shared code", dialCountry="US", phone="4165550123"))
    assert canada["id"] != us["id"] and DIAL["CA"] == DIAL["US"]


@pytest.mark.parametrize("format", ["csv", "xlsx"])
def test_pre_country_mr_backup_defaults_to_india(format):
    values = mr_fields(str(uuid.uuid4()), str(uuid.uuid4()))
    rows = [mr_transfer.OLD_HEADERS, [values[key] if values[key] is not None else "" for key, title in mr_transfer.COLUMNS if title in mr_transfer.OLD_HEADERS]]
    if format == "csv":
        output = io.StringIO()
        csv.writer(output).writerows(rows)
        old = output.getvalue().encode()
    else:
        from test_zones import workbook
        old = workbook(rows)
    assert mr_transfer.parse(old, "old." + format)[0]["values"]["dialCountry"] == "IN"
