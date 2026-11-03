"""Protected, atomic configuration only. No imports by order services."""
import logging
import uuid
from sqlalchemy import Text, cast, delete, func, literal, or_, select, text
from sqlalchemy.dialects.postgresql import aggregate_order_by
from sqlalchemy.exc import SQLAlchemyError
from fastapi import HTTPException
from app.core.config import get_settings
from app.core.security import utcnow
from app.db.allergen_models import AllergenProduct
from app.db.product_category_models import ProductCategory
from app.db.pricing_rule_models import PricingRule, PricingRuleTarget, PricingRuleRequest, PricingRuleCategory
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
    targets = list(db.scalars(select(PricingRuleTarget).where(
        PricingRuleTarget.rule_id == row.id).order_by(PricingRuleTarget.category_id, PricingRuleTarget.allergen_id)))
    categories = list(db.scalars(select(PricingRuleCategory.category_id).where(
        PricingRuleCategory.rule_id == row.id).order_by(PricingRuleCategory.category_id)))
    if not targets or not categories or any(t.category_id not in categories for t in targets):
        raise PricingRuleError()
    return dict(id=str(row.id), version=row.version, category=reference(db.get(ProductCategory, row.category_id)),
                categories=[reference(db.get(ProductCategory, cid)) for cid in categories],
                allergens=[dict(reference(db.get(AllergenProduct, t.allergen_id), True),
                                savedCategoryId=str(t.category_id)) for t in targets], **data)


def search_term(query):
    return query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def listing(db, actor, offset, limit, query=""):
    def work(_, crypto):
        stmt = select(PricingRule)
        term = search_term(query)
        if term:
            pattern = "%" + term + "%"
            category_match = select(PricingRuleCategory.rule_id).join(
                ProductCategory, ProductCategory.id == PricingRuleCategory.category_id).where(
                ProductCategory.name.ilike(pattern, escape="\\"))
            allergen_match = select(PricingRuleTarget.rule_id).join(
                AllergenProduct, AllergenProduct.id == PricingRuleTarget.allergen_id).where(
                AllergenProduct.name.ilike(pattern, escape="\\"))
            stmt = stmt.where(or_(PricingRule.id.in_(category_match), PricingRule.id.in_(allergen_match)))
        total = db.scalar(select(func.count()).select_from(stmt.subquery()))
        rows = db.scalars(stmt.order_by(PricingRule.created_at.desc(), PricingRule.id).offset(offset).limit(limit))
        return dict(items=[projection(db, row, crypto) for row in rows], total=total, offset=offset, limit=limit)
    return transaction(db, actor, work)


def detail(db, actor, record_id):
    return transaction(db, actor, lambda _, crypto: projection(db, db.get(PricingRule, record_id), crypto))


def references(db, actor, kind, query, offset, limit, category_id, category_ids=None):
    def work(_, crypto):
        model = ProductCategory if kind == "categories" else AllergenProduct
        stmt = select(model).where(model.deleted_at.is_(None), model.status == "active")
        if kind == "allergens":
            if category_ids is not None and category_id is not None:
                raise PricingRuleError("Use only one category selection format.", 422, "pricing_rule_category")
            ids = set(category_ids or ([category_id] if category_id else []))
            cats = list(db.scalars(select(ProductCategory).where(ProductCategory.id.in_(ids))))
            if not ids or len(cats) != len(ids) or any(c.deleted_at or c.status != "active" for c in cats):
                raise PricingRuleError("Choose active product categories before selecting allergens.", 422, "pricing_rule_category")
            stmt = stmt.where(model.category_id.in_(ids))
        term = search_term(query)
        if term:
            stmt = stmt.where(model.name.ilike("%" + term + "%", escape="\\"))
        scope = stmt.subquery()
        identity = cast(scope.c.id, Text) + scope.c.name
        if kind == "allergens":
            identity = identity + cast(scope.c.category_id, Text)
        total, version = db.execute(select(func.count(), func.md5(func.coalesce(
            func.string_agg(identity, aggregate_order_by(literal("|"), scope.c.id)), ""))).select_from(scope)).one()
        # Stable category grouping across page boundaries, not name-only mixing.
        if kind == "allergens":
            stmt = stmt.join(ProductCategory, ProductCategory.id == model.category_id)
            ordering = (ProductCategory.name, ProductCategory.id, model.name, model.id)
        else:
            ordering = (model.name, model.id)
        rows = db.scalars(stmt.order_by(*ordering).offset(offset).limit(limit))
        return dict(items=[reference(row, kind == "allergens") for row in rows], total=total,
                    offset=offset, limit=limit, catalogueVersion=version)
    return transaction(db, actor, work)


def save(db, actor, body, record_id=None):
    def work(current, crypto):
        # Canonical normalized request identity includes destination, edit version
        # and operation. Retry replies are stored encrypted in the SAME commit.
        request = dict(operation="edit" if record_id else "create",
                       recordId=str(record_id) if record_id else None,
                       body=body.retry_body())
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
        category_ids = body.selected_categories()
        cats = list(db.scalars(select(ProductCategory).where(ProductCategory.id.in_(category_ids))
                               .order_by(ProductCategory.id).with_for_update()))
        if len(cats) != len(category_ids) or any(c.deleted_at or c.status != "active" for c in cats):
            return reject("Select existing active product categories.", 422, "pricing_rule_category")
        allergens = list(db.scalars(select(AllergenProduct).where(AllergenProduct.id.in_(body.allergenIds))
                                   .order_by(AllergenProduct.id).with_for_update()))
        if len(allergens) != len(body.allergenIds) or any(a.deleted_at or a.status != "active" or a.category_id not in category_ids for a in allergens):
            return reject("Every selected allergen must exist, be active and belong to a selected category. Clear unavailable selections and choose again.", 422, "pricing_rule_allergens")
        expected_categories = body.allergenCategoryIds
        if expected_categories is None and row:
            # Older callers cannot explicitly approve a moved retained target.
            expected_categories = {t.allergen_id: t.category_id for t in db.scalars(
                select(PricingRuleTarget).where(PricingRuleTarget.rule_id == row.id))}
        if expected_categories and any(a.id in expected_categories and expected_categories[a.id] != a.category_id for a in allergens):
            return reject("An allergen changed category. Remove it and explicitly reselect it from its current category; no rule was changed.", 409, "pricing_rule_allergen_moved")
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
            db.execute(delete(PricingRuleCategory).where(PricingRuleCategory.rule_id == row.id))
        row.category_id = cats[0].id  # Retained compatibility anchor, not the full membership.
        row.updated_by, row.updated_at = current.user.id, now
        row.payload_ciphertext = crypto.seal(row.id, "it-pricing-rule", dict(
            cutoff=body.cutoff.isoformat(), beforeRate=body.beforeRate, afterRate=body.afterRate))
        db.flush()
        db.add_all(PricingRuleCategory(rule_id=row.id, category_id=c.id) for c in cats)
        db.add_all(PricingRuleTarget(rule_id=row.id, allergen_id=a.id, category_id=a.category_id) for a in allergens)
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
