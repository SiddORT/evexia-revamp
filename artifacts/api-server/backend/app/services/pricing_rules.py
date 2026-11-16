"""Shared protected transaction boundary for combination pricing configuration."""
import logging
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.core.config import get_settings
from app.services.auth import revalidate_identity
from app.services.capability_policy import is_super_admin
from app.services.zone_policy import lock_policy
from app.services.purchase_received_crypto import ReceiptCrypto, PRError

LOCK = 5310086


class PricingRuleError(Exception):
    def __init__(self, message="Pricing Rules storage is unavailable. Your editor is preserved; retry the unchanged save if its outcome is unknown.",
                 status=503, code="pricing_rules_unavailable"):
        self.message, self.status, self.code = message, status, code


def transaction(db, actor, work):
    try:
        lock_policy(db)
        from app.services.immunotherapy_material_pricing import configuration_locks
        configuration_locks(db)
        current = revalidate_identity(db, actor, lock=True)
        if not is_super_admin(current):
            raise HTTPException(403, "Pricing Rules require the protected Super Admin.")
        engine = db.get_bind().engine
        if engine.echo or logging.getLogger("sqlalchemy.engine").isEnabledFor(logging.INFO) or logging.getLogger("sqlalchemy.engine.Engine").isEnabledFor(logging.INFO):
            raise PricingRuleError()
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK})
        result = work(current, ReceiptCrypto(get_settings()))
        db.commit()
        return result
    except (SQLAlchemyError, PRError):
        db.rollback()
        raise PricingRuleError() from None
    except Exception:
        db.rollback()
        raise
