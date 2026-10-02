"""Authoritative ownership and recoverable object/database lifecycle."""
import hashlib
import secrets
import uuid
from datetime import timedelta
from tempfile import SpooledTemporaryFile

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import token_digest, utcnow
from app.db.file_models import DownloadGrant, FileRecord
from app.db.models import AuditEvent
from app.schemas.files import FileResponse
from app.services.auth import AuthError, limit_state, record_attempt
from app.services.file_policy import FileError, authorize
from app.services.storage import object_key
from app.services.verification import validated_extension, verify

MIME_TYPES = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "pdf": "application/pdf"}
INACCESSIBLE = frozenset({"pending_delete", "deleted", "rejected"})


def event(db, identity, request_id, action, file_id, outcome):
    db.add(AuditEvent(
        actor_id=identity.user.id, action=f"file_{action}", resource_type="file",
        resource_id=file_id, request_id=request_id, outcome=outcome,
    ))


def quota(db, identity, settings):
    key, blocked = limit_state(db, settings, "file-operation", str(identity.user.id), settings.file_rate_limit)
    if blocked:
        db.rollback()
        raise FileError(429, "file_rate_limit", "Too many file operations; retry later")
    record_attempt(db, key)
    db.commit()


def get_record(db: Session, identity, file_id, action, *, lock=False, readable=False, allow_hidden=False):
    # Fetch only DB metadata first. Never infer permission from the key.
    row = db.scalar(select(FileRecord).where(FileRecord.id == file_id).execution_options(populate_existing=True))
    if not row:
        raise FileError(404, "not_found", "Object unavailable")
    authorize(db, identity, action, row.patient_id, row.mr_id, lock=lock)
    if lock:
        row = db.scalar(select(FileRecord).where(FileRecord.id == file_id).with_for_update().execution_options(populate_existing=True))
    if not allow_hidden and row.state in INACCESSIBLE:
        raise FileError(404, "not_found", "Object unavailable")
    if readable and (row.state != "verified" or row.scanner_status != "clean"):
        raise FileError(409, "file_not_verified", "File is not available for download")
    return row


def response(row):
    return FileResponse.model_validate(row)


def reserve(db, identity, body, content_type, settings, request_id, *, replaces_id=None, expected_version=None):
    try:
        ext = validated_extension(body.filename)
    except ValueError:
        raise FileError(415, "invalid_filename", "File name is not allowed") from None
    if MIME_TYPES[ext] != content_type or (body.category == "profile" and ext == "pdf"):
        raise FileError(415, "unsupported_type", "File type is not allowed")
    authorize(db, identity, "replace" if replaces_id else "upload", body.patient_id, body.mr_id, lock=True)
    if replaces_id:
        original = get_record(db, identity, replaces_id, "replace", lock=True, readable=True)
        if original.version != expected_version:
            raise FileError(409, "version_conflict", "File has changed")
    file_id = uuid.uuid4()
    row = FileRecord(
        id=file_id, patient_id=body.patient_id, mr_id=body.mr_id,
        category=body.category, display_name=body.filename, content_type=content_type,
        object_key=object_key("patients" if body.patient_id else "mrs", body.patient_id or body.mr_id, body.category, file_id, ext),
        uploader_id=identity.user.id, state="uploading",
        replaces_id=replaces_id, replaces_version=expected_version,
    )
    db.add(row)
    event(db, identity, request_id, "upload_reserved", file_id, "success")
    db.commit()
    return file_id


def interrupted(db, file_id, identity, request_id):
    db.rollback()
    row = db.scalar(select(FileRecord).where(FileRecord.id == file_id).with_for_update())
    if row and row.state == "uploading":
        row.state = "pending_delete"
        row.version += 1
        event(db, identity, request_id, "upload_interrupted", file_id, "failure")
        db.commit()


def complete_upload(db, identity, file_id, stream, settings, storage, request_id):
    row = get_record(db, identity, file_id, "replace" if db.get(FileRecord, file_id).replaces_id else "upload")
    name, media, key = row.display_name, row.content_type, row.object_key
    db.rollback()  # Never retain read transactions/row locks through slow I/O.
    if callable(storage):
        storage = storage()
    try:
        verified = verify(stream, name, media, settings)
    except ValueError:
        row = db.scalar(select(FileRecord).where(FileRecord.id == file_id).with_for_update())
        row.state, row.scanner_status = "rejected", "error"
        row.version += 1
        event(db, identity, request_id, "format", file_id, "failure")
        db.commit()
        raise FileError(415, "invalid_file", "File validation failed") from None
    # Missing scanner still stores a private quarantined object, never readable.
    try:
        meta = storage.put(key, stream, media)
        if (meta.size, meta.checksum, meta.content_type) != (verified.size, verified.checksum, verified.content_type):
            raise ValueError("Adapter metadata mismatch")
    except Exception:
        interrupted(db, file_id, identity, request_id)
        raise FileError(503, "storage_write_failed", "Storage write failed; cleanup is pending") from None
    return publish(db, identity, file_id, verified, request_id)


def publish(db, identity, file_id, verified, request_id):
    try:
        row = get_record(db, identity, file_id, "replace" if db.get(FileRecord, file_id).replaces_id else "upload", lock=True)
        if row.state not in ("uploading", "quarantined"):
            raise FileError(409, "state_conflict", "File state has changed")
        row.size, row.checksum, row.scanner_status = verified.size, verified.checksum, verified.scanner_status
        row.state = "verified" if verified.scanner_status == "clean" else (
            "rejected" if verified.scanner_status == "infected" else "quarantined"
        )
        if row.replaces_id and row.state == "verified":
            original = get_record(db, identity, row.replaces_id, "replace", lock=True, readable=True)
            if original.version != row.replaces_version:
                raise FileError(409, "version_conflict", "Original file has changed")
            original.state = "pending_delete"
            original.version += 1
        row.version += 1
        event(db, identity, request_id, "verification", file_id, "success" if row.state == "verified" else "failure")
        db.commit()
        return response(row)
    except Exception:
        # A committed reservation identifies any object left by failed publication.
        # Do not invoke an adapter following failed live authorization.
        db.rollback()
        row = db.scalar(select(FileRecord).where(FileRecord.id == file_id).with_for_update())
        if row and row.state in ("uploading", "quarantined"):
            row.state = "pending_delete"
            row.version += 1
            event(db, identity, request_id, "publication", file_id, "failure")
            db.commit()
        raise


def delete_file(db, identity, file_id, storage, request_id, *, expected_version=None):
    row = get_record(db, identity, file_id, "delete", lock=True, allow_hidden=True)
    if expected_version is not None and row.version != expected_version:
        raise FileError(409, "version_conflict", "File has changed")
    if row.state == "deleted":
        db.rollback()
        return response(row)
    key = row.object_key
    row.state = "pending_delete"
    row.version += 1
    event(db, identity, request_id, "delete_requested", file_id, "success")
    db.commit()
    try:
        storage.delete(key)
    except Exception:
        event(db, identity, request_id, "delete_object", file_id, "failure")
        db.commit()
        raise FileError(503, "delete_pending", "Object cleanup is pending; retry deletion") from None
    row = db.scalar(select(FileRecord).where(FileRecord.id == file_id).with_for_update().execution_options(populate_existing=True))
    row.state = "deleted"
    row.version += 1
    event(db, identity, request_id, "delete_object", file_id, "success")
    db.commit()
    return response(row)


def recover(db, identity, file_id, settings, storage, request_id):
    row = get_record(db, identity, file_id, "recover", allow_hidden=True)
    state, key, name, media = row.state, row.object_key, row.display_name, row.content_type
    db.rollback()
    if state in ("pending_delete", "rejected", "uploading"):
        # An interrupted uploading reservation is never automatically published.
        return delete_file(db, identity, file_id, storage, request_id)
    if state == "deleted":
        return response(db.get(FileRecord, file_id))
    if state != "quarantined":
        raise FileError(409, "state_conflict", "Only quarantined files can be reverified")
    try:
        with storage.get(key) as stream:
            verified = verify(stream, name, media, settings)
    except ValueError:
        row = db.get(FileRecord, file_id)
        row.state = "rejected"
        row.scanner_status = "error"
        row.version += 1
        event(db, identity, request_id, "reverification", file_id, "failure")
        db.commit()
        raise FileError(415, "invalid_file", "File validation failed") from None
    except Exception:
        event(db, identity, request_id, "reverification", file_id, "failure")
        db.commit()
        raise FileError(503, "storage_read_failed", "File could not be verified") from None
    # Reverification may not bless a modified object with different bytes.
    current = db.get(FileRecord, file_id)
    if (current.size, current.checksum) != (verified.size, verified.checksum):
        current.state = "pending_delete"
        current.version += 1
        db.commit()
        raise FileError(409, "integrity_failure", "Stored object integrity check failed")
    return publish(db, identity, file_id, verified, request_id)


def prepare_download(db, identity, file_id, storage, settings, request_id):
    row = get_record(db, identity, file_id, "download", readable=True)
    key, size, checksum, media = row.object_key, row.size, row.checksum, row.content_type
    db.rollback()
    spool = SpooledTemporaryFile(max_size=1024 * 1024)
    digest, actual = hashlib.sha256(), 0
    try:
        with storage.get(key) as source:
            while chunk := source.read(min(64 * 1024, settings.max_upload_bytes + 1 - actual)):
                actual += len(chunk)
                if actual > settings.max_upload_bytes:
                    raise ValueError("Object oversized")
                digest.update(chunk)
                spool.write(chunk)
        if (actual, digest.hexdigest()) != (size, checksum):
            raise ValueError("Object mismatch")
        get_record(db, identity, file_id, "download", readable=True)
        event(db, identity, request_id, "download", file_id, "success")
        db.commit()
        spool.seek(0)
        return spool, media, actual
    except (FileError, AuthError):
        spool.close()
        raise
    except Exception:
        spool.close()
        event(db, identity, request_id, "download", file_id, "failure")
        db.commit()
        raise FileError(503, "storage_read_failed", "File content is unavailable") from None


def issue_url(db, identity, file_id, storage, settings, request_id, base_path=""):
    row = get_record(db, identity, file_id, "download", lock=True, readable=True)
    expires_at = utcnow() + timedelta(seconds=settings.download_grant_seconds)
    if settings.storage_backend == "local":
        value = secrets.token_urlsafe(32)
        db.add(DownloadGrant(digest=token_digest(value), file_id=file_id, user_id=identity.user.id,
                             identity_version=identity.user.identity_version, expires_at=expires_at))
        url = f"{base_path}/api/v1/files/grants/{value}"
    else:
        key = row.object_key
        db.rollback()
        try:
            url = storage.download_link(key, settings.download_grant_seconds)
        except Exception:
            raise FileError(503, "storage_link_failed", "Download link unavailable") from None
        get_record(db, identity, file_id, "download", lock=True, readable=True)
    event(db, identity, request_id, "download_grant", file_id, "success")
    db.commit()
    return {"url": url, "expires_at": expires_at, "bearer_capability": settings.storage_backend == "s3"}


def redeem_grant(db, identity, token):
    grant = db.get(DownloadGrant, token_digest(token))
    if (not grant or grant.user_id != identity.user.id or grant.identity_version != identity.user.identity_version
            or grant.expires_at <= utcnow()):
        raise FileError(404, "not_found", "Download grant unavailable")
    get_record(db, identity, grant.file_id, "download", readable=True)
    return grant.file_id