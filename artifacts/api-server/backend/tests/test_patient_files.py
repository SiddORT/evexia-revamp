"""Live Patient ownership changes during publication and grant authorization."""
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models import Patient, User
from app.db.file_models import FileRecord
from app.db.headquarter_models import Headquarter
from app.db.zone_models import Zone
from app.db.mr_models import MRDirectory
from app.db.doctor_models import DoctorDirectory
from app.db.patient_models import PatientDirectory
from app.schemas.mrs import MRFields
from app.schemas.doctors import DoctorFields
from app.schemas.patients import PatientFields
from test_files import files_env, clean_scanner, upload, saved_upload
from test_mrs import fields as mr_fields, seed_designation
from test_doctors import fields as doctor_fields
from test_patients import fields

BASE = "/api/v1/admin/patients"


def test_directory_delete_retains_file_access_owner_and_keys(files_env, monkeypatch):
    env = files_env
    setup_graph(env)
    file = saved_upload(env, monkeypatch)
    headers = env["auth"](env["owner"])
    with Session(env["engine"]) as db:
        owner = db.get(Patient, env["patient"].id)
        before = (owner.assigned_mr_id, owner.is_active, owner.version)
        key = db.get(FileRecord, uuid.UUID(file["id"])).object_key
    response = env["api"].post(BASE + f"/{env['patient'].id}/delete", headers=env["auth"](env["admin"]),
                               json={"expected_version": before[2]})
    assert response.status_code == 200, response.text
    # Directory-only deletion does not revoke owner-based file authority.
    assert env["api"].get(f"/api/v1/files/{file['id']}/download", headers=headers).status_code == 200
    with Session(env["engine"]) as db:
        owner = db.get(Patient, env["patient"].id)
        assert (owner.assigned_mr_id, owner.is_active, owner.version) == (*before[:2], before[2] + 1)
        assert db.get(FileRecord, uuid.UUID(file["id"])).object_key == key
        assert db.get(FileRecord, uuid.UUID(file["id"])).state == "verified"


def setup_graph(env):
    """Augment only this disposable fixture's owners for file race tests."""
    with Session(env["engine"]) as db:
        from directory_test_data import initialize_empty_metadata_fixture
        initialize_empty_metadata_fixture(db)
        actor = env["admin"].id
        seed_designation(db, actor)
        zone = Zone(name="File Patient Zone", status="active", created_by=actor, updated_by=actor)
        hq = Headquarter(name="File Patient HQ", state_code="FPH", status="active", created_by=actor, updated_by=actor)
        db.add_all([zone, hq]); db.flush()
        for profile, code in ((env["owner_mr"], "OWNER"), (env["replacement_mr"], "TARGET")):
            body = MRFields(**mr_fields(hq.id, zone.id, code=code, username=code.lower()))
            body.email = db.get(User, profile.user_id).email or ""
            db.add(MRDirectory(id=profile.id, **body.model_dump(exclude={"userId"}), created_by=actor, updated_by=actor))
        db.flush()
        doctors = []
        for profile, code in ((env["owner_mr"], "REG-OWNER"), (env["replacement_mr"], "REG-TARGET")):
            doctor = DoctorDirectory(**DoctorFields(**doctor_fields({"id": str(profile.id)}, registrationNumber=code)).model_dump(),
                                     verification="unverified", created_by=actor, updated_by=actor)
            db.add(doctor); db.flush(); doctors.append(doctor.id)
        body = PatientFields(**fields({"id": str(doctors[0])}))
        db.add(PatientDirectory(id=env["patient"].id, code="PAT-FILE-FIXTURE", **body.model_dump(), created_by=actor, updated_by=actor))
        db.commit()
        return list(map(str, doctors))


def test_patient_edit_changes_file_owner_and_invalidates_old_grant(files_env, monkeypatch):
    env = files_env
    one, two = setup_graph(env)
    file = saved_upload(env, monkeypatch)
    old = env["auth"](env["owner"])
    grant = env["api"].post(f"/api/v1/files/{file['id']}/download-url", headers=old).json()["url"]
    with Session(env["engine"]) as db:
        key = db.get(FileRecord, uuid.UUID(file["id"])).object_key
    response = env["api"].post(BASE + f"/{env['patient'].id}/edit", headers=env["auth"](env["admin"]),
                               json={**fields({"id": two}), "expected_version": 1})
    assert response.status_code == 200, response.text
    assert env["api"].get(grant, headers=old).status_code == 404
    assert env["api"].get(f"/api/v1/files/{file['id']}/download", headers=old).status_code == 404
    assert env["api"].get(f"/api/v1/files/{file['id']}/download", headers=env["auth"](env["replacement_owner"])).status_code == 200
    with Session(env["engine"]) as db:
        assert db.get(FileRecord, uuid.UUID(file["id"])).object_key == key


def test_patient_status_invalidates_grant_without_deleting_file(files_env, monkeypatch):
    env = files_env
    setup_graph(env)
    file = saved_upload(env, monkeypatch)
    headers = env["auth"](env["owner"])
    grant = env["api"].post(f"/api/v1/files/{file['id']}/download-url", headers=headers).json()["url"]
    response = env["api"].post(BASE + f"/{env['patient'].id}/status", headers=env["auth"](env["admin"]),
                               json={"status": "inactive", "expected_version": 1})
    assert response.status_code == 200
    assert env["api"].get(grant, headers=headers).status_code == 404
    assert env["api"].get(f"/api/v1/files/{file['id']}/download", headers=headers).status_code == 404
    with Session(env["engine"]) as db:
        retained = db.get(FileRecord, uuid.UUID(file["id"]))
        assert retained.state == "verified" and env["storage"].exists(retained.object_key)


def test_patient_inactivation_during_publication_does_not_publish(files_env, monkeypatch):
    env = files_env
    setup_graph(env)
    clean_scanner(monkeypatch)
    entered, release = threading.Event(), threading.Event()
    original = env["storage"].put
    def held_put(key, stream, content_type):
        entered.set()
        assert release.wait(10)
        return original(key, stream, content_type)
    monkeypatch.setattr(env["storage"], "put", held_put)
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(upload, env["api"], env["auth"](env["owner"]), env["patient"].id)
        assert entered.wait(10)
        response = env["api"].post(BASE + f"/{env['patient'].id}/status", headers=env["auth"](env["admin"]),
                                   json={"status": "inactive", "expected_version": 1})
        assert response.status_code == 200, response.text
        release.set()
        denied = pending.result(15)
    assert denied.status_code == 404, denied.text
    with Session(env["engine"]) as db:
        rows = db.scalars(select(FileRecord).where(FileRecord.patient_id == env["patient"].id)).all()
        assert len(rows) == 1 and rows[0].state == "pending_delete"
        assert not db.get(Patient, env["patient"].id).is_active


def test_doctor_bulk_shift_during_publication_and_conflicts_are_atomic(files_env, monkeypatch):
    env = files_env
    one, _ = setup_graph(env)
    clean_scanner(monkeypatch)
    entered, release = threading.Event(), threading.Event()
    original = env["storage"].put
    def held_put(key, stream, content_type):
        entered.set()
        assert release.wait(10)
        return original(key, stream, content_type)
    monkeypatch.setattr(env["storage"], "put", held_put)
    body = {"selected": [{"id": one, "expected_version": 1}], "operation": "shift", "mrId": str(env["replacement_mr"].id)}
    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(upload, env["api"], env["auth"](env["owner"]), env["patient"].id)
        assert entered.wait(10)
        response = env["api"].post("/api/v1/admin/doctors/bulk", headers=env["auth"](env["admin"]), json=body)
        assert response.status_code == 200, response.text
        release.set()
        assert pending.result(15).status_code == 404
    stale = env["api"].post("/api/v1/admin/doctors/bulk", headers=env["auth"](env["admin"]),
                            json={**body, "mrId": str(env["owner_mr"].id)})
    assert stale.status_code == 409
    with Session(env["engine"]) as db:
        assert db.get(Patient, env["patient"].id).assigned_mr_id == env["replacement_mr"].id
        assert db.get(DoctorDirectory, uuid.UUID(one)).mrId == env["replacement_mr"].id
