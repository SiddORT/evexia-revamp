"""Isolated encrypted persistence, bounded literal matching and disclosures."""
import csv
import io
import uuid
from sqlalchemy import select, text, insert
from pydantic import SecretStr
import pytest

from app.core.config import Settings
from app.core.security import utcnow
from app.db.doctor_models import DoctorDirectory
from app.schemas.doctors import DoctorFields
from app.services.directory_inventory import FIELDS
from app.services import directory_runtime
from directory_test_data import encrypted_values
from test_mrs import client
from test_doctors import setup_doctor as setup, fields, BASE
from test_directory_crypto import b64


def populate(api, db):
    headers, actor, mr, _zone = setup(api, db)
    values = DoctorFields(**fields(mr)).model_dump()
    values.update(created_by=actor.id, updated_by=actor.id, verification="unverified",
                  created_at=utcnow(), updated_at=utcnow())
    rows = [encrypted_values(db, "doctor_directory", {
        **values, "id": uuid.UUID(int=index), "registrationNumber": f"BOUND-{index}",
        "name": "Rare encrypted match" if index == 501 else f"Other {index}",
    }) for index in range(1, 502)]
    db.execute(insert(DoctorDirectory), rows)
    db.commit()
    return headers, rows


def test_no_match_section_continues_and_exports_every_match(client):
    api, db, _ = client
    headers, rows = populate(api, db)
    first = api.get(BASE, headers=headers, params={"query": "Rare encrypted"}).json()
    assert first["partial"] and first["filtered"] is None and first["scanned"] == 500
    assert first["items"] == [] and first["nextCursor"]
    second = api.get(BASE, headers=headers, params={"query": "Rare encrypted", "cursor": first["nextCursor"]}).json()
    assert len(second["items"]) == 1 and second["items"][0]["name"] == "Rare encrypted match"
    assert second["nextCursor"] is None
    exported = api.get(BASE + "/export", headers=headers, params={"query": "Other", "format": "csv"})
    assert exported.status_code == 200 and exported.headers["cache-control"] == "no-store"
    content = list(csv.reader(io.StringIO(exported.content.decode("utf-8-sig"))))
    assert len(content) == 501  # header + ALL 500 matching rows, not the first display page
    assert "ciphertext" not in exported.text and "state_index" not in exported.text
    limited = api.get(BASE, headers=headers, params={"query": "Other", "limit": 2}).json()
    assert len(limited["items"]) == 2 and limited["nextCursor"]
    connection = db.connection()
    if connection:
        column_names = set(connection.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='doctor_directory'"
        )).scalars())
        assert not set(FIELDS["doctor_directory"]) & column_names
        row = connection.execute(text('SELECT * FROM doctor_directory WHERE id=:id'), {"id": rows[0]["id"]}).mappings().one()
        for field in FIELDS["doctor_directory"]:
            value = row[field + "_ciphertext"]
            assert value is None or value.startswith("v1:primary:")


@pytest.mark.parametrize("kind", ["key", "index"])
def test_mismatched_configuration_fails_before_read_or_write(client, monkeypatch, kind):
    api, db, _ = client
    headers, _ = populate(api, db)
    values = {"directory_encryption_keys": SecretStr('{"primary":"' + b64(b"F" * 32) + '"}')} if kind == "key" else {
        "directory_index_key": SecretStr(b64(b"R" * 32))}
    monkeypatch.setattr(directory_runtime, "get_settings", lambda: Settings(**values))
    for path in ("", "/references", "/filters", "/export"):
        response = api.get(BASE + path, headers=headers)
        assert response.status_code == 503
        assert response.headers["cache-control"] == "no-store"
        assert "Rare encrypted match" not in response.text and "v1:primary:" not in response.text


def test_cross_record_tamper_never_falls_back_to_unavailable_plaintext(client):
    api, db, _ = client
    headers, rows = populate(api, db)
    db.execute(text("UPDATE doctor_directory SET name_ciphertext=:value WHERE id=:id"),
               {"value": rows[0]["name_ciphertext"], "id": rows[1]["id"]})
    db.commit()
    for path, params in (("/" + str(rows[1]["id"]), {}), ("", {"query": "unmatched"}), ("/export", {"query": "unmatched"})):
        response = api.get(BASE + path, headers=headers, params=params)
        assert response.status_code == 503 and "v1:primary:" not in response.text
