import uuid

import pytest

from app.services.storage import S3Storage, object_key


def test_object_keys_are_tenant_scoped_and_ignore_client_paths():
    tenant, entity = uuid.uuid4(), uuid.uuid4()
    key = object_key("development", tenant, "patients", "patient", entity, "reports", "../tricky.pdf")
    assert key.startswith(f"development/{tenant}/patients/patient/{entity}/reports/")
    assert ".." not in key
    assert key.endswith("-tricky.pdf")


def test_object_keys_reject_unsafe_segments():
    with pytest.raises(ValueError):
        object_key("development", uuid.uuid4(), "../other", "patient", uuid.uuid4(), "reports", "x.pdf")


def test_upload_rejects_mismatched_content_type():
    storage = object.__new__(S3Storage)
    storage.max_bytes = 1024
    with pytest.raises(ValueError):
        storage.upload("development/tenant/report", b"not a pdf", "application/pdf")