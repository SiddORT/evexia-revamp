"""Protected shared storage only. No rate selection or order integration."""
from datetime import date
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from app.db.gst_settings_models import GSTSettings
from app.services.allergens import AllergenError, authorize

# Serializes first inserts too; version zero represents an absent configuration.
SETTINGS_LOCK = 5310048


def view(row):
    if row is None:
        return dict(configured=False, version=0, cutoff_date=None, before_rate=None, on_after_rate=None)
    return dict(configured=True, version=row.version, cutoff_date=row.cutoff_date.isoformat(),
                before_rate=format(row.before_rate, ".2f"), on_after_rate=format(row.on_after_rate, ".2f"))


def transaction(db, actor, body=None):
    try:
        authorize(db, actor)  # Revalidate protected account, role and session.
        if not db.scalar(text("SELECT to_regclass('public.gst_settings') IS NOT NULL")):
            raise AllergenError("GST Settings schema is unavailable. Your edits are preserved.",
                                503, "gst_schema_unavailable")
        if body is not None:
            db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": SETTINGS_LOCK})
        row = db.scalar(select(GSTSettings).where(GSTSettings.id == 1))
        if body is not None:
            if (row.version if row else 0) != body.expected_version:
                raise AllergenError("GST Settings changed. Load and compare saved settings before saving your kept edits.",
                                    409, "gst_settings_stale")
            if row is None:
                row = GSTSettings(id=1, version=0)
                db.add(row)
            row.version += 1
            row.cutoff_date = date.fromisoformat(body.cutoff_date)
            # Validated decimal strings go directly to exact PostgreSQL NUMERIC.
            from decimal import Decimal
            row.before_rate = Decimal(body.before_rate)
            row.on_after_rate = Decimal(body.on_after_rate)
            db.flush()
        result = view(row)
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise AllergenError("GST Settings storage is unavailable. The save outcome is unconfirmed; load saved settings before retrying. Your edits are preserved.",
                            503, "gst_storage_unavailable") from None
    except Exception:
        db.rollback()
        raise
