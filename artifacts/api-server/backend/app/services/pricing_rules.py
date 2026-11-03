"""Protected, atomic configuration only. No imports by order services."""
import logging
import uuid
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import SQLAlchemyError
from fastapi import HTTPException
from app.core.config import get_settings
from app.core.security import utcnow
from app.db.allergen_models import AllergenProduct
from app.db.product_category_models import ProductCategory
from app.db.pricing_rule_models import PricingRule, PricingRuleTarget, PricingRuleRequest
from app.db.models import AuditEvent
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
        current = revalidate_identity(db, actor, lock=True)
        if not is_super_admin(current):
            raise HTTPException(403, "Pricing Rules require the protected Super Admin.")
        engine = db.get_bind().engine
        if engine.echo or logging.getLogger("sqlalchemy.engine").isEnabledFor(logging.INFO) or logging.getLogger("sqlalchemy.engine.Engine").isEnabledFor(logging.INFO):
            raise PricingRuleError()
        # Serialize writes, reference validation and retries in one transaction.
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK})
        crypto = ReceiptCrypto(get_settings())
        result = work(current, crypto)
        db.commit()
        return result
    except (SQLAlchemyError, PRError):
        db.rollback()
        raise PricingRuleError() from None
    except Exception:
        db.rollback()
        raise


def reference(row, allergen=False):
    if row is None:
        raise PricingRuleError("A saved Pricing Rule reference is missing. Ask the operator to reconcile it; this is not an empty configuration.", 409, "pricing_rule_reference_missing")
    result = dict(id=str(row.id), name=row.name, status="deleted" if row.deleted_at else row.status)
    if allergen:
        result["categoryId"] = str(row.category_id)
    return result


def projection(db, row, crypto):
    if row is None:
        raise PricingRuleError("Pricing Rule not found.", 404, "pricing_rule_not_found")
    data = crypto.open(row.id, "it-pricing-rule", row.payload_ciphertext)
    targets = list(db.scalars(select(PricingRuleTarget.allergen_id).where(
        PricingRuleTarget.rule_id == row.id).order_by(PricingRuleTarget.allergen_id)))
    if not targets:
        raise PricingRuleError()
    return dict(id=str(row.id), version=row.version, category=reference(db.get(ProductCategory, row.category_id)),
                allergens=[reference(db.get(AllergenProduct, target), True) for target in targets], **data)


def listing(db, actor, offset, limit):
    def work(_, crypto):
        total = db.scalar(select(func.count()).select_from(PricingRule))
        rows = db.scalars(select(PricingRule).order_by(PricingRule.created_at.desc(), PricingRule.id).offset(offset).limit(limit))
        return dict(items=[projection(db, row, crypto) for row in rows], total=total, offset=offset, limit=limit)
    return transaction(db, actor, work)


def detail(db, actor, record_id):
    return transaction(db, actor, lambda _, crypto: projection(db, db.get(PricingRule, record_id), crypto))


def references(db, actor, kind, query, offset, limit, category_id):
    def work(_, crypto):
        model = ProductCategory if kind == "categories" else AllergenProduct
        stmt = select(model).where(model.deleted_at.is_(None), model.status == "active")
        if kind == "allergens":
            cat = db.get(ProductCategory, category_id) if category_id else None
            if not cat or cat.deleted_at or cat.status != "active":
                raise PricingRuleError("Choose an active product category before selecting allergens.", 422, "pricing_rule_category")
            stmt = stmt.where(model.category_id == category_id)
        term = query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        if term:
            stmt = stmt.where(model.name.ilike("%" + term + "%", escape="\\"))
        total = db.scalar(select(func.count()).select_from(stmt.subquery()))
        rows = db.scalars(stmt.order_by(model.name, model.id).offset(offset).limit(limit))
        return dict(items=[reference(row, kind == "allergens") for row in rows], total=total, offset=offset, limit=limit)
    return transaction(db, actor, work)


def save(db, actor, body, record_id=None):
    def work(current, crypto):
        # Canonical normalized request identity includes destination, edit version
        # and operation. Retry replies are stored encrypted in the SAME commit.
        request = dict(operation="edit" if record_id else "create",
                       recordId=str(record_id) if record_id else None,
                       body=body.model_dump(mode="json", exclude={"idempotencyKey"}))
        prior = db.get(PricingRuleRequest, body.idempotencyKey)
        if prior:
            if prior.actor_id != current.user.id:
                raise PricingRuleError("This request key is already in use. No rule was changed.", 409, "pricing_rule_request_conflict")
            saved = crypto.open(prior.key, "it-pricing-request", prior.payload_ciphertext)
            if saved["request"] != request:
                raise PricingRuleError("Retry the original unchanged save. A request key cannot be reused for different values.", 409, "pricing_rule_request_conflict")
            if "error" in saved:
                return {"rejected": saved["error"]}
            return saved["response"]
        def reject(message, status, code):
            # A durable rejection closes the request even when a delayed original
            # reaches this lock later. Never treat a mere absence as cancellation.
            error = dict(message=message, status=status, code=code)
            db.add(PricingRuleRequest(key=body.idempotencyKey, actor_id=current.user.id,
                                     payload_ciphertext=crypto.seal(body.idempotencyKey, "it-pricing-request",
                                                                    dict(request=request, error=error))))
            db.flush()
            return {"rejected": error}
        row = db.scalar(select(PricingRule).where(PricingRule.id == record_id).with_for_update()) if record_id else None
        if record_id and row is None:
            return reject("Pricing Rule not found. The editor has not been saved.", 404, "pricing_rule_not_found")
        if row and row.version != body.expected_version:
            return reject("This Pricing Rule was changed in another browser. Your editor was not saved. Review the latest saved rule before editing again.", 409, "pricing_rule_stale")
        # Lock authoritative masters, never trust names or cached category membership.
        cat = db.scalar(select(ProductCategory).where(ProductCategory.id == body.categoryId).with_for_update())
        if not cat or cat.deleted_at or cat.status != "active":
            return reject("Select an existing active product category.", 422, "pricing_rule_category")
        allergens = list(db.scalars(select(AllergenProduct).where(AllergenProduct.id.in_(body.allergenIds))
                                   .order_by(AllergenProduct.id).with_for_update()))
        if len(allergens) != len(body.allergenIds) or any(a.deleted_at or a.status != "active" or a.category_id != cat.id for a in allergens):
            return reject("Every selected allergen must exist, be active and belong to the selected category. Clear unavailable selections and choose again.", 422, "pricing_rule_allergens")
        conflict = select(PricingRuleTarget).where(PricingRuleTarget.allergen_id.in_(body.allergenIds))
        if row:
            conflict = conflict.where(PricingRuleTarget.rule_id != row.id)
        if db.scalar(conflict.limit(1)):
            return reject("One or more selected allergens already belong to another Pricing Rule. Edit that rule or choose different targets; nothing was overwritten.", 409, "pricing_rule_conflict")
        now = utcnow()
        if row is None:
            row = PricingRule(id=uuid.uuid4(), version=1, created_by=current.user.id, created_at=now)
            db.add(row)
        else:
            row.version += 1
            db.execute(delete(PricingRuleTarget).where(PricingRuleTarget.rule_id == row.id))
        row.category_id = cat.id
        row.updated_by, row.updated_at = current.user.id, now
        row.payload_ciphertext = crypto.seal(row.id, "it-pricing-rule", dict(
            cutoff=body.cutoff.isoformat(), beforeRate=body.beforeRate, afterRate=body.afterRate))
        db.flush()
        db.add_all(PricingRuleTarget(rule_id=row.id, allergen_id=a.id) for a in allergens)
        db.flush()
        response = projection(db, row, crypto)
        db.add(PricingRuleRequest(key=body.idempotencyKey, actor_id=current.user.id,
                                 payload_ciphertext=crypto.seal(body.idempotencyKey, "it-pricing-request",
                                                                dict(request=request, response=response))))
        db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
                          request_id=db.info.get("request_id"),
                          action="it_pricing_rule_edit" if record_id else "it_pricing_rule_create",
                          resource_type="it_pricing_rule", resource_id=row.id, outcome="success"))
        db.flush()
        return response
    result = transaction(db, actor, work)
    if "rejected" in result:
        raise PricingRuleError(**result["rejected"])
    return result
