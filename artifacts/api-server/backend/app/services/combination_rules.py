"""Saved-key configuration directory. Never imported by order consumers."""
import uuid
from sqlalchemy import select, text, func, and_
from sqlalchemy.orm import aliased
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.pricing_rule_models import CombinationTariff as Tariff, CombinationRuleStatus as Status, CombinationRequest
from app.schemas.combination_pricing import CombinationScope
from app.services.pricing_rules import transaction, PricingRuleError
from app.services.combination_pricing import fail, project, scope


def ready(db):
    db.execute(text("SELECT id,category_id,dosage,member_key,version,status,revision_id,actor_id,recorded_at FROM it_combination_rule_status LIMIT 0"))
    for name, kind in (("it_combination_status_immutable", 27), ("it_combination_status_no_truncate", 34)):
        if not db.scalar(text("""
            SELECT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
            WHERE t.tgrelid='it_combination_rule_status'::regclass AND t.tgname=:name
            AND t.tgenabled='O' AND t.tgtype=:kind AND p.proname='inventory_immutable'
            AND NOT t.tgisinternal)
        """), dict(name=name, kind=kind)):
            raise RuntimeError("Immutable configuration status guards required")
    if list(db.scalars(text("""
        SELECT a.attname::text FROM pg_constraint c
        CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum,position)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
        WHERE c.conrelid='it_combination_rule_status'::regclass
        AND c.conname='uq_it_combination_status_version' AND c.contype='u' ORDER BY k.position
    """))) != ["category_id", "dosage", "member_key", "version"]:
        raise RuntimeError("Unambiguous configuration status versions required")


def same(model, row):
    return (model.category_id == row.category_id, model.dosage == row.dosage, model.member_key == row.member_key)


def latest(db, record_id):
    anchor = db.get(Tariff, record_id)
    if not anchor:
        fail("Saved combination rule not found.", "not_found", 404)
    return db.scalar(select(Tariff).where(*same(Tariff, anchor)).order_by(Tariff.version.desc()).limit(1))


def status_row(db, row):
    return db.scalar(select(Status).where(*same(Status, row)).order_by(Status.version.desc()).limit(1))


def saved(db, row, crypto):
    event = status_row(db, row)
    if not event:
        fail("Saved configuration status is missing. Reconcile the prepared schema; no status was assumed.", "status_missing", 503)
    return dict(latest=project(row, crypto), status=event.status, statusVersion=event.version)


def event_view(row):
    return dict(id=str(row.id), status=row.status, version=row.version, actorId=str(row.actor_id),
                recordedAt=row.recorded_at.isoformat(), revisionId=str(row.revision_id))


def listing(db, actor, query, status, offset, limit):
    def work(_, crypto):
        # Search encrypted immutable saved names, not today's catalogue, and
        # never create unconfigured combinations. No plaintext name index is
        # introduced. An unfiltered page decrypts only that page; encrypted
        # searches stream bounded batches and fail rather than truncate.
        rates = select(Tariff).distinct(Tariff.category_id, Tariff.dosage, Tariff.member_key).order_by(
            Tariff.category_id, Tariff.dosage, Tariff.member_key, Tariff.version.desc()).subquery()
        states = select(Status).distinct(Status.category_id, Status.dosage, Status.member_key).order_by(
            Status.category_id, Status.dosage, Status.member_key, Status.version.desc()).subquery()
        rate, state = aliased(Tariff, rates), aliased(Status, states)
        actual_status = state.status
        stmt = select(rate, actual_status, state.version).outerjoin(state, and_(
            rate.category_id == state.category_id, rate.dosage == state.dosage, rate.member_key == state.member_key))
        total = db.scalar(select(func.count()).select_from(rates))
        if db.scalar(select(func.count()).select_from(stmt.where(state.id.is_(None)).subquery())):
            fail("Saved configuration status is missing. Reconcile the prepared schema; no partial directory is shown.", "status_missing", 503)
        if status != "all":
            stmt = stmt.where(actual_status == status)
        stmt = stmt.order_by(rate.category_id, rate.dosage, rate.member_key)
        term = query.strip().casefold()
        if not term:
            filtered = db.scalar(select(func.count()).select_from(stmt.subquery()))
            items = [dict(latest=project(row, crypto), status=active, statusVersion=version)
                     for row, active, version in db.execute(stmt.offset(offset).limit(limit))]
            return dict(items=items, total=total, filtered=filtered, offset=offset, limit=limit)
        # This is a refusal, never a partial-result count. Keep the shared
        # pricing lock and decryption workload bounded as history grows.
        if total > 20000:
            fail("Saved-name search exceeds the safe 20,000-rule scan limit. Clear search to review paged records; no partial search results are shown.", "search_bound", 422)
        items, filtered = [], 0
        for row, active, version in db.execute(stmt.execution_options(yield_per=100)):
            value = dict(latest=project(row, crypto), status=active, statusVersion=version)
            revision = value["latest"]
            haystack = " ".join([revision["categoryName"], revision["dosage"],
                                *[m["name"] for m in revision["members"]]]).casefold()
            if term in haystack:
                if offset <= filtered < offset + limit:
                    items.append(value)
                filtered += 1
        return dict(items=items, total=total, filtered=filtered, offset=offset, limit=limit)
    return transaction(db, actor, work)


def detail(db, actor, record_id):
    return transaction(db, actor, lambda _, crypto: saved(db, latest(db, record_id), crypto))


def history(db, actor, record_id, offset, limit):
    def work(_, crypto):
        row = latest(db, record_id)
        events = list(db.scalars(select(Status).where(*same(Status, row))
                                .order_by(Status.version.desc()).offset(offset).limit(limit + 1)))
        return dict(items=[event_view(e) for e in events[:limit]],
                    nextOffset=offset + limit if len(events) > limit else None)
    return transaction(db, actor, work)


def change_status(db, actor, record_id, body):
    def work(current, crypto):
        request = dict(operation="combination-rule-status", revisionId=str(record_id),
                       body=body.model_dump(mode="json", exclude={"idempotencyKey"}))
        prior = db.get(CombinationRequest, body.idempotencyKey)
        if prior:
            if prior.actor_id != current.user.id:
                fail("Request key belongs to another owner.", "request_conflict")
            previous = crypto.open(prior.key, "it-pricing-request", prior.payload_ciphertext)
            if previous["request"] != request:
                fail("Retry the original unchanged status submission.", "request_conflict")
            return previous

        def outcome(**value):
            db.add(CombinationRequest(key=body.idempotencyKey, actor_id=current.user.id,
                payload_ciphertext=crypto.seal(body.idempotencyKey, "it-pricing-request", dict(request=request, **value))))
            db.flush()
            return value

        try:
            row = latest(db, record_id)
            old = status_row(db, row)
            if not old:
                fail("Saved configuration status is missing. Reconcile the prepared schema.", "status_missing", 503)
            if row.id != record_id or old.version != body.expectedVersion:
                fail("This rule changed. Refresh records and review before a new status action.", "stale")
            if body.status == old.status:
                fail("The rule already has this status. Refresh records.", "stale")
            if body.status == "active":
                # Reactivation never restores deleted/ineligible catalogue data.
                _, groups, _, _ = scope(db, CombinationScope(categoryId=row.category_id, dosage=row.dosage,
                      size=len(row.member_key.split(",")),
                      allergenIds=[uuid.UUID(id) for id in row.member_key.split(",")]))
                if row.member_key not in groups:
                    fail("These saved members are no longer eligible for this combination. Catalogue records were not reactivated.", "eligibility")
        except PricingRuleError as error:
            if error.status >= 500:
                raise
            return outcome(error=dict(message=error.message, status=error.status, code=error.code))
        event = Status(id=uuid.uuid4(), category_id=row.category_id, dosage=row.dosage,
            member_key=row.member_key, version=body.expectedVersion + 1, status=body.status,
            revision_id=row.id, actor_id=current.user.id, recorded_at=utcnow())
        db.add(event)
        db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
            request_id=db.info.get("request_id"), action="it_combination_rule_status_changed",
            resource_type="product_category", resource_id=row.category_id, outcome="success"))
        db.flush()
        return outcome(response=dict(requestId=str(body.idempotencyKey), rule=saved(db, row, crypto), event=event_view(event)))
    result = transaction(db, actor, work)
    if "error" in result:
        error = PricingRuleError(**result["error"])
        error.tariff_terminal = True
        raise error
    return result["response"]
