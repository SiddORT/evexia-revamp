"""Forty exact grants, real operations and consuming helpers; disposable fixtures only."""
import csv
import io
import uuid

import pytest
from sqlalchemy import select

from app.db.models import Patient, MRProfile, AuditEvent
from app.services.master_policy import MASTERS, ACTIONS, MASTER_ACTIONS
from app.services import mr_postal
from app.db.download_models import DownloadLog
from test_sessions import client
from test_zone_permissions import setup, staff_login, bearer, ROLES
from test_mrs import fields as mr_fields, csv_data as mr_csv
from test_doctors import fields as doctor_fields, csv_file as doctor_csv
from test_patients import fields as patient_fields, csv_file as patient_csv

PATHS = dict(zip(MASTERS, ("headquarters", "zones", "mrs", "patients", "doctors",
                          "product-categories", "storage-locations", "courier-partners")))
BASE = "/api/v1/admin/"
NO_DELETE = {"doctor", "patient"}  # Neither existing master has a deletion workflow.
NO_SAMPLE = {"zone", "location", "courier"}  # Existing client templates have durable evidence.


def seed(api, admin):
    def create(resource, body):
        response = api.post(BASE + PATHS[resource], headers=admin, json=body)
        assert response.status_code == 201, response.text
        return response.json()
    bodies = {
        "headquarter": dict(name="HQ for MRs", status="active"),
        "zone": dict(name="Zone for MRs", status="active"),
        "location": dict(name="Location", address="Main Street", status="active"),
        "courier": dict(name="Courier", status="active"),
        "product_category": dict(name="Category", description="", unit_price="1.00", status="active"),
    }
    rows = {key: create(key, value) for key, value in bodies.items()}
    designation = api.post(BASE + "designations", headers=admin,
                           json=dict(name="Medical Representative", shortName="MR", status="active")).json()
    bodies["mr"] = mr_fields(rows["headquarter"]["id"], rows["zone"]["id"])
    bodies["mr"]["designation_id"] = designation["id"]
    rows["mr"] = create("mr", bodies["mr"])["record"]
    bodies["doctor"] = doctor_fields(rows["mr"])
    rows["doctor"] = create("doctor", bodies["doctor"])
    bodies["patient"] = patient_fields(rows["doctor"])
    rows["patient"] = create("patient", bodies["patient"])
    return bodies, rows


def upload(resource, bodies, rows):
    body = {**bodies[resource], "name": "Imported item"}
    if resource == "mr":
        return mr_csv([{**body, "employeeCode": "IMPORT-01", "userId": "import.mr"}])
    if resource == "doctor":
        return doctor_csv([{**body, "registrationNumber": "REG-IMPORT"}])
    if resource == "patient":
        return patient_csv([{**body, "phone": "9000000099"}], rows["doctor"])
    columns = {
        "headquarter": (("name", "HQ Name"), ("state_code", "State Code"), ("status", "Status")),
        "zone": (("name", "Zone Name"), ("status", "Status")),
        "product_category": (("name", "Product Category Name"), ("description", "Description"),
                             ("unit_price", "Unit Price"), ("status", "Status")),
        "location": (("name", "Storage Location"), ("address", "Address"), ("status", "Status")),
        "courier": (("name", "Courier Partner Name"), ("status", "Status")),
    }[resource]
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow([title for _, title in columns])
    writer.writerow([body.get(key, "") for key, _ in columns])
    return stream.getvalue().encode()


@pytest.mark.parametrize("resource", MASTERS)
@pytest.mark.parametrize("action", ACTIONS)
def test_each_single_grant_is_exact_and_master_isolated(client, monkeypatch, resource, action):
    api, db, _ = client
    admin, _, role, record, password = setup(api, db, [f"{resource}.{action}"])
    bodies, rows = seed(api, admin)
    staff = bearer(staff_login(api, record, password))
    path = BASE + PATHS[resource]
    row = rows[resource]
    if resource in ("mr", "doctor", "patient"):
        lookup = mr_postal.lookup
        monkeypatch.setattr(mr_postal, "lookup", lambda db, actor, pin, **policy:
                            lookup(db, actor, pin, lambda _: [], **policy))
        for consuming_action in ("add", "edit"):
            postal = api.get(path + "/postal/110001", params={"action": consuming_action}, headers=staff)
            assert postal.status_code == (200 if action == consuming_action else 403), postal.text
        choices = api.get(path + "/references", params={"kind": "zones"} if resource == "mr" else {}, headers=staff)
        assert choices.status_code == 200
        for item in choices.json()["items"]:
            assert not {"phone", "email", "password", "credentials"}.intersection(item)
        if resource == "mr":
            assert api.get(path + "/username", headers=staff).status_code == (200 if action == "add" else 403)
            doctors = api.get(path + "/" + row["id"] + "/doctors", headers=staff)
            assert doctors.status_code == 200 and doctors.json()["total"] == 1
            assert set(doctors.json()["items"][0]) == {"id", "name", "registrationNumber", "status", "zoneName"}
        else:
            assert api.get(path + "/filters", headers=staff).status_code == 200
    version = {"expected_version": row["version"]}
    assert api.get(path, headers=staff).status_code == 200
    assert api.get(path + "/" + row["id"], headers=staff).status_code == 200
    for other in MASTERS:
        if other != resource:
            assert api.get(BASE + PATHS[other], headers=staff).status_code == 403
    for protected in ("staff", "roles", "designations"):
        assert api.get(BASE + protected, headers=staff).status_code == 403
    create_body = {**bodies[resource], "name": "Staff created"}
    if resource == "mr":
        create_body.update(employeeCode="STAFF-01", userId="staff.created.mr")
    if resource == "doctor":
        create_body["registrationNumber"] = "REG-STAFF"
    if resource == "patient":
        create_body["phone"] = "9000000088"
    created = api.post(path, headers=staff, json=create_body)
    assert created.status_code == (201 if action == "add" else 403), created.text
    if action == "add" and resource == "mr":
        credentials = created.json()["credentials"]
        assert credentials["password"] and credentials["userId"] == "staff.created.mr"
        fresh = created.json()["record"]
        assert api.get(path + "/account/staff.created.mr", headers=staff).json()["id"] == fresh["id"]
        assert api.get(path + "/account/synthetic.mr", headers=staff).status_code == 404
        assert api.post(path + "/" + fresh["id"] + "/reset", headers=staff,
                        json={"expected_version": fresh["version"]}).status_code == 403
    if action == "add" and resource == "patient":
        owner = db.get(Patient, uuid.UUID(created.json()["id"]))
        assert str(owner.assigned_mr_id) == rows["mr"]["id"]
    edited = api.post(path + "/" + row["id"] + "/edit", headers=staff,
                      json={**bodies[resource], **version, "name": "Edited"})
    assert edited.status_code == (200 if action == "edit" else 403), edited.text
    # Activation is Edit, not a hidden extra capability.
    latest = edited.json() if action == "edit" else row
    changed = api.post(path + "/" + row["id"] + "/status", headers=staff,
                       json={"expected_version": latest["version"], "status": "inactive"})
    assert changed.status_code == (200 if action == "edit" else 403), changed.text
    if resource in ("mr", "doctor"):
        contact = api.post(path + "/" + row["id"] + "/contact", headers=staff,
                           json={"expected_version": (changed.json() if action == "edit" else row)["version"],
                                 "contactRequirement": bodies[resource]["contactRequirement"]})
        assert contact.status_code == (200 if action == "edit" else 403), contact.text
        if action == "edit":
            changed = contact
    if resource not in NO_DELETE:
        deleted = api.post(path + "/" + row["id"] + "/delete", headers=staff,
                           json={"expected_version": (changed.json() if action == "edit" else row)["version"]})
        assert deleted.status_code == (200 if action == "delete" else 403), deleted.text
        if action == "delete":
            assert api.get(path + "/" + row["id"], headers=staff).status_code == 404
    for format in ("csv", "xlsx"):
        exported = api.get(path + "/export", params={"format": format},
                           headers={**staff, "X-Download-Initiation": str(uuid.uuid4())})
        assert exported.status_code == (200 if action == "export" else 403), exported.text[:200]
        if action == "export":
            assert exported.content and exported.headers["x-download-log"]
    if resource not in NO_SAMPLE:
        sample = api.get(path + "/sample", headers={**staff, "X-Download-Initiation": str(uuid.uuid4())})
        assert sample.status_code == (200 if action == "import" else 403), sample.text[:200]
    data = upload(resource, bodies, rows)
    transfer_headers = {**staff, "Content-Type": "application/octet-stream"}
    params = {"filename": "master.csv"}
    review = api.post(path + "/import/review", headers=transfer_headers, params=params, content=data)
    assert review.status_code == (200 if action == "import" else 403), review.text[:500]
    if action == "import":
        assert review.json()["valid"], review.text
        params.update(digest=review.json()["digest"], confirm=True)
        commit = api.post(path + "/import/commit", headers=transfer_headers, params=params, content=data)
        assert commit.status_code == 200, commit.text
    else:
        assert api.post(path + "/import/commit", headers=transfer_headers,
                        params={**params, "digest": "0" * 64, "confirm": True}, content=data).status_code == 403
    # Fresh policy check on every subsequent request; no authority from bearer contents.
    revoked = api.post(f"{ROLES}/{role['id']}/permissions", headers=admin,
                       json={"permissions": [], "expected_version": role["version"]})
    assert revoked.status_code == 200
    before_evidence = len(list(db.scalars(select(DownloadLog.id))))
    assert api.get(path, headers=staff).status_code == 403
    assert api.post(path, headers=staff, json=create_body).status_code == 403
    assert api.get(path + "/export", headers={**staff, "X-Download-Initiation": str(uuid.uuid4())}).status_code == 403
    assert api.post(path + "/import/commit", headers=transfer_headers,
                    params={**params, "digest": review.json().get("digest", "0" * 64), "confirm": True}, content=data).status_code == 403
    if resource not in NO_SAMPLE:
        assert api.get(path + "/sample", headers={**staff, "X-Download-Initiation": str(uuid.uuid4())}).status_code == 403
    assert len(list(db.scalars(select(DownloadLog.id)))) == before_evidence


def test_empty_all_mixed_helpers_and_protected_boundaries(client):
    api, db, _ = client
    admin, _, role, record, password = setup(api, db)
    _, rows = seed(api, admin)
    staff = bearer(staff_login(api, record, password))
    for resource in MASTERS:
        assert api.get(BASE + PATHS[resource], headers=staff).status_code == 403
    assert len(MASTER_ACTIONS) == 40
    role = api.post(f"{ROLES}/{role['id']}/permissions", headers=admin,
                    json={"permissions": sorted(MASTER_ACTIONS), "expected_version": role["version"]}).json()
    for resource in MASTERS:
        assert api.get(BASE + PATHS[resource], headers=staff).status_code == 200
    helpers = ("mrs/references?kind=zones", "mrs/username?name=Test",
               f"mrs/{rows['mr']['id']}/doctors", "doctors/references", "doctors/filters",
               "patients/references", "patients/filters")
    for helper in helpers:
        assert api.get(BASE + helper, headers=staff).status_code == 200, helper
    for endpoint in ("mrs/" + rows["mr"]["id"] + "/reset",):
        assert api.post(BASE + endpoint, headers=staff, json={"expected_version": 1}).status_code == 403
    for endpoint in ("/api/v1/domain/mrs", "/api/v1/reporting/downloads", "/api/v1/reporting/activity"):
        assert api.get(endpoint, headers=staff).status_code in (403, 404, 405)
    # A Patient-only role gets Doctor labels, not the full Doctor or MR directory.
    role = api.post(f"{ROLES}/{role['id']}/permissions", headers=admin,
                    json={"permissions": ["patient.add"], "expected_version": role["version"]}).json()
    choices = api.get(BASE + "patients/references", headers=staff).json()
    assert choices["items"] and "phone" not in choices["items"][0] and "email" not in choices["items"][0]
    assert api.get(BASE + "doctors", headers=staff).status_code == 403
    assert api.get(BASE + "mrs/references?kind=zones", headers=staff).status_code == 403
    assert api.get(BASE + "mrs/username?name=Test", headers=staff).status_code == 403
    assert api.get(BASE + f"mrs/{rows['mr']['id']}/doctors", headers=staff).status_code == 403
    assert api.get(BASE + "patients/postal/110001?action=edit", headers=staff).status_code == 403
    assert api.get(BASE + "doctors/postal/110001?action=add", headers=staff).status_code == 403
    # Role metadata edits preserve mixed grants and cannot confer protected authority by name.
    changed = api.post(f"{ROLES}/{role['id']}/edit", headers=admin,
                       json={"name": "Super Admin", "description": "Not protected",
                             "expected_version": role["version"]})
    assert changed.status_code == 200 and changed.json()["permissions"] == ["patient.add"]
    assert api.get(BASE + "roles", headers=staff).status_code == 403
    assert api.get(BASE + "roles", headers=admin).status_code == 200
