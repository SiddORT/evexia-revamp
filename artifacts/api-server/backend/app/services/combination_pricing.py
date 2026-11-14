"""Bounded, atomic, protected configuration. Never called from order quotation."""
import hashlib
import json
import math
import uuid
from itertools import combinations
from sqlalchemy import select, func, text, or_
from app.core.security import utcnow
from app.db.allergen_models import AllergenProduct as Allergen, ImmunotherapyDilutionMaterial
from app.db.product_category_models import ProductCategory
from app.db.pricing_rule_models import CombinationTariff as Tariff, CategoryCountTariff, PricingRuleRequest
from app.db.models import AuditEvent
from app.schemas.combination_pricing import MAX_MEMBERS, MAX_ROWS, CombinationRevision
from app.services.pricing_rules import transaction, PricingRuleError


def fail(message, code="eligibility", status=409):
    raise PricingRuleError(message, status, f"combination_{code}")


def ready(db):
    db.execute(text("SELECT id,category_id,dosage,member_key,effective_from,version,payload_ciphertext,actor_id,recorded_at FROM it_combination_tariffs LIMIT 0"))
    for name, kind in (("it_combination_immutable", 27), ("it_combination_no_truncate", 34)):
        if not db.scalar(text("""
            SELECT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
            WHERE t.tgrelid='it_combination_tariffs'::regclass AND t.tgname=:name
            AND t.tgenabled='O' AND t.tgtype=:kind AND p.proname='inventory_immutable'
            AND NOT t.tgisinternal)
        """), dict(name=name, kind=kind)):
            raise RuntimeError("Immutable combination history guards required")
    for name, columns in (
        ("uq_it_combination_date", ["category_id", "dosage", "member_key", "effective_from"]),
        ("uq_it_combination_version", ["category_id", "dosage", "member_key", "version"]),
    ):
        actual = db.execute(text("""
            SELECT a.attname::text FROM pg_constraint c
            CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum,position)
            JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
            WHERE c.conrelid='it_combination_tariffs'::regclass AND c.conname=:name AND c.contype='u'
            ORDER BY k.position
        """), dict(name=name)).scalars().all()
        if actual != columns:
            raise RuntimeError("Unambiguous combination timelines required")


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def member(row):
    return dict(id=str(row.id), name=row.name, mix=row.mix, version=row.version)


def eligible(db, category_id):
    return select(Allergen).where(
        Allergen.category_id == category_id, Allergen.deleted_at.is_(None), Allergen.status == "active",
        ~Allergen.id.in_(select(ImmunotherapyDilutionMaterial.product_id)))


def categories(db, actor, query, offset, limit):
    def work(_, crypto):
        stmt = select(ProductCategory).where(or_(ProductCategory.deleted_at.is_(None),
            ProductCategory.id.in_(select(Tariff.category_id)),
            ProductCategory.id.in_(select(CategoryCountTariff.category_id))))
        if query.strip():
            stmt = stmt.where(ProductCategory.name.icontains(query.strip(), autoescape=True))
        rows = list(db.scalars(stmt.order_by(ProductCategory.name, ProductCategory.id).offset(offset).limit(limit + 1)))
        return dict(items=[dict(id=str(r.id), name=r.name, status="deleted" if r.deleted_at else r.status)
                           for r in rows[:limit]], nextOffset=offset + limit if len(rows) > limit else None)
    return transaction(db, actor, work)


def allergens(db, actor, category_id, query, offset, limit):
    def work(_, crypto):
        stmt = eligible(db, category_id)
        if query.strip():
            stmt = stmt.where(Allergen.name.icontains(query.strip(), autoescape=True))
        total = db.scalar(select(func.count()).select_from(stmt.subquery()))
        rows = db.scalars(stmt.order_by(Allergen.name, Allergen.id).offset(offset).limit(limit))
        return dict(items=[member(row) for row in rows], total=total, offset=offset, limit=limit)
    return transaction(db, actor, work)


def scope(db, body):
    # Stop catalogue inserts/moves/deletions during the authoritative scope
    # snapshot as well as locking the chosen rows. Row locks alone miss phantoms.
    # These reads follow the shared policy/configuration/actor lock order.
    db.execute(text("LOCK TABLE allergen_products, product_categories, immunotherapy_dilution_material IN SHARE MODE"))
    category = db.scalar(select(ProductCategory).where(ProductCategory.id == body.categoryId).with_for_update())
    if not category or category.deleted_at or category.status != "active":
        fail("Choose an active saved Product Category.")
    stmt = eligible(db, category.id)
    if body.allergenIds is not None:
        stmt = stmt.where(Allergen.id.in_(body.allergenIds))
    rows = list(db.scalars(stmt.order_by(Allergen.id).limit(MAX_MEMBERS + 1).with_for_update()))
    if len(rows) > MAX_MEMBERS:
        fail(f"This category exceeds {MAX_MEMBERS} eligible allergens. Clear the initial All selection and select a smaller subset using the paged allergen list. Nothing was truncated.", "bound", 422)
    if body.allergenIds is not None and [r.id for r in rows] != body.allergenIds:
        fail("Selected allergens changed category/status or include the bound Dilution material. Review current masters and regenerate.")
    pool = rows if body.size == 1 else [r for r in rows if r.mix]
    count = math.comb(len(pool), body.size) if len(pool) >= body.size else 0
    if count > MAX_ROWS:
        fail(f"This scope generates {count} rows; the atomic limit is {MAX_ROWS}. Select a smaller allergen subset. No combinations were generated or saved partially.", "bound", 422)
    groups = {",".join(str(r.id) for r in group): list(group) for group in combinations(pool, body.size)}
    binding = db.scalar(select(ImmunotherapyDilutionMaterial.product_id))
    token = digest([str(category.id), category.version, str(binding), [member(r) for r in rows]])
    return category, groups, token


def latest_rows(db, body, groups):
    return {r.member_key: r for r in db.scalars(select(Tariff).where(
        Tariff.category_id == body.categoryId, Tariff.dosage == body.dosage,
        Tariff.member_key.in_(list(groups))).distinct(Tariff.member_key).order_by(
            Tariff.member_key, Tariff.version.desc()))}


def version(rows):
    return digest(sorted((key, str(row.id), row.version) for key, row in rows.items()))


def project(row, crypto):
    # Stored money and membership are checked, not repaired or inferred.
    from app.schemas.combination_pricing import exact_money
    try:
        payload = crypto.open(row.id, "it-combination-tariff", row.payload_ciphertext)
        if set(payload) != {"totalMrp", "categoryName", "members"}:
            raise ValueError()
        value = dict(id=str(row.id), categoryId=str(row.category_id), dosage=row.dosage,
            memberIds=row.member_key.split(","), effectiveFrom=row.effective_from.isoformat(),
            version=row.version, actorId=str(row.actor_id), recordedAt=row.recorded_at.isoformat(), **payload)
        exact_money(value["totalMrp"])
        CombinationRevision.model_validate(value)
        if ([m["id"] for m in value["members"]] != value["memberIds"]
                or value["memberIds"] != sorted(set(value["memberIds"]))
                or not 1 <= len(value["memberIds"]) <= 3):
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        fail("Saved combination price evidence is unreadable. No replacement price was assumed.", "unreadable", 503)
    return value


def generate(db, actor, body):
    def work(_, crypto):
        _, groups, token = scope(db, body)
        saved = latest_rows(db, body, groups)
        query = body.query.strip().casefold()
        matches = [(key, group) for key, group in groups.items()
                   if not query or any(query in r.name.casefold() for r in group)]
        return dict(categoryId=str(body.categoryId), dosage=body.dosage, size=body.size,
            eligibilityVersion=token, scopeVersion=version(saved), scopeTotal=len(groups), scopeKeys=list(groups),
            rowVersions={key: saved[key].version if key in saved else 0 for key in groups},
            total=len(matches), offset=body.offset, limit=body.limit,
            items=[dict(key=key, members=[member(r) for r in group],
                        latest=project(saved[key], crypto) if key in saved else None)
                   for key, group in matches[body.offset:body.offset + body.limit]])
    return transaction(db, actor, work)


def history(db, actor, category_id, dosage, member_key, offset, limit):
    def work(_, crypto):
        stmt = select(Tariff).where(Tariff.category_id == category_id, Tariff.dosage == dosage)
        if member_key:
            stmt = stmt.where(Tariff.member_key == member_key)
        rows = list(db.scalars(stmt.order_by(Tariff.effective_from, Tariff.member_key, Tariff.version)
                              .offset(offset).limit(limit + 1)))
        return dict(items=[project(r, crypto) for r in rows[:limit]],
                    nextOffset=offset + limit if len(rows) > limit else None)
    return transaction(db, actor, work)


def save(db, actor, body):
    def work(current, crypto):
        request = dict(operation="append-combination-prices",
                       body=body.model_dump(mode="json", exclude={"idempotencyKey"}))
        prior = db.get(PricingRuleRequest, body.idempotencyKey)
        if prior:
            if prior.actor_id != current.user.id:
                fail("Request key belongs to another owner.", "request_conflict")
            previous = crypto.open(prior.key, "it-pricing-request", prior.payload_ciphertext)
            if previous["request"] != request:
                fail("Retry the original unchanged submission with its original key.", "request_conflict")
            return previous

        def outcome(**result):
            db.add(PricingRuleRequest(key=body.idempotencyKey, actor_id=current.user.id,
                payload_ciphertext=crypto.seal(body.idempotencyKey, "it-pricing-request",
                                              dict(request=request, **result))))
            db.flush()
            return result

        try:
            category, groups, token = scope(db, body)
            saved = latest_rows(db, body, groups)
            if token != body.eligibilityVersion or version(saved) != body.scopeVersion:
                fail("Masters or saved rates changed. Reload and compare your retained draft before saving.", "stale")
            edits = {",".join(str(id) for id in edit.memberIds): edit.totalMrp for edit in body.edits}
            if len(edits) != len(body.edits) or any(key not in groups for key in edits):
                fail("Draft includes duplicate or ineligible combinations.", "members")
            amounts = {key: body.copyRate for key in groups} if body.copyRate is not None else {}
            amounts.update(edits)
            if not amounts:
                fail("Enter at least one explicit rate. Blank is not zero.", "empty")
            conflict = db.scalar(select(Tariff.id).where(Tariff.category_id == category.id,
                Tariff.dosage == body.dosage, Tariff.member_key.in_(list(amounts)),
                Tariff.effective_from == body.effectiveFrom).limit(1))
            if conflict:
                fail("At least one combination already has a revision on this date. Nothing was saved; choose a different date.", "date")
        except PricingRuleError as error:
            if error.status >= 500:
                raise
            return outcome(error=dict(message=error.message, status=error.status, code=error.code))
        result = []
        now = utcnow()
        for key, amount in amounts.items():
            row = Tariff(id=uuid.uuid4(), category_id=category.id, dosage=body.dosage,
                member_key=key, effective_from=body.effectiveFrom,
                version=saved[key].version + 1 if key in saved else 1,
                actor_id=current.user.id, recorded_at=now)
            row.payload_ciphertext = crypto.seal(row.id, "it-combination-tariff",
                dict(totalMrp=amount, categoryName=category.name, members=[member(r) for r in groups[key]]))
            db.add(row)
            result.append(project(row, crypto))
        db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
            request_id=db.info.get("request_id"), action="it_combination_prices_added",
            resource_type="product_category", resource_id=category.id, outcome="success"))
        db.flush()
        return outcome(response=dict(requestId=str(body.idempotencyKey), categoryId=str(category.id),
            dosage=body.dosage, effectiveFrom=body.effectiveFrom.isoformat(), saved=result,
            eligibilityVersion=body.eligibilityVersion, scopeVersion=body.scopeVersion))
    result = transaction(db, actor, work)
    if "error" in result:
        error = PricingRuleError(**result["error"])
        error.tariff_terminal = True
        raise error
    return result["response"]
