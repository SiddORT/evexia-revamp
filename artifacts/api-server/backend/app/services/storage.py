"""Private, immutable object storage adapters with backend-neutral logical keys."""

from __future__ import annotations

import hashlib
import os
import re
import stat
import tempfile
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import BinaryIO

from app.core.config import Settings

_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
_KEY = re.compile(
    rf"^(patients|mrs)/({_UUID})/(profile|documents)/({_UUID})\.(jpg|jpeg|png|pdf)$"
)
_CONTENT_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "pdf": "application/pdf",
}
_CHUNK_SIZE = 1024 * 1024
_DIR_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
_FILE_FLAGS = (
    os.O_RDONLY
    | getattr(os, "O_NOFOLLOW", 0)
    | getattr(os, "O_NONBLOCK", 0)
)


def _canonical_uuid(value: uuid.UUID | str) -> str:
    try:
        parsed = value if isinstance(value, uuid.UUID) else uuid.UUID(value)
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("UUID values must be canonical UUIDs") from exc
    rendered = str(parsed)
    if isinstance(value, str) and value != rendered:
        raise ValueError("UUID values must be canonical lowercase UUIDs")
    return rendered


def object_key(
    owner_type: str,
    owner_uuid: uuid.UUID | str,
    category: str,
    file_uuid: uuid.UUID | str,
    extension: str,
) -> str:
    """Create a canonical, backend-independent key from trusted identifiers."""
    if owner_type not in ("patients", "mrs"):
        raise ValueError("Owner type must be patients or mrs")
    if category not in ("profile", "documents"):
        raise ValueError("Category must be profile or documents")
    if extension not in _CONTENT_TYPES:
        raise ValueError("Unsupported file extension")
    return (
        f"{owner_type}/{_canonical_uuid(owner_uuid)}/{category}/"
        f"{_canonical_uuid(file_uuid)}.{extension}"
    )


def _validate_key(key: str) -> tuple[str, str]:
    if not isinstance(key, str) or not _KEY.fullmatch(key):
        raise ValueError("Invalid logical object key")
    match = _KEY.fullmatch(key)
    assert match is not None
    return match.group(5), match.group(4)


def _validate_upload_type(extension: str, content_type: str) -> None:
    if _CONTENT_TYPES[extension] != content_type:
        raise ValueError("Content type does not match the object-key extension")


@dataclass(frozen=True)
class ObjectMetadata:
    content_type: str
    size: int
    checksum: str


class StorageService(ABC):
    @abstractmethod
    def put(self, key: str, stream: BinaryIO, content_type: str) -> ObjectMetadata: ...

    @abstractmethod
    def get(self, key: str) -> BinaryIO: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def head(self, key: str) -> ObjectMetadata: ...

    @abstractmethod
    def download_link(self, key: str, expires: int) -> str: ...


def _copy_bounded(stream: BinaryIO, destination: BinaryIO, max_bytes: int) -> tuple[int, str]:
    checksum = hashlib.sha256()
    size = 0
    while True:
        chunk = stream.read(min(_CHUNK_SIZE, max_bytes + 1 - size))
        if not chunk:
            break
        if not isinstance(chunk, bytes):
            raise TypeError("Storage input must be a binary stream")
        size += len(chunk)
        if size > max_bytes:
            raise ValueError("File exceeds the configured upload limit")
        destination.write(chunk)
        checksum.update(chunk)
    if size == 0:
        raise ValueError("Empty files are not accepted")
    return size, checksum.hexdigest()


class LocalStorage(StorageService):
    """Local adapter using dirfd-relative operations and no-follow semantics."""

    def __init__(self, settings: Settings):
        root = settings.local_storage_root
        if not root:
            raise RuntimeError("LOCAL_STORAGE_ROOT must be configured before using local storage")
        if not os.path.isabs(root) or os.path.normpath(root) != root:
            raise ValueError("LOCAL_STORAGE_ROOT must be an absolute normalized path")
        if root == "/":
            raise ValueError("LOCAL_STORAGE_ROOT cannot be the filesystem root")
        self.root = root
        self.max_bytes = settings.max_upload_bytes
        root_fd = self._open_root(create=True)
        os.close(root_fd)

    @staticmethod
    def _open_child_directory(parent_fd: int, name: str, *, create: bool) -> tuple[int, bool]:
        created = False
        expected_identity = None
        try:
            child_fd = os.open(name, _DIR_FLAGS, dir_fd=parent_fd)
        except FileNotFoundError:
            if not create:
                raise
            try:
                os.mkdir(name, 0o700, dir_fd=parent_fd)
                created = True
                created_info = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
                expected_identity = (created_info.st_dev, created_info.st_ino)
            except FileExistsError:
                pass
            child_fd = os.open(name, _DIR_FLAGS, dir_fd=parent_fd)

        if created:
            created_info = os.fstat(child_fd)
            if (
                not stat.S_ISDIR(created_info.st_mode)
                or created_info.st_uid != os.geteuid()
                or expected_identity != (created_info.st_dev, created_info.st_ino)
            ):
                os.close(child_fd)
                raise ValueError("New storage directory has unexpected ownership, type, or identity")
            # mkdir uses 0700; fchmod only repairs permissions on the verified new inode.
            try:
                os.fchmod(child_fd, 0o700)
            except BaseException:
                os.close(child_fd)
                raise
        return child_fd, created

    def _open_root(self, *, create: bool) -> int:
        fd = os.open("/", _DIR_FLAGS)
        try:
            components = [part for part in self.root.split("/") if part]
            for index, component in enumerate(components):
                is_root = index == len(components) - 1
                child, _ = self._open_child_directory(fd, component, create=create)
                if is_root:
                    try:
                        self._validate_private_directory(child, "LOCAL_STORAGE_ROOT")
                    except BaseException:
                        os.close(child)
                        raise
                os.close(fd)
                fd = child
            return fd
        except BaseException:
            os.close(fd)
            raise

    @staticmethod
    def _validate_private_directory(fd: int, label: str) -> None:
        info = os.fstat(fd)
        if (
            not stat.S_ISDIR(info.st_mode)
            or info.st_uid != os.geteuid()
            or info.st_mode & 0o077
            or info.st_mode & 0o700 != 0o700
        ):
            raise ValueError(f"{label} must be owned by the application user with private 0700 permissions")

    def _parent(self, key: str, *, create: bool) -> tuple[int, str, str]:
        extension, _ = _validate_key(key)
        components = key.split("/")
        fd = self._open_root(create=False)
        try:
            for component in components[:-1]:
                child, _ = self._open_child_directory(fd, component, create=create)
                try:
                    self._validate_private_directory(child, "Storage object directory")
                except BaseException:
                    os.close(child)
                    raise
                os.close(fd)
                fd = child
            return fd, components[-1], extension
        except BaseException:
            os.close(fd)
            raise

    @staticmethod
    def _open_regular(parent_fd: int, name: str) -> int:
        fd = os.open(name, _FILE_FLAGS, dir_fd=parent_fd)
        info = os.fstat(fd)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.geteuid()
            or info.st_mode & 0o077
            or info.st_nlink != 1
        ):
            os.close(fd)
            raise ValueError("Stored object must be a private, singly linked regular file")
        return fd

    def put(self, key: str, stream: BinaryIO, content_type: str) -> ObjectMetadata:
        extension, _ = _validate_key(key)
        _validate_upload_type(extension, content_type)
        parent_fd, target, _ = self._parent(key, create=True)
        temporary_name = f".tmp-{uuid.uuid4().hex}"
        temp_fd = -1
        try:
            temp_fd = os.open(
                temporary_name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                0o600,
                dir_fd=parent_fd,
            )
            os.fchmod(temp_fd, 0o600)
            with os.fdopen(temp_fd, "wb") as destination:
                temp_fd = -1
                size, checksum = _copy_bounded(stream, destination, self.max_bytes)
                destination.flush()
                os.fsync(destination.fileno())
            # Hard-link publication is atomic and fails rather than replacing an object.
            os.link(
                temporary_name,
                target,
                src_dir_fd=parent_fd,
                dst_dir_fd=parent_fd,
                follow_symlinks=False,
            )
            os.unlink(temporary_name, dir_fd=parent_fd)
            os.fsync(parent_fd)
            return ObjectMetadata(content_type, size, checksum)
        except FileExistsError as exc:
            raise FileExistsError("Storage objects are immutable and cannot be overwritten") from exc
        finally:
            if temp_fd >= 0:
                os.close(temp_fd)
            try:
                os.unlink(temporary_name, dir_fd=parent_fd)
            except FileNotFoundError:
                pass
            os.close(parent_fd)

    def get(self, key: str) -> BinaryIO:
        parent_fd, target, _ = self._parent(key, create=False)
        try:
            fd = self._open_regular(parent_fd, target)
            if os.fstat(fd).st_size > self.max_bytes:
                os.close(fd)
                raise ValueError("Stored object exceeds the configured download limit")
            return os.fdopen(fd, "rb")
        finally:
            os.close(parent_fd)

    def delete(self, key: str) -> None:
        try:
            parent_fd, target, _ = self._parent(key, create=False)
        except FileNotFoundError:
            return
        try:
            try:
                os.unlink(target, dir_fd=parent_fd)
            except FileNotFoundError:
                return
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)

    def exists(self, key: str) -> bool:
        try:
            parent_fd, target, _ = self._parent(key, create=False)
        except FileNotFoundError:
            return False
        try:
            try:
                fd = self._open_regular(parent_fd, target)
            except FileNotFoundError:
                return False
            os.close(fd)
            return True
        finally:
            os.close(parent_fd)

    def head(self, key: str) -> ObjectMetadata:
        extension, _ = _validate_key(key)
        parent_fd, target, _ = self._parent(key, create=False)
        try:
            fd = self._open_regular(parent_fd, target)
            with os.fdopen(fd, "rb") as source:
                checksum = hashlib.sha256()
                size = 0
                while True:
                    chunk = source.read(_CHUNK_SIZE)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > self.max_bytes:
                        raise ValueError("Stored object exceeds the configured download limit")
                    checksum.update(chunk)
            return ObjectMetadata(_CONTENT_TYPES[extension], size, checksum.hexdigest())
        finally:
            os.close(parent_fd)

    def download_link(self, key: str, expires: int) -> str:
        _validate_key(key)
        raise NotImplementedError("Local storage does not issue direct download links")


class _BoundedS3Reader:
    """Close the provider stream on EOF, explicit close, or a size violation."""

    def __init__(self, body: BinaryIO, max_bytes: int):
        self._body = body
        self._max_bytes = max_bytes
        self._read_bytes = 0
        self._closed = False

    def read(self, size: int = -1) -> bytes:
        if self._closed:
            return b""
        remaining = self._max_bytes - self._read_bytes
        request_size = remaining + 1 if size < 0 else min(size, remaining + 1)
        data = self._body.read(request_size)
        self._read_bytes += len(data)
        if self._read_bytes > self._max_bytes:
            self.close()
            raise ValueError("Stored object exceeds the configured download limit")
        if not data or (size < 0 and len(data) < request_size):
            self.close()
        return data

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self._body.close()

    @property
    def closed(self) -> bool:
        return self._closed

    def __enter__(self) -> _BoundedS3Reader:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


class S3Storage(StorageService):
    def __init__(self, settings: Settings, client=None):
        if not settings.s3_bucket or not settings.s3_region:
            raise RuntimeError("S3 bucket and region must be configured before using storage")
        if settings.s3_endpoint_url and not settings.s3_endpoint_url.startswith("https://"):
            raise ValueError("S3 endpoint must use HTTPS")
        self.bucket = settings.s3_bucket
        self.max_bytes = settings.max_upload_bytes
        if client is None:
            import boto3
            from botocore.config import Config

            client_kwargs = {
                "region_name": settings.s3_region,
                "config": Config(signature_version="s3v4", retries={"max_attempts": 3}),
            }
            if settings.s3_endpoint_url:
                client_kwargs["endpoint_url"] = settings.s3_endpoint_url
            if settings.aws_access_key_id and settings.aws_secret_access_key:
                client_kwargs["aws_access_key_id"] = settings.aws_access_key_id.get_secret_value()
                client_kwargs["aws_secret_access_key"] = settings.aws_secret_access_key.get_secret_value()
            client = boto3.client("s3", **client_kwargs)
        self.client = client

    @staticmethod
    def _not_found(exc: Exception) -> bool:
        from botocore.exceptions import ClientError

        if not isinstance(exc, ClientError):
            return False
        error = exc.response.get("Error", {}).get("Code")
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        return status == 404 or error in ("404", "NoSuchKey", "NotFound")

    def put(self, key: str, stream: BinaryIO, content_type: str) -> ObjectMetadata:
        extension, _ = _validate_key(key)
        _validate_upload_type(extension, content_type)
        with tempfile.SpooledTemporaryFile(max_size=min(self.max_bytes, 1024 * 1024), mode="w+b") as staged:
            size, checksum = _copy_bounded(stream, staged, self.max_bytes)
            staged.seek(0)
            self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=staged,
                ContentLength=size,
                ContentType=content_type,
                Metadata={"sha256": checksum},
                ServerSideEncryption="AES256",
                IfNoneMatch="*",
            )
        return ObjectMetadata(content_type, size, checksum)

    def get(self, key: str) -> BinaryIO:
        _validate_key(key)
        try:
            result = self.client.get_object(Bucket=self.bucket, Key=key)
        except Exception as exc:
            if self._not_found(exc):
                raise FileNotFoundError(key) from exc
            raise
        body = result["Body"]
        if result.get("ContentLength", 0) > self.max_bytes:
            body.close()
            raise ValueError("Stored object exceeds the configured download limit")
        return _BoundedS3Reader(body, self.max_bytes)

    def delete(self, key: str) -> None:
        _validate_key(key)
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def exists(self, key: str) -> bool:
        _validate_key(key)
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception as exc:
            if self._not_found(exc):
                return False
            raise

    def head(self, key: str) -> ObjectMetadata:
        extension, _ = _validate_key(key)
        try:
            result = self.client.head_object(Bucket=self.bucket, Key=key)
        except Exception as exc:
            if self._not_found(exc):
                raise FileNotFoundError(key) from exc
            raise
        content_type = result.get("ContentType")
        checksum = result.get("Metadata", {}).get("sha256")
        size = result.get("ContentLength")
        if content_type != _CONTENT_TYPES[extension] or not isinstance(size, int) or size < 0:
            raise ValueError("S3 object metadata does not match its logical key")
        if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
            raise ValueError("S3 object is missing its SHA-256 checksum metadata")
        if size > self.max_bytes:
            raise ValueError("Stored object exceeds the configured download limit")
        return ObjectMetadata(content_type, size, checksum)

    def download_link(self, key: str, expires: int) -> str:
        extension, file_uuid = _validate_key(key)
        if not 1 <= expires <= 900:
            raise ValueError("Download-link expiry must be between 1 and 900 seconds")
        generated_filename = f"{file_uuid}.{extension}"
        return self.client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self.bucket,
                "Key": key,
                "ResponseContentDisposition": f'attachment; filename="{generated_filename}"',
                "ResponseContentType": _CONTENT_TYPES[extension],
            },
            ExpiresIn=expires,
        )


def get_storage(settings: Settings) -> StorageService:
    if settings.storage_backend == "local":
        return LocalStorage(settings)
    if settings.storage_backend == "s3":
        return S3Storage(settings)
    raise ValueError("Unsupported storage backend")