import asyncio
import uuid
from email.parser import BytesParser
from email.policy import default
from typing import Literal

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import require_zone
from app.db.session import get_db
from app.schemas.languages import LanguageFields, LanguageEdit, LanguageVersion, LanguageResponse, LanguagePage, LanguageHistory
from app.schemas.languages import LanguageReview, LanguageImportResult
from app.services.auth import Identity
from app.services import languages, language_transfer
from app.services.downloads import server_record

router = APIRouter(prefix="/admin/languages", tags=["Language Master"])
# Reuse the protected singleton gate, never the assignable Zone grants.
manager = require_zone(protected=True)
OVERHEAD = 64 * 1024
FILE_RESPONSES = {200: {"content": {
    "text/csv": {"schema": {"type": "string", "format": "binary"}},
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
        "schema": {"type": "string", "format": "binary"}}}}}
UPLOAD = {"requestBody": {"required": True, "content": {
    "application/octet-stream": {"schema": {"type": "string", "format": "binary"}},
    "multipart/form-data": {"schema": {"type": "object", "required": ["file"], "additionalProperties": False,
                                     "properties": {"file": {"type": "string", "format": "binary"}}}},
}}}


def download_response(db, actor, data, format, initiation_id, kind):
    evidence = server_record(db, actor, initiation_id, "language", kind, format.upper())
    filename = f'evexia-language-{"template" if kind == "template" else "master"}.{format}'
    return Response(data, media_type="text/csv; charset=utf-8" if format == "csv" else
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"',
                             "X-Download-Log": str(evidence["id"]), "Cache-Control": "no-store"})


@router.get("/export", operation_id="exportLanguages", responses=FILE_RESPONSES, response_class=Response)
def export(query: str = Query("", max_length=200), format: Literal["csv", "xlsx"] = "csv",
           actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    return download_response(db, actor, language_transfer.export(db, actor, query, format), format, initiation_id, "export")


@router.get("/sample", operation_id="downloadLanguageSample", responses=FILE_RESPONSES, response_class=Response)
def sample(format: Literal["csv", "xlsx"] = "csv", actor: Identity = Depends(manager), db: Session = Depends(get_db),
           initiation_id: uuid.UUID | None = Header(None, alias="X-Download-Initiation")):
    languages.transaction(db, lambda: languages.authorize(db, actor))
    return download_response(db, actor, language_transfer.sample(format), format, initiation_id, "template")


async def read_file(request):
    media = request.headers.get("content-type", "")
    multipart = media.lower().startswith("multipart/form-data;")
    if not multipart and media.split(";")[0].lower() != "application/octet-stream":
        raise languages.LanguageError("Send raw bytes or exactly one multipart file field.", 415, "language_media_type")
    if len(media) > 1000 or "\r" in media or "\n" in media:
        language_transfer.invalid("Invalid content type.")
    chunks, size = [], 0
    try:
        async with asyncio.timeout(15):
            async for chunk in request.stream():
                size += len(chunk)
                if size > language_transfer.MAX_BYTES + (OVERHEAD if multipart else 0):
                    raise languages.LanguageError("File exceeds 2 MiB plus allowed multipart overhead.", 413, "language_file_limit")
                chunks.append(chunk)
    except TimeoutError:
        raise languages.LanguageError("Upload timed out. Retry with your local file.", 408, "language_upload_timeout") from None
    data = b"".join(chunks)
    if multipart:
        try:
            message = BytesParser(policy=default).parsebytes(
                ("Content-Type: " + media + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + data)
            parts = list(message.iter_parts())
            if message.defects or len(parts) != 1 or parts[0].is_multipart() or parts[0].defects:
                language_transfer.invalid("Use exactly one multipart file field.")
            part = parts[0]
            if (part.get_content_disposition() != "form-data" or part.get_param("name", header="content-disposition") != "file"
                    or not part.get_filename() or part.get("Content-Transfer-Encoding")):
                language_transfer.invalid("Unsupported multipart fields or encoding.")
            payload = part.get_payload(decode=True)
            if not isinstance(payload, bytes) or len(data) - len(payload) > OVERHEAD:
                language_transfer.invalid("Multipart overhead exceeds 64 KiB.")
            data = payload
        except languages.LanguageError:
            raise
        except Exception:
            language_transfer.invalid("Malformed multipart body.")
    if len(data) > language_transfer.MAX_BYTES:
        raise languages.LanguageError("File exceeds 2 MiB.", 413, "language_file_limit")
    return data


@router.post("/import/review", response_model=LanguageReview, operation_id="reviewLanguageImport", openapi_extra=UPLOAD)
async def review(request: Request, filename: str = Query(min_length=1, max_length=200),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return language_transfer.transfer(db, actor, await read_file(request), filename)


@router.post("/import/commit", response_model=LanguageImportResult, operation_id="commitLanguageImport", openapi_extra=UPLOAD)
async def commit(request: Request, filename: str = Query(min_length=1, max_length=200),
                 digest: str = Query(pattern=r"^[0-9a-f]{64}$"), confirm: bool = Query(),
                 actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    if not confirm:
        raise languages.LanguageError("Explicit confirmation is required.", 422, "language_confirmation_required")
    return language_transfer.transfer(db, actor, await read_file(request), filename, confirm, digest)


@router.get("", response_model=LanguagePage, operation_id="listLanguages")
def listing(query: str = Query("", max_length=200), limit: int = Query(10, ge=1, le=100),
            offset: int = Query(0, ge=0, le=1000000),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return languages.listing(db, actor, query, limit, offset)


@router.post("", response_model=LanguageResponse, status_code=201, operation_id="createLanguage")
def create(body: LanguageFields, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return languages.create(db, actor, body)


@router.get("/{language_id}", response_model=LanguageResponse, operation_id="getLanguage")
def detail(language_id: uuid.UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return languages.detail(db, actor, language_id)


@router.post("/{language_id}/edit", response_model=LanguageResponse, operation_id="editLanguage")
def edit(language_id: uuid.UUID, body: LanguageEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return languages.mutate(db, actor, language_id, body, "edit")


@router.post("/{language_id}/delete", response_model=LanguageResponse, operation_id="deleteLanguage")
def delete(language_id: uuid.UUID, body: LanguageVersion, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return languages.mutate(db, actor, language_id, body, "delete")


@router.get("/{language_id}/history", response_model=LanguageHistory, operation_id="getLanguageHistory")
def history(language_id: uuid.UUID, limit: int = Query(10, ge=1, le=100), offset: int = Query(0, ge=0, le=1000000),
            actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return languages.history(db, actor, language_id, limit, offset)
