"""Replaceable S3-compatible storage boundary. No local persistent fallback."""
import io
import re
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass

import boto3
from botocore.config import Config

from app.core.config import Settings

SEGMENT = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")


def object_key(environment: str, tenant_id: uuid.UUID, module: str, entity_type: str,
               entity_id: uuid.UUID, category: str, filename: str) -> str:
    for value in (environment, module, entity_type, category):
        if not SEGMENT.fullmatch(value):
            raise ValueError("Invalid storage category")
    # Deliberately discard any client-supplied directory and control characters.
    cleaned = re.sub(r"[^a-zA-Z0-9._-]", "-", filename.replace("\\", "/").split("/")[-1])
    cleaned = cleaned.strip(".-")[:80] or "file"
    return f"{environment}/{tenant_id}/{module}/{entity_type}/{entity_id}/{category}/{uuid.uuid4()}-{cleaned}"


@dataclass(frozen=True)
class ObjectMetadata:
    content_type: str
    size: int
    etag: str


class StorageService(ABC):
    @abstractmethod
    def upload(self, key: str, content: bytes, content_type: str) -> None: ...

    @abstractmethod
    def download(self, key: str) -> bytes: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def get_object_metadata(self, key: str) -> ObjectMetadata: ...

    @abstractmethod
    def generate_presigned_upload_url(self, key: str, content_type: str, expires: int = 300) -> str: ...

    @abstractmethod
    def generate_presigned_download_url(self, key: str, expires: int = 300) -> str: ...


class S3Storage(StorageService):
    def __init__(self, settings: Settings):
        if not settings.s3_bucket or not settings.s3_region:
            raise RuntimeError("S3 bucket and region must be configured before using storage")
        if settings.s3_endpoint_url and not settings.s3_endpoint_url.startswith("https://"):
            raise ValueError("S3 endpoint must use HTTPS")
        self.bucket = settings.s3_bucket
        self.max_bytes = settings.max_upload_bytes
        client_kwargs = {
            "region_name": settings.s3_region,
            "config": Config(signature_version="s3v4", retries={"max_attempts": 3}),
        }
        if settings.s3_endpoint_url:
            client_kwargs["endpoint_url"] = settings.s3_endpoint_url
        if settings.aws_access_key_id and settings.aws_secret_access_key:
            client_kwargs["aws_access_key_id"] = settings.aws_access_key_id.get_secret_value()
            client_kwargs["aws_secret_access_key"] = settings.aws_secret_access_key.get_secret_value()
        self.client = boto3.client("s3", **client_kwargs)

    @staticmethod
    def _validate_key(key: str) -> None:
        if not key or len(key) > 1024 or ".." in key.split("/") or key.startswith("/") or "\\" in key:
            raise ValueError("Invalid object key")

    def upload(self, key: str, content: bytes, content_type: str) -> None:
        self._validate_key(key)
        if not content or len(content) > self.max_bytes:
            raise ValueError("File size is outside the allowed range")
        signatures = {
            "image/jpeg": b"\xff\xd8\xff",
            "image/png": b"\x89PNG\r\n\x1a\n",
            "application/pdf": b"%PDF-",
        }
        if content_type not in signatures or not content.startswith(signatures[content_type]):
            raise ValueError("File type not allowed")
        # A future upload route must additionally authorize the object and scan content.
        self.client.upload_fileobj(
            io.BytesIO(content), self.bucket, key,
            ExtraArgs={"ContentType": content_type, "ServerSideEncryption": "AES256"},
        )

    def download(self, key: str) -> bytes:
        self._validate_key(key)
        obj = self.client.get_object(Bucket=self.bucket, Key=key)
        if obj["ContentLength"] > self.max_bytes:
            raise ValueError("File exceeds download limit")
        content = obj["Body"].read(self.max_bytes + 1)
        if len(content) > self.max_bytes:
            raise ValueError("File exceeds download limit")
        return content

    def delete(self, key: str) -> None:
        self._validate_key(key)
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError
        self._validate_key(key)
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as exc:
            if exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 404:
                return False
            raise

    def get_object_metadata(self, key: str) -> ObjectMetadata:
        self._validate_key(key)
        result = self.client.head_object(Bucket=self.bucket, Key=key)
        return ObjectMetadata(result["ContentType"], result["ContentLength"], result["ETag"])

    def generate_presigned_upload_url(self, key: str, content_type: str, expires: int = 300) -> str:
        self._validate_key(key)
        if not 1 <= expires <= 900 or content_type not in ("image/jpeg", "image/png", "application/pdf"):
            raise ValueError("Invalid upload parameters")
        # Do not expose this until a separate endpoint verifies magic bytes after upload.
        return self.client.generate_presigned_url(
            "put_object", Params={"Bucket": self.bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=expires,
        )

    def generate_presigned_download_url(self, key: str, expires: int = 300) -> str:
        self._validate_key(key)
        if not 1 <= expires <= 900:
            raise ValueError("Invalid expiration")
        return self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=expires,
        )