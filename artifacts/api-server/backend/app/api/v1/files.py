import asyncio
import uuid
from tempfile import SpooledTemporaryFile
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.background import BackgroundTask

from app.api.deps import current_identity
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.schemas.files import DownloadURLResponse, FileResponse, ReplacementRequest, UploadRequest
from app.services import files as service
from app.services.auth import Identity
from app.services.file_locks import operation
from app.services.file_policy import FileError
from app.services.file_policy import authorize
from app.services.storage import get_storage

def file_quota(identity: Identity = Depends(current_identity), db: Session = Depends(get_db),
               settings: Settings = Depends(get_settings)):
    # Count all authenticated attempts, including guessed IDs and denied actions.
    # No object adapter or upload reservation is touched by this dependency.
    service.quota(db, identity, settings)


router = APIRouter(prefix="/files", tags=["files"], dependencies=[Depends(file_quota)])
RAW_BODY = {"requestBody": {"required": True, "content": {
    mime: {"schema": {"type": "string", "format": "binary"}}
    for mime in ("image/jpeg", "image/png", "application/pdf")
}}}


def storage_dependency(settings: Settings = Depends(get_settings)):
    # Lazy: configuration failure must not precede authorization of object IDs.
    return lambda: get_storage(settings)


async def upload_body(request, db, identity, file_id, settings, storage_factory):
    lease = operation(db, settings, file_id)
    await run_in_threadpool(lease.__enter__)
    try:
        with SpooledTemporaryFile(max_size=1024 * 1024) as spool:
            actual = 0
            try:
                async with asyncio.timeout(settings.file_request_timeout_seconds):
                    async for chunk in request.stream():
                        actual += len(chunk)
                        if actual > settings.max_upload_bytes:
                            raise FileError(413, "file_too_large", "File exceeds the upload limit")
                        await run_in_threadpool(spool.write, chunk)
            except TimeoutError:
                raise FileError(408, "upload_timeout", "Upload timed out") from None
            await run_in_threadpool(spool.seek, 0)
            result = await run_in_threadpool(service.complete_upload, db, identity, file_id, spool,
                                             settings, storage_factory, request.state.request_id)
            return result
    except BaseException:
        await run_in_threadpool(service.interrupted, db, file_id, identity, request.state.request_id)
        raise
    finally:
        await run_in_threadpool(lease.__exit__, None, None, None)


@router.post("", response_model=FileResponse, status_code=201, openapi_extra=RAW_BODY)
async def upload(
    request: Request, body: Annotated[UploadRequest, Query()],
    identity: Identity = Depends(current_identity), db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings), storage_factory=Depends(storage_dependency),
):
    # Live permission before quota, body read, adapter construction or calls.
    await run_in_threadpool(authorize, db, identity, "upload", body.patient_id, body.mr_id)
    file_id = await run_in_threadpool(service.reserve, db, identity, body,
                                     request.headers.get("content-type", ""), settings, request.state.request_id)
    request.state.file_id = str(file_id)
    try:
        return await upload_body(request, db, identity, file_id, settings, storage_factory)
    except BaseException:
        await run_in_threadpool(service.interrupted, db, file_id, identity, request.state.request_id)
        raise


def stream_download(db, identity, file_id, settings, storage_factory, request_id):
    # Permission before adapter creation, then global capacity throughout stream.
    service.get_record(db, identity, file_id, "download", readable=True)
    lease = operation(db, settings, file_id)
    lease.__enter__()
    try:
        spool, media, size = service.prepare_download(db, identity, file_id, storage_factory(), settings, request_id)
    except BaseException:
        lease.__exit__(None, None, None)
        raise
    closed = False
    def close():
        nonlocal closed
        if not closed:
            closed = True
            spool.close()
            lease.__exit__(None, None, None)
    def chunks():
        try:
            while chunk := spool.read(64 * 1024):
                yield chunk
        finally:
            close()
    # Never interpolate original display names into response headers.
    extension = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}[media]
    return StreamingResponse(chunks(), media_type=media, background=BackgroundTask(close), headers={
        "Content-Disposition": f'attachment; filename="{file_id}.{extension}"',
        "Content-Length": str(size), "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    })


@router.get("/grants/{token}", response_class=StreamingResponse, responses={200: {"content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}}})
def redeem(token: str, request: Request, identity: Identity = Depends(current_identity),
           db: Session = Depends(get_db), settings: Settings = Depends(get_settings), storage_factory=Depends(storage_dependency)):
    if len(token) > 128:
        raise FileError(404, "not_found", "Download grant unavailable")
    file_id = service.redeem_grant(db, identity, token)
    return stream_download(db, identity, file_id, settings, storage_factory, request.state.request_id)


@router.get("/{file_id}", response_model=FileResponse)
def metadata(file_id: uuid.UUID, request: Request, identity: Identity = Depends(current_identity),
             db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    row = service.get_record(db, identity, file_id, "read")
    service.event(db, identity, request.state.request_id, "metadata", file_id, "success")
    db.commit()
    return service.response(row)


@router.get("/{file_id}/download", response_class=StreamingResponse, responses={200: {"content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}}}})
def download(file_id: uuid.UUID, request: Request, identity: Identity = Depends(current_identity),
             db: Session = Depends(get_db), settings: Settings = Depends(get_settings), storage_factory=Depends(storage_dependency)):
    return stream_download(db, identity, file_id, settings, storage_factory, request.state.request_id)


@router.post("/{file_id}/download-url", response_model=DownloadURLResponse)
def download_url(file_id: uuid.UUID, request: Request, identity: Identity = Depends(current_identity),
                 db: Session = Depends(get_db), settings: Settings = Depends(get_settings), storage_factory=Depends(storage_dependency)):
    service.get_record(db, identity, file_id, "download", readable=True)
    with operation(db, settings, file_id):
        return service.issue_url(db, identity, file_id, storage_factory(), settings,
                                 request.state.request_id, request.scope.get("root_path", ""))


@router.delete("/{file_id}", response_model=FileResponse)
def delete(file_id: uuid.UUID, request: Request, expected_version: int | None = Query(default=None, ge=1),
           identity: Identity = Depends(current_identity), db: Session = Depends(get_db),
           settings: Settings = Depends(get_settings), storage_factory=Depends(storage_dependency)):
    service.get_record(db, identity, file_id, "delete", allow_hidden=True)
    with operation(db, settings, file_id):
        return service.delete_file(db, identity, file_id, storage_factory(), request.state.request_id,
                                   expected_version=expected_version)


@router.post("/{file_id}/replacement", response_model=FileResponse, status_code=201, openapi_extra=RAW_BODY)
async def replacement(file_id: uuid.UUID, request: Request, body: Annotated[ReplacementRequest, Query()],
                      identity: Identity = Depends(current_identity), db: Session = Depends(get_db),
                      settings: Settings = Depends(get_settings), storage_factory=Depends(storage_dependency)):
    original = await run_in_threadpool(service.get_record, db, identity, file_id, "replace", readable=True)
    upload_fields = UploadRequest(patient_id=original.patient_id, mr_id=original.mr_id,
                                  category=original.category, filename=body.filename)
    new_id = await run_in_threadpool(service.reserve, db, identity, upload_fields, request.headers.get("content-type", ""),
                                    settings, request.state.request_id, replaces_id=file_id, expected_version=body.expected_version)
    request.state.file_id = str(new_id)
    try:
        result = await upload_body(request, db, identity, new_id, settings, storage_factory)
        # Publication atomically retires the old record. Cleanup is retryable and
        # never hidden as success: an explicit pending-delete error includes no key.
        if result.state == "verified":
            def cleanup():
                with operation(db, settings, file_id):
                    service.delete_file(db, identity, file_id, storage_factory(), request.state.request_id)
            await run_in_threadpool(cleanup)
        return result
    except BaseException:
        await run_in_threadpool(service.interrupted, db, new_id, identity, request.state.request_id)
        raise


@router.post("/{file_id}/reconcile", response_model=FileResponse)
def reconcile(file_id: uuid.UUID, request: Request, identity: Identity = Depends(current_identity),
              db: Session = Depends(get_db), settings: Settings = Depends(get_settings), storage_factory=Depends(storage_dependency)):
    service.get_record(db, identity, file_id, "recover", allow_hidden=True)
    with operation(db, settings, file_id):
        return service.recover(db, identity, file_id, settings, storage_factory(), request.state.request_id)