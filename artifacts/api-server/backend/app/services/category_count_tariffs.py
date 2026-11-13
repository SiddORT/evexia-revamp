"""Protected append-only tariff history; serialized with quotes and quantities."""
import uuid
from sqlalchemy import select, text
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.product_category_models import ProductCategory
from app.db.pricing_rule_models import CategoryCountTariff as Tariff, PricingRuleRequest
from app.schemas.rates import rate
from app.services.pricing_rules import transaction, PricingRuleError
from app.services.purchase_received_crypto import PRError


def ready(db):
    db.execute(text("SELECT id,category_id,allergen_count,effective_from,version,payload_ciphertext,actor_id,recorded_at FROM it_category_count_tariffs LIMIT 0"))
    for name, trigger_type in (("it_tariff_immutable", 27), ("it_tariff_no_truncate", 34)):
        if not db.scalar(text("""
            SELECT EXISTS (
                SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
                WHERE t.tgrelid='it_category_count_tariffs'::regclass
                  AND t.tgname=:name AND t.tgenabled='O' AND t.tgtype=:kind
                  AND p.proname='inventory_immutable' AND NOT t.tgisinternal
            )
        """), dict(name=name, kind=trigger_type)):
            raise RuntimeError("Immutable tariff history guard required")
    for name, columns in (
        ("uq_it_tariff_date", ["category_id", "allergen_count", "effective_from"]),
        ("uq_it_tariff_version", ["category_id", "allergen_count", "version"]),
    ):
        actual = db.execute(text("""
            SELECT a.attname::text FROM pg_constraint c
            CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum,position)
            JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
            WHERE c.conrelid='it_category_count_tariffs'::regclass AND c.conname=:name AND c.contype='u'
            ORDER BY k.position
        """), dict(name=name)).scalars().all()
        if actual != columns:
            raise RuntimeError("Unambiguous tariff timeline constraints required")


def categories(db, actor, query, offset, limit, saved_only):
    def work(_, crypto):
        stmt = select(ProductCategory).where(ProductCategory.deleted_at.is_(None))
        if saved_only:
            stmt = stmt.where(ProductCategory.id.in_(select(Tariff.category_id)))
        if query.strip():
            stmt = stmt.where(ProductCategory.name.icontains(query.strip(), autoescape=True))
        rows = list(db.scalars(stmt.order_by(ProductCategory.name, ProductCategory.id).offset(offset).limit(limit + 1)))
        return dict(items=[dict(id=str(row.id), name=row.name, status=row.status) for row in rows[:limit]],
                    nextOffset=offset + limit if len(rows) > limit else None)
    return transaction(db, actor, work)


def project(row, crypto):
    try:
        payload = crypto.open(row.id, "it-count-tariff", row.payload_ciphertext)
        amount = rate(payload["totalMrp"])
        if amount != payload["totalMrp"]:
            raise ValueError()
    except (PRError, KeyError, TypeError, ValueError):
        raise PricingRuleError("Saved category/count price is unreadable. No replacement price was assumed.",
                               503, "it_tariff_unreadable") from None
    return dict(id=str(row.id), categoryId=str(row.category_id), allergenCount=row.allergen_count,
                totalMrp=amount, effectiveFrom=row.effective_from.isoformat(), version=row.version,
                actorId=str(row.actor_id), recordedAt=row.recorded_at.isoformat())


def history(db, actor, category_id):
    def work(_, crypto):
        category = db.get(ProductCategory, category_id)
        if not category or category.deleted_at:
            raise PricingRuleError("Choose a saved available category.", 404, "it_tariff_category")
        suggestion, suggestion_error = None, None
        try:
            suggestion = rate(str(category.unit_price))
        except (TypeError, ValueError):
            suggestion_error = "The category Unit Price is missing or unreadable. No zero suggestion was substituted."
        rows = db.scalars(select(Tariff).where(Tariff.category_id == category_id).order_by(
            Tariff.allergen_count, Tariff.effective_from, Tariff.version))
        return dict(categoryId=str(category_id), categoryName=category.name,
                    suggestedUnitPrice=suggestion, suggestionError=suggestion_error, categoryVersion=category.version,
                    history=[project(row, crypto) for row in rows])
    return transaction(db, actor, work)


def save(db, actor, body):
    def work(current, crypto):
        request = dict(operation="append-category-count-tariff",
                       body=body.model_dump(mode="json", exclude={"idempotencyKey"}))
        prior = db.get(PricingRuleRequest, body.idempotencyKey)
        if prior:
            if prior.actor_id != current.user.id:
                raise PricingRuleError("This request key is already owned by another submission.",
                                       409, "it_tariff_request_conflict")
            saved = crypto.open(prior.key, "it-pricing-request", prior.payload_ciphertext)
            if saved["request"] != request:
                raise PricingRuleError("Retry the original unchanged submission with its own request key.",
                                       409, "it_tariff_request_conflict")
            return saved

        def outcome(**value):
            db.add(PricingRuleRequest(key=body.idempotencyKey, actor_id=current.user.id,
                payload_ciphertext=crypto.seal(body.idempotencyKey, "it-pricing-request",
                                               dict(request=request, **value))))
            db.flush()
            return value

        def reject(message, code):
            return outcome(error=dict(message=message, status=409, code=code))

        category = db.scalar(select(ProductCategory).where(ProductCategory.id == body.categoryId).with_for_update())
        if not category or category.deleted_at or category.status != "active":
            return reject("Choose an active saved category.", "it_tariff_category")
        rows = list(db.scalars(select(Tariff).where(
            Tariff.category_id == body.categoryId, Tariff.allergen_count == body.allergenCount)))
        version = max((row.version for row in rows), default=0)
        if version != body.expected_version:
            return reject("This count tariff changed. Reload saved history and compare your retained draft.",
                          "it_tariff_stale")
        if any(row.effective_from == body.effectiveFrom for row in rows):
            return reject("This count already has a rate starting on that date. Append a different effective date; history cannot be overwritten.",
                          "it_tariff_duplicate_date")
        now = utcnow()
        row = Tariff(id=uuid.uuid4(), category_id=category.id, allergen_count=body.allergenCount,
                     effective_from=body.effectiveFrom, version=version + 1,
                     actor_id=current.user.id, recorded_at=now)
        row.payload_ciphertext = crypto.seal(row.id, "it-count-tariff", dict(totalMrp=body.totalMrp))
        db.add(row)
        db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
            request_id=db.info.get("request_id"), action="it_category_count_tariff_added",
            resource_type="product_category", resource_id=category.id, outcome="success"))
        db.flush()
        return outcome(response=project(row, crypto))
    result = transaction(db, actor, work)
    if "error" in result:
        error = PricingRuleError(**result["error"])
        # Only a durable owner/body-matched rejection closes an uncertain save.
        error.tariff_terminal = True
        raise error
    return result["response"]


def applicable(db, crypto, category_id, count, effective_date):
    row = db.scalar(select(Tariff).where(Tariff.category_id == category_id,
        Tariff.allergen_count == count, Tariff.effective_from <= effective_date)
        .order_by(Tariff.effective_from.desc()).limit(1))
    if row is None:
        from app.services.immunotherapy import ImmError
        raise ImmError(f"No applicable Total Suborder MRP for category {category_id}, count {count}, order date {effective_date.isoformat()}. Admin must save an explicit dated tariff; no legacy or master-price fallback is used.",
                       409, "imm_count_price_missing")
    return project(row, crypto)
