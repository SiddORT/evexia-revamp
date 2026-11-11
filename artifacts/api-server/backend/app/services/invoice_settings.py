"""Protected Settings source only, with serialized durable save reconciliation.

PR keys are reused with invoice-specific authenticated field domains. QR bytes
are encrypted in private backend-neutral storage, never in database payloads.
"""
import base64
import hashlib
import hmac
import io
import warnings
from datetime import timedelta
from uuid import UUID
from PIL import Image
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError
from app.core.config import get_settings
from app.db.invoice_settings_models import InvoiceSettingsRequest, InvoiceSettingsRevision
from app.schemas.invoice_settings import InvoiceDetails, InvoiceSettingsView, InvoiceQRMetadata
from app.services.allergens import AllergenError, authorize
from app.services.purchase_received_crypto import ReceiptCrypto, PRError
from app.services.storage import get_storage, object_key

LOCK = 5310049
NAMESPACE = UUID("e7e81000-0000-4000-8000-000000000001")
MAX_QR_BYTES = 512 * 1024


def fail(message="Invoice Details storage is unavailable. Your edits are preserved. Reconcile any unconfirmed save before trying again.",
         status=503, code="invoice_settings_unavailable"):
    raise AllergenError(message, status, code)


def lock(db):
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK})


def ready(db):
    # Explicit shape probes fail closed on a partially applied schema.
    db.execute(text("SELECT version,actor_id,changed_at,payload_ciphertext FROM invoice_settings_revisions LIMIT 0"))
    db.execute(text("SELECT key,actor_id,state,version,payload_ciphertext,created_at FROM invoice_settings_requests LIMIT 0"))
    if db.scalar(text("""
        SELECT count(*) = 2 FROM pg_trigger
        WHERE tgrelid = 'public.invoice_settings_revisions'::regclass
          AND tgname IN ('invoice_settings_history_immutable','invoice_settings_history_no_truncate')
          AND NOT tgisinternal AND tgenabled = 'O'
    """)) is not True:
        fail()


def latest(db):
    return db.scalar(select(InvoiceSettingsRevision).order_by(InvoiceSettingsRevision.version.desc()).limit(1))


def opened(crypto, row):
    return crypto.open(row.version, "invoice-settings-revision", row.payload_ciphertext)


def qr_metadata(qr):
    return InvoiceQRMetadata(**qr).model_dump() if qr else None


def view(crypto, row):
    data = opened(crypto, row) if row else {}
    return InvoiceSettingsView(
        configured=row is not None, version=row.version if row else 0,
        details=InvoiceDetails(**data.get("details", {})),
        qr=qr_metadata(data.get("qr")), updated_at=row.changed_at if row else None,
    ).model_dump(mode="json")


def qr_key(request_id):
    return object_key("invoice-settings", NAMESPACE, "documents", request_id, "enc")


def image_data(body):
    if (body.qr_action == "replace") != (body.qr_data is not None):
        fail("Choose a PNG/JPEG image only when replacing the QR.", 422, "invoice_qr_invalid")
    if body.qr_data is None:
        return None
    try:
        raw = base64.b64decode(body.qr_data.base64, validate=True)
        if not 0 < len(raw) <= MAX_QR_BYTES:
            raise ValueError()
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as image:
                expected = "PNG" if body.qr_data.content_type == "image/png" else "JPEG"
                if image.format != expected or getattr(image, "n_frames", 1) != 1:
                    raise ValueError()
                if any(not 32 <= size <= 2048 for size in image.size):
                    raise ValueError()
                image.verify()
            with Image.open(io.BytesIO(raw)) as image:
                image.load()
                # Re-encode pixels only: discard EXIF, comments, trailing data
                # and any embedded non-image content before private storage.
                clean = Image.new("RGB", image.size, "white")
                if image.mode == "RGBA":
                    clean.paste(image, mask=image.getchannel("A"))
                else:
                    clean.paste(image.convert("RGB"))
                out = io.BytesIO()
                clean.save(out, format="PNG" if expected == "PNG" else "JPEG")
                raw = out.getvalue()
                if len(raw) > MAX_QR_BYTES:
                    raise ValueError()
        return dict(content_type=body.qr_data.content_type, base64=base64.b64encode(raw).decode(),
                    size=len(raw), sha256=hashlib.sha256(raw).hexdigest())
    except Exception:
        fail("QR must be a valid single-image PNG/JPEG, 32–2048 pixels per side and at most 512 KiB after safe decoding.",
             422, "invoice_qr_invalid")


def request_payload(crypto, row):
    return crypto.open(row.key, "invoice-settings-request", row.payload_ciphertext)


def owned_request(db, key, actor_id):
    row = db.get(InvoiceSettingsRequest, key, populate_existing=True)
    if row and row.actor_id != actor_id:
        fail("This save request does not belong to this authenticated account.", 403, "access_denied")
    return row


def same_request(crypto, request, body):
    digests = crypto.digests(body.model_dump(mode="json"))
    recorded = request_payload(crypto, request)["digests"]
    if not any(key in digests and hmac.compare_digest(value, digests[key]) for key, value in recorded.items()):
        fail("This save identity has already been used. Reconcile it, then review a new save.",
             409, "invoice_request_reused")


def reserve(db, actor, body, crypto):
    """Commit an owned intent before any external file can be published."""
    current = authorize(db, actor)
    ready(db)
    lock(db)
    request = owned_request(db, body.request_id, current.user.id)
    if request:
        same_request(crypto, request, body)
    else:
        request = InvoiceSettingsRequest(
            key=body.request_id, actor_id=current.user.id, state="pending",
            payload_ciphertext=crypto.seal(body.request_id, "invoice-settings-request", {
                "digests": crypto.digests(body.model_dump(mode="json")),
                "has_qr": body.qr_action == "replace",
            }),
        )
        db.add(request)
    db.commit()


def qr_label(qr):
    return (f"QR image · version {qr['version']} · {qr['content_type']} · "
            f"{qr['size']} bytes · SHA-256 {qr['sha256']}") if qr else ""


def reclaim_expired(db, actor, crypto):
    """Bounded staging housekeeping, never deletion of committed evidence.

    Lost browser state must not leave replacement files permanently abandoned.
    The writer's same lock cancels expired pending identities BEFORE deleting
    their files; the retained tombstone rejects any delayed original request.
    No background service or automatic save resubmission is involved.
    """
    lock(db)
    rows = list(db.scalars(select(InvoiceSettingsRequest).where(
        InvoiceSettingsRequest.state == "pending",
        InvoiceSettingsRequest.created_at < func.now() - timedelta(hours=24),
    ).order_by(InvoiceSettingsRequest.created_at, InvoiceSettingsRequest.key).limit(20)))
    for row in rows:
        if request_payload(crypto, row)["has_qr"]:
            get_storage(get_settings()).delete(qr_key(row.key))
        row.state = "cancelled"
    if rows:
        db.commit()
        # Authorization and session locks must be renewed after housekeeping's
        # transaction boundary, before reading any sensitive saved values.
        authorize(db, actor)
        ready(db)


def write(db, actor, body, crypto):
    image = image_data(body)  # Pure bounded decode before reserving a file.
    reserve(db, actor, body, crypto)
    current = authorize(db, actor)
    ready(db)
    lock(db)
    request = owned_request(db, body.request_id, current.user.id)
    same_request(crypto, request, body)
    if request.state == "cancelled":
        fail("This save was cancelled during reconciliation. Compare saved details, then explicitly save again.",
             409, "invoice_request_cancelled")
    if request.state == "committed":
        result = view(crypto, db.get(InvoiceSettingsRevision, request.version))
        db.commit()
        return result
    row = latest(db)
    if (row.version if row else 0) != body.expected_version:
        # No file has been written. Keep a terminal cancellation so a delayed
        # identical request cannot later overwrite the newer configuration.
        request.state = "cancelled"
        db.commit()
        fail("Invoice Details changed. Load and compare saved values with your kept edits.",
             409, "invoice_settings_stale")
    old = opened(crypto, row) if row else dict(details=InvoiceDetails().model_dump(), qr=None)
    values = body.details.model_dump()
    qr = old["qr"]
    version = (row.version if row else 0) + 1
    if body.qr_action == "remove":
        qr = None
    elif image and (not qr or qr["sha256"] != image["sha256"] or qr["content_type"] != image["content_type"]):
        qr = {key: image[key] for key in ("content_type", "size", "sha256")}
        qr.update(version=version, request_id=str(body.request_id))
    if values == old["details"] and qr == old["qr"]:
        request.state = "committed" if row else "cancelled"
        request.version = row.version if row else None
        result = view(crypto, row)
        db.commit()
        return result
    if version > 2147483647:
        fail("Invoice Details version limit reached. Contact the operator.", 409, "invoice_version_exhausted")
    changes = [dict(field=field, before=old["details"][field], after=values[field])
               for field in InvoiceDetails.model_fields
               if row is None or values[field] != old["details"][field]]
    if qr != old["qr"]:
        changes.append(dict(field="qr", before=qr_label(old["qr"]), after=qr_label(qr)))
    if image and qr and qr["request_id"] == str(body.request_id):
        storage = get_storage(get_settings())
        key = qr_key(body.request_id)
        encrypted = crypto.seal(body.request_id, "invoice-settings-qr", {
            "content_type": image["content_type"], "base64": image["base64"],
        }).encode()
        if storage.exists(key):
            # A disconnected previous attempt may have published this owned
            # immutable file before its SQL transaction rolled back.
            with storage.get(key) as source:
                previous = crypto.open(body.request_id, "invoice-settings-qr",
                                       source.read(2 * MAX_QR_BYTES + 4096).decode())
            if previous != {"content_type": image["content_type"], "base64": image["base64"]}:
                fail()
        else:
            storage.put(key, io.BytesIO(encrypted), "application/octet-stream")
    revision = InvoiceSettingsRevision(
        version=version, actor_id=current.user.id,
        payload_ciphertext=crypto.seal(version, "invoice-settings-revision", {
            "details": values, "qr": qr, "qr_before": old["qr"],
            "changes": changes, "actor_label": "Protected Super Admin",
        }),
    )
    db.add(revision)
    db.flush()
    request.state, request.version = "committed", version
    result = view(crypto, revision)
    # The settings source IS the latest immutable history revision. There is
    # no separate current-settings row that can commit without its history.
    db.commit()
    return result


def reconcile(db, actor, key, crypto):
    current = authorize(db, actor)
    ready(db)
    lock(db)
    request = owned_request(db, key, current.user.id)
    if request is None:
        # Closing an absent identity under the writer lock is essential:
        # a delayed original request can now only observe cancellation.
        request = InvoiceSettingsRequest(key=key, actor_id=current.user.id, state="cancelled",
                                        payload_ciphertext=crypto.seal(key, "invoice-settings-request", {
                                            "digests": {}, "has_qr": False,
                                        }))
        db.add(request)
    if request.state == "pending":
        if request_payload(crypto, request)["has_qr"]:
            # Only the reserved uncommitted file can be removed here.
            get_storage(get_settings()).delete(qr_key(key))
        request.state = "cancelled"
    result = dict(outcome="committed" if request.state == "committed" else "cancelled",
                  committed_version=request.version, saved=view(crypto, latest(db)))
    db.commit()
    return result


def history(db, crypto, before_version, limit):
    query = select(InvoiceSettingsRevision)
    if before_version is not None:
        query = query.where(InvoiceSettingsRevision.version < before_version)
    rows = list(db.scalars(query.order_by(InvoiceSettingsRevision.version.desc()).limit(limit + 1)))
    items = []
    for row in rows[:limit]:
        data = opened(crypto, row)
        items.append(dict(version=row.version, changed_at=row.changed_at,
                          actor=dict(id=row.actor_id, label=data["actor_label"]),
                          changes=data["changes"], qr_before=qr_metadata(data["qr_before"]),
                          qr_after=qr_metadata(data["qr"])))
    return dict(items=items, next_before_version=rows[limit - 1].version if len(rows) > limit else None)


def qr_image(db, crypto, version):
    row = db.get(InvoiceSettingsRevision, version)
    qr = opened(crypto, row)["qr"] if row else None
    if not qr or qr["version"] != version:
        fail("No QR was saved at this version.", 404, "invoice_qr_missing")
    key = UUID(qr["request_id"])
    with get_storage(get_settings()).get(qr_key(key)) as source:
        data = crypto.open(key, "invoice-settings-qr", source.read(2 * MAX_QR_BYTES + 4096).decode())
    raw = base64.b64decode(data["base64"], validate=True)
    if (len(raw) != qr["size"] or len(raw) > MAX_QR_BYTES
            or hashlib.sha256(raw).hexdigest() != qr["sha256"] or data["content_type"] != qr["content_type"]):
        fail()
    return dict(version=version, **data)


def operation(db, actor, *, body=None, action=None, request_id=None, version=None,
              before_version=None, limit=10):
    try:
        authorize(db, actor)
        ready(db)
        crypto = ReceiptCrypto(get_settings())
        reclaim_expired(db, actor, crypto)
        if action == "save":
            return write(db, actor, body, crypto)
        if action == "reconcile":
            return reconcile(db, actor, request_id, crypto)
        if action == "history":
            result = history(db, crypto, before_version, limit)
        elif action == "qr":
            result = qr_image(db, crypto, version)
        else:
            result = view(crypto, latest(db))
        db.commit()
        return result
    except AllergenError:
        db.rollback()
        raise
    except (SQLAlchemyError, PRError, ValueError, OSError, KeyError, TypeError):
        db.rollback()
        fail()
    except Exception:
        # Storage SDK failures must not leak paths, ciphertext or provider data.
        db.rollback()
        fail()
