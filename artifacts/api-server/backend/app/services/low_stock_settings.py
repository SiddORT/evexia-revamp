"""Serialized settings writes and durable cancellation of absent requests."""
import hmac
from datetime import datetime, time, timedelta
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.core.config import get_settings
from app.db.low_stock_models import LowStockSettings as Settings, LowStockSettingsRequest as Request
from app.services.allergens import authorize, AllergenError
from app.services.purchase_received_crypto import ReceiptCrypto
from app.db.low_stock_models import LowStockSchedule, LowStockWeek
from app.schemas.low_stock import LowStockConfiguration
from app.services.low_stock_schedule import LEGACY, REVISION, ZONE, next_run
from app.core.security import utcnow

LOCK = 5310057


def ready(db, recurring=True):
    for sql in (
        "SELECT id,version,payload_ciphertext FROM low_stock_settings LIMIT 0",
        "SELECT key,actor_id,state,version,payload_ciphertext FROM low_stock_settings_requests LIMIT 0",
        "SELECT week,created_at FROM low_stock_weeks LIMIT 0",
        "SELECT week,recipient,token,status,destination_index,payload_ciphertext,category,lease_until FROM low_stock_deliveries LIMIT 0",
    ):
        db.execute(text(sql))
    if recurring:
        for sql in (
            "SELECT id,next_run_at FROM low_stock_schedule LIMIT 0",
            "SELECT scheduled_at,created_at FROM low_stock_occurrences LIMIT 0",
            "SELECT scheduled_at,recipient,token,status,destination_index,payload_ciphertext,category,lease_until FROM low_stock_occurrence_deliveries LIMIT 0",
        ):
            db.execute(text(sql))


def current(db, crypto):
    row = db.get(Settings, 1, populate_existing=True)
    payload = crypto.open(1, "low-stock-settings", row.payload_ciphertext) if row else {"additional_email": None}
    if "additional_email" in payload:
        payload = {**LEGACY, "additional_emails": [payload["additional_email"]] if payload["additional_email"] else []}
    config = LowStockConfiguration.model_validate(payload).model_dump(mode="json")
    return dict(version=row.version if row else 0, **config)


def view(db, saved):
    from app.core.schema import SCHEMA_REVISION
    revisions = list(db.scalars(text("SELECT version_num FROM alembic_version")))
    eligible = SCHEMA_REVISION == REVISION and revisions == [REVISION]
    if eligible:
        ready(db)
    candidate = next_run(saved, utcnow())
    # Display the same conservative transition suppression used by the worker.
    for _ in range(54):
        day = candidate.astimezone(ZONE).date()
        monday = day - timedelta(days=day.weekday())
        if not db.get(LowStockWeek, monday):
            break
        candidate = next_run(saved, datetime.combine(monday + timedelta(days=7), time.min, ZONE) - timedelta(microseconds=1))
    return dict(**saved, next_run_at=candidate,
        runtime_status="eligible" if eligible else "blocked",
        runtime_message=("Schema prerequisites match. Delivery additionally requires a running matching worker, "
                         "readable stock and recipients, and the selected Communication SMTP. Inbox delivery is not verified.")
                        if eligible else
                        "Scheduled delivery is blocked: coordinated schema activation and matching service startup "
                        "require separate approval. Saving does not activate or send email.")


def operation(db, actor, body=None, request_id=None):
    try:
        identity = authorize(db, actor)
        ready(db, recurring=body is not None or request_id is not None)
        crypto = ReceiptCrypto(get_settings())
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK})
        key = body.request_id if body else request_id
        recorded = db.get(Request, key) if key else None
        if recorded and recorded.actor_id != identity.user.id:
            raise AllergenError("This save belongs to another account.", 403, "access_denied")
        saved = current(db, crypto)
        if body:
            payload = body.model_dump(mode="json")
            if recorded:
                old = crypto.open(key, "low-stock-request", recorded.payload_ciphertext)
                digests = crypto.digests(payload)
                if not any(k in digests and hmac.compare_digest(v, digests[k]) for k, v in old["digests"].items()):
                    raise AllergenError("Save identity already used. Check the outcome.", 409, "low_stock_request_reused")
                if recorded.state != "committed":
                    raise AllergenError("Save was cancelled. Load current settings before saving again.", 409, "low_stock_cancelled")
                result = {"outcome": "committed", "committed_version": recorded.version, "saved": view(db, saved)}
                db.commit()
                return result
            if saved["version"] != body.expected_version:
                db.add(Request(key=key, actor_id=identity.user.id, state="cancelled", version=None,
                    payload_ciphertext=crypto.seal(key, "low-stock-request", {"digests": crypto.digests(payload)})))
                db.commit()
                raise AllergenError("Settings changed elsewhere. Your edit is kept; load and compare the saved value.", 409, "low_stock_stale")
            version = saved["version"] + 1
            config = body.model_dump(mode="json", exclude={"request_id", "expected_version"})
            row = db.get(Settings, 1)
            if row is None:
                row = Settings(id=1)
                db.add(row)
            row.version, row.payload_ciphertext = version, crypto.seal(1, "low-stock-settings", config)
            schedule = db.get(LowStockSchedule, 1)
            if schedule is None:
                schedule = LowStockSchedule(id=1)
                db.add(schedule)
            # Saving never dispatches a just-passed occurrence.
            schedule.next_run_at = next_run(config, utcnow())
            db.add(Request(key=key, actor_id=identity.user.id, state="committed", version=version,
                payload_ciphertext=crypto.seal(key, "low-stock-request", {"digests": crypto.digests(payload)})))
            saved = dict(version=version, **config)
            result = dict(outcome="committed", committed_version=version, saved=saved)
        elif key:
            if not recorded:
                # The same lock is held by writes. Tombstone first, so a delayed
                # original request cannot commit after an absence response.
                recorded = Request(key=key, actor_id=identity.user.id, state="cancelled", version=None,
                    payload_ciphertext=crypto.seal(key, "low-stock-request", {"digests": {}}))
                db.add(recorded)
            result = dict(outcome=recorded.state, committed_version=recorded.version, saved=saved)
        else:
            result = saved
        if "saved" in result:
            result["saved"] = view(db, result["saved"])
        else:
            result = view(db, result)
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise AllergenError("Cron Jobs storage is unavailable. Ask an operator to review approved schema activation; your edits are kept.",
                           503, "low_stock_settings_unavailable") from None
    except Exception:
        db.rollback()
        raise
