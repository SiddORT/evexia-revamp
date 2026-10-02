import hashlib
import io
import os
import uuid

import pytest

from app.core.config import Settings
from app.services.storage import LocalStorage, S3Storage, get_storage, object_key


def make_settings(root=None, **overrides):
    values = {
        "database_url": "sqlite:///unused",
        "local_storage_root": str(root) if root else None,
        "max_upload_bytes": 1024,
        **overrides,
    }
    return Settings(**values)


def key(extension="pdf"):
    return object_key("patients", uuid.uuid4(), "documents", uuid.uuid4(), extension)


def test_object_keys_use_only_canonical_domain_identifiers():
    patient_id, file_id = uuid.uuid4(), uuid.uuid4()
    actual = object_key("patients", patient_id, "documents", file_id, "pdf")
    assert actual == f"patients/{patient_id}/documents/{file_id}.pdf"
    assert object_key("mrs", uuid.uuid4(), "profile", uuid.uuid4(), "jpg").startswith("mrs/")


@pytest.mark.parametrize(
    "arguments",
    [
        ("patients/../patients", uuid.uuid4(), "documents", uuid.uuid4(), "pdf"),
        ("Patient", uuid.uuid4(), "documents", uuid.uuid4(), "pdf"),
        ("patients", "../etc/passwd", "documents", uuid.uuid4(), "pdf"),
        ("patients", uuid.uuid4(), "reports", uuid.uuid4(), "pdf"),
        ("patients", uuid.uuid4(), "documents", uuid.uuid4(), "../pdf"),
        ("patients", uuid.uuid4(), "documents", "550E8400-E29B-41D4-A716-446655440000", "pdf"),
    ],
)
def test_object_key_rejects_unsafe_or_unapproved_components(arguments):
    with pytest.raises(ValueError):
        object_key(*arguments)


@pytest.mark.parametrize(
    "invalid",
    [
        "",
        "../patients/00000000-0000-0000-0000-000000000000/documents/"
        "00000000-0000-0000-0000-000000000000.pdf",
        "/patients/00000000-0000-0000-0000-000000000000/documents/"
        "00000000-0000-0000-0000-000000000000.pdf",
        "patients%2f00000000-0000-0000-0000-000000000000/documents/"
        "00000000-0000-0000-0000-000000000000.pdf",
        "patients\\00000000-0000-0000-0000-000000000000\\documents\\"
        "00000000-0000-0000-0000-000000000000.pdf",
    ],
)
def test_storage_rejects_manipulated_keys(tmp_path, invalid):
    storage = LocalStorage(make_settings(tmp_path / "private"))
    with pytest.raises(ValueError):
        storage.exists(invalid)


def test_local_storage_round_trips_checksum_metadata_and_deletes(tmp_path):
    storage = LocalStorage(make_settings(tmp_path / "private"))
    object_name = key("pdf")
    content = b"%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF\n"

    metadata = storage.put(object_name, io.BytesIO(content), "application/pdf")
    assert metadata.content_type == "application/pdf"
    assert metadata.size == len(content)
    assert metadata.checksum == hashlib.sha256(content).hexdigest()
    assert storage.exists(object_name)
    assert storage.head(object_name) == metadata
    with storage.get(object_name) as downloaded:
        assert downloaded.read() == content

    storage.delete(object_name)
    assert not storage.exists(object_name)
    with pytest.raises(FileNotFoundError):
        storage.get(object_name)


def test_local_delete_is_idempotent_when_parent_or_object_is_missing(tmp_path):
    storage = LocalStorage(make_settings(tmp_path / "private"))
    object_name = key("pdf")
    storage.delete(object_name)  # Parent directory does not exist.
    storage.put(object_name, io.BytesIO(b"%PDF-1.4\n%%EOF\n"), "application/pdf")
    storage.delete(object_name)
    storage.delete(object_name)  # Parent exists, object does not.
    assert not storage.exists(object_name)


def test_local_storage_is_private_and_immutable(tmp_path):
    root = tmp_path / "private"
    storage = LocalStorage(make_settings(root))
    object_name = key("pdf")
    content = b"%PDF-1.4\n%%EOF\n"
    storage.put(object_name, io.BytesIO(content), "application/pdf")

    assert root.stat().st_mode & 0o777 == 0o700
    assert root.joinpath(*object_name.split("/")).stat().st_mode & 0o777 == 0o600
    with pytest.raises(FileExistsError):
        storage.put(object_name, io.BytesIO(content), "application/pdf")
    with storage.get(object_name) as downloaded:
        assert downloaded.read() == content


def test_local_storage_never_changes_existing_ancestor_permissions(tmp_path):
    root = tmp_path / "new-parent" / "private"
    ancestors = [tmp_path, tmp_path.parent, tmp_path.parent.parent, tmp_path.parent.parent.parent]
    before = {
        ancestor: (ancestor.stat().st_uid, ancestor.stat().st_mode & 0o7777)
        for ancestor in ancestors
    }

    LocalStorage(make_settings(root))

    after = {
        ancestor: (ancestor.stat().st_uid, ancestor.stat().st_mode & 0o7777)
        for ancestor in ancestors
    }
    assert after == before


def test_local_storage_rejects_existing_public_root_without_chmod(tmp_path):
    exposed_root = tmp_path / "public-root"
    exposed_root.mkdir(mode=0o755)
    exposed_root.chmod(0o755)

    with pytest.raises(ValueError, match="private 0700"):
        LocalStorage(make_settings(exposed_root))
    assert exposed_root.stat().st_mode & 0o777 == 0o755


def test_local_storage_rejects_insecure_subdirectories_hardlinks_and_fifos(tmp_path):
    root = tmp_path / "private"
    storage = LocalStorage(make_settings(root))
    object_name = key("pdf")
    storage.put(object_name, io.BytesIO(b"%PDF-1.4\n%%EOF\n"), "application/pdf")
    patient_dir = root / object_name.split("/")[0]
    patient_dir.chmod(0o755)
    with pytest.raises(ValueError, match="private 0700"):
        storage.get(object_name)
    assert patient_dir.stat().st_mode & 0o777 == 0o755
    patient_dir.chmod(0o700)

    object_path = root.joinpath(*object_name.split("/"))
    external_link = tmp_path / "hardlink.pdf"
    os.link(object_path, external_link)
    with pytest.raises(ValueError, match="singly linked"):
        storage.get(object_name)
    external_link.unlink()

    object_path.unlink()
    os.mkfifo(object_path)
    with pytest.raises(ValueError, match="singly linked regular file"):
        storage.get(object_name)


def test_local_storage_rejects_oversize_and_type_mismatch_without_publish(tmp_path):
    storage = LocalStorage(make_settings(tmp_path / "private", max_upload_bytes=8))
    object_name = key("pdf")
    with pytest.raises(ValueError, match="upload limit"):
        storage.put(object_name, io.BytesIO(b"%PDF-1.4 too large"), "application/pdf")
    assert not storage.exists(object_name)
    with pytest.raises(ValueError, match="does not match"):
        storage.put(key("png"), io.BytesIO(b"\x89PNG"), "application/pdf")


def test_local_storage_refuses_symlinked_directory_and_object(tmp_path):
    root = tmp_path / "private"
    storage = LocalStorage(make_settings(root))
    object_name = key("pdf")
    outside = tmp_path / "outside"
    outside.mkdir()
    patient_directory = root / object_name.split("/")[0]
    patient_directory.symlink_to(outside, target_is_directory=True)
    with pytest.raises(OSError):
        storage.put(object_name, io.BytesIO(b"%PDF-1.4\n%%EOF\n"), "application/pdf")

    patient_directory.unlink()
    storage.put(object_name, io.BytesIO(b"%PDF-1.4\n%%EOF\n"), "application/pdf")
    target = root.joinpath(*object_name.split("/"))
    target.unlink()
    target.symlink_to(outside / "secret")
    with pytest.raises(OSError):
        storage.get(object_name)


def test_local_storage_requires_explicit_absolute_root(tmp_path):
    with pytest.raises(RuntimeError, match="must be configured"):
        get_storage(make_settings())
    with pytest.raises(ValueError):
        LocalStorage(make_settings("relative-storage-root"))
    (tmp_path / "real-directory").mkdir()
    (tmp_path / "link").symlink_to(tmp_path / "real-directory", target_is_directory=True)
    with pytest.raises(OSError):
        LocalStorage(make_settings(tmp_path / "link" / "root"))


class FakeS3:
    def __init__(self):
        self.objects = {}
        self.put_arguments = None
        self.body = None
        self.reported_length = None
        self.presign_arguments = None

    def put_object(self, **kwargs):
        self.put_arguments = kwargs
        content = kwargs["Body"].read()
        self.objects[kwargs["Key"]] = {
            "content": content,
            "ContentType": kwargs["ContentType"],
            "Metadata": kwargs["Metadata"],
        }

    def head_object(self, **kwargs):
        stored = self.objects[kwargs["Key"]]
        return {
            "ContentLength": len(stored["content"]),
            "ContentType": stored["ContentType"],
            "Metadata": stored["Metadata"],
            # ETag is intentionally not used as a content checksum.
            "ETag": '"not-a-sha256"',
        }

    def get_object(self, **kwargs):
        stored = self.objects[kwargs["Key"]]
        self.body = io.BytesIO(stored["content"])
        reported_length = self.reported_length
        if reported_length is None:
            reported_length = len(stored["content"])
        return {"Body": self.body, "ContentLength": reported_length}

    def delete_object(self, **kwargs):
        del self.objects[kwargs["Key"]]

    def generate_presigned_url(self, operation, *, Params, ExpiresIn):
        self.presign_arguments = {
            "operation": operation,
            "Params": Params,
            "ExpiresIn": ExpiresIn,
        }
        return f"https://s3.test/{Params['Key']}?operation={operation}&expires={ExpiresIn}"


def test_s3_adapter_preserves_key_and_uses_sha256_not_etag():
    client = FakeS3()
    storage = S3Storage(
        make_settings(
            storage_backend="s3",
            s3_bucket="private-test-bucket",
            s3_region="us-east-1",
        ),
        client=client,
    )
    object_name = key("png")
    content = b"\x89PNG\r\n\x1a\n" + b"test"

    result = storage.put(object_name, io.BytesIO(content), "image/png")
    assert client.put_arguments["Key"] == object_name
    assert client.put_arguments["IfNoneMatch"] == "*"
    assert result.checksum == hashlib.sha256(content).hexdigest()
    assert storage.head(object_name) == result
    stream = storage.get(object_name)
    assert stream.read() == content
    assert stream.closed
    assert client.body.closed
    download_url = storage.download_link(object_name, 120)
    assert download_url.startswith("https://s3.test/")
    assert client.presign_arguments == {
        "operation": "get_object",
        "Params": {
            "Bucket": "private-test-bucket",
            "Key": object_name,
            "ResponseContentDisposition": f'attachment; filename="{object_name.rsplit("/", 1)[1]}"',
            "ResponseContentType": "image/png",
        },
        "ExpiresIn": 120,
    }
    with pytest.raises(ValueError):
        storage.download_link(object_name, 901)


def test_s3_adapter_enforces_actual_stream_size_and_closes_oversized_body():
    client = FakeS3()
    storage = S3Storage(
        make_settings(
            storage_backend="s3",
            s3_bucket="private-test-bucket",
            s3_region="us-east-1",
            max_upload_bytes=4,
        ),
        client=client,
    )
    with pytest.raises(ValueError, match="upload limit"):
        storage.put(key("pdf"), io.BytesIO(b"%PDF-"), "application/pdf")
    assert not client.objects

    object_name = key("pdf")
    client.objects[object_name] = {
        "content": b"12345",
        "ContentType": "application/pdf",
        "Metadata": {"sha256": hashlib.sha256(b"12345").hexdigest()},
    }
    client.reported_length = 4  # The body reader must not trust a provider's claimed length.
    stream = storage.get(object_name)
    with pytest.raises(ValueError, match="download limit"):
        stream.read()
    assert stream.closed
    assert client.body.closed


def test_s3_adapter_requires_persisted_sha256_metadata():
    client = FakeS3()
    storage = S3Storage(
        make_settings(
            storage_backend="s3",
            s3_bucket="private-test-bucket",
            s3_region="us-east-1",
        ),
        client=client,
    )
    object_name = key("pdf")
    client.objects[object_name] = {
        "content": b"%PDF-1.4\n%%EOF\n",
        "ContentType": "application/pdf",
        "Metadata": {},
    }
    with pytest.raises(ValueError, match="SHA-256"):
        storage.head(object_name)