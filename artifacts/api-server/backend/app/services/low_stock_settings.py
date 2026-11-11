"""Serialized settings writes and durable cancellation of absent requests."""
import hmac
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.core.config import get_settings
from app.db.low_stock_models import LowStockSettings as Settings, LowStockSettingsRequest as Request
from app.services.allergens import authorize, AllergenError
from app.services.purchase_received_crypto import ReceiptCrypto

LOCK = 5310057


def ready(db):
    for sql in (
        "SELECT id,version,payload_ciphertext FROM low_stock_settings LIMIT 0",
        "SELECT key,actor_id,state,version,payload_ciphertext FROM low_stock_settings_requests LIMIT 0",
        "SELECT week,created_at FROM low_stock_weeks LIMIT 0",
        "SELECT week,recipient,token,status,destination_index,payload_ciphertext,category,lease_until FROM low_stock_deliveries LIMIT 0",
    ):
        db.execute(text(sql))


def current(db, crypto):
    row = db.get(Settings, 1, populate_existing=True)
    return dict(version=row.version if row else 0, additional_email=
        crypto.open(1, "low-stock-settings", row.payload_ciphertext)["additional_email"] if row else None)


def operation(db, actor, body=None, request_id=None):
    try:
        identity = authorize(db, actor)
        ready(db)
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
                db.commit()
                return {"outcome": "committed", "committed_version": recorded.version, "saved": saved}
            if saved["version"] != body.expected_version:
                db.add(Request(key=key, actor_id=identity.user.id, state="cancelled", version=None,
                    payload_ciphertext=crypto.seal(key, "low-stock-request", {"digests": crypto.digests(payload)})))
                db.commit()
                raise AllergenError("Settings changed elsewhere. Your edit is kept; load and compare the saved value.", 409, "low_stock_stale")
            version = saved["version"] + 1
            email = str(body.additional_email) if body.additional_email else None
            row = db.get(Settings, 1)
            if row is None:
                row = Settings(id=1)
                db.add(row)
            row.version, row.payload_ciphertext = version, crypto.seal(1, "low-stock-settings", {"additional_email": email})
            db.add(Request(key=key, actor_id=identity.user.id, state="committed", version=version,
                payload_ciphertext=crypto.seal(key, "low-stock-request", {"digests": crypto.digests(payload)})))
            saved = dict(version=version, additional_email=email)
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
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise AllergenError("Low-stock settings storage is unavailable. Your edits are kept.", 503, "low_stock_settings_unavailable") from None
    except Exception:
        db.rollback()
        raise
