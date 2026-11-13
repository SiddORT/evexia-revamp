"""Effective business dates are not audit timestamps. Reads never seed policy."""
from datetime import date, datetime
from zoneinfo import ZoneInfo
from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError
from app.db.gst_settings_models import GSTSettings, GSTPolicyRevision
from app.services.allergens import AllergenError, authorize

SETTINGS_LOCK = 5310048
APPROVED = [
    dict(applicable_from="0001-01-01", rate="12.00"),
    dict(applicable_from="2025-09-22", rate="5.00"),
]


def today():
    return datetime.now(ZoneInfo("Asia/Kolkata")).date()


def lock(db):
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": SETTINGS_LOCK})


def ready(db):
    db.execute(text("SELECT version,request_id,actor_id,actor_label,recorded_at,payload FROM gst_policy_revisions LIMIT 0"))
    for name, kind in (("gst_policy_immutable", 27), ("gst_policy_no_truncate", 34)):
        if db.scalar(text("""SELECT EXISTS (
            SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
            WHERE t.tgrelid = 'public.gst_policy_revisions'::regclass
            AND t.tgname=:name AND t.tgtype=:kind AND NOT t.tgisinternal
            AND t.tgenabled='O' AND p.proname='inventory_immutable')"""),
            {"name": name, "kind": kind}) is not True:
            raise AllergenError("Applicable GST history is unavailable.", 503, "gst_unavailable")


def state(db):
    ready(db)
    revision = db.scalar(select(GSTPolicyRevision).order_by(GSTPolicyRevision.version.desc()).limit(1))
    if revision:
        return revision.version, revision.payload["baseline"], revision.payload["new"], False
    row = db.get(GSTSettings, 1)
    baseline = dict(source="stored_configuration" if row else "approved_initial",
                    legacy_version=row.version if row else None,
                    cutoff_date=row.cutoff_date.isoformat() if row else "2025-09-22",
                    before_rate=format(row.before_rate, ".2f") if row else "12.00",
                    on_after_rate=format(row.on_after_rate, ".2f") if row else "5.00")
    periods = [dict(applicable_from="0001-01-01", rate=baseline["before_rate"])]
    if baseline["cutoff_date"] == "0001-01-01":
        periods[0]["rate"] = baseline["on_after_rate"]
    else:
        periods.append(dict(applicable_from=baseline["cutoff_date"], rate=baseline["on_after_rate"]))
    return 0, baseline, periods, periods != APPROVED


def selected(periods, business_date):
    return next(p for p in reversed(periods) if p["applicable_from"] <= business_date)


def view(db):
    version, baseline, periods, conflict = state(db)
    business_date = today().isoformat()
    return dict(configured=version > 0, version=version, baseline=baseline, periods=periods,
                requires_confirmation=conflict, business_date=business_date,
                current=selected(periods, business_date),
                scheduled=[p for p in periods if p["applicable_from"] > business_date])


def resolve(db, order_date):
    """Called inside the order transaction; serialize selection with policy saves."""
    lock(db)
    version, _, periods, conflict = state(db)
    if conflict:
        raise AllergenError("Super Admin must confirm the opening GST policy before first pricing.",
                            409, "gst_confirmation_required")
    day = order_date.isoformat() if isinstance(order_date, date) else order_date
    return dict(**selected(periods, day), policy_revision=version, order_date=day)


def history(db, before_version, limit):
    ready(db)
    query = select(GSTPolicyRevision)
    if before_version is not None:
        query = query.where(GSTPolicyRevision.version < before_version)
    rows = list(db.scalars(query.order_by(GSTPolicyRevision.version.desc()).limit(limit + 1)))
    return dict(items=[dict(version=r.version, effective_date=r.payload["effective_date"],
                           prior=r.payload["prior"], new=r.payload["new"], action=r.payload["action"],
                           recorded_at=r.recorded_at.isoformat(), actor_id=r.actor_id,
                           actor_label=r.actor_label) for r in rows[:limit]],
                next_before_version=rows[limit - 1].version if len(rows) > limit else None)


def transaction(db, actor, body=None, *, history_read=False, before_version=None, limit=10):
    try:
        current = authorize(db, actor)
        if history_read:
            result = history(db, before_version, limit)
        else:
            if body is not None:
                lock(db)
                version, baseline, periods, conflict = state(db)
                prior_request = db.scalar(select(GSTPolicyRevision).where(GSTPolicyRevision.request_id == body.request_id))
                request = body.model_dump(mode="json")
                if prior_request:
                    if prior_request.actor_id != current.user.id or prior_request.payload["request"] != request:
                        raise AllergenError("GST save identity cannot be reused.", 409, "gst_request_reused")
                    # A late retry cannot write another revision or revert a newer save.
                else:
                    if version != body.expected_version:
                        raise AllergenError("GST changed. Load and compare saved values; your draft is kept.", 409, "gst_settings_stale")
                    if body.action == "adopt_approved":
                        if version or body.rate is not None or body.applicable_from is not None:
                            raise AllergenError("Opening policy can only be confirmed once.", 422, "gst_invalid")
                        new, effective = APPROVED, "2025-09-22"
                    else:
                        if conflict:
                            raise AllergenError("Compare and explicitly confirm the approved opening policy first.", 409, "gst_confirmation_required")
                        if body.rate is None or body.applicable_from is None:
                            raise AllergenError("GST percentage and Applicable from are required.", 422, "gst_invalid")
                        if any(p["applicable_from"] == body.applicable_from for p in periods):
                            raise AllergenError("This effective date already exists. Choose a distinct date.", 409, "gst_duplicate_date")
                        if len(periods) >= 1000:
                            raise AllergenError("GST schedule reached its supported limit.", 409, "gst_limit")
                        effective = body.applicable_from
                        new = sorted([*periods, dict(applicable_from=effective, rate=body.rate)],
                                     key=lambda p: p["applicable_from"])
                    db.add(GSTPolicyRevision(version=version + 1, request_id=body.request_id,
                        actor_id=current.user.id, actor_label="Protected Super Admin",
                        payload=dict(request=request, baseline=baseline, prior=periods, new=new,
                                     action=body.action, effective_date=effective)))
                    db.flush()
            result = view(db)
            if body is not None:
                result["confirmed_request_id"] = str(body.request_id)
                result["confirmed_version"] = prior_request.version if prior_request else version + 1
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise AllergenError("Applicable GST storage is unavailable. Keep your draft; retry the unchanged save to confirm its outcome.",
                            503, "gst_unavailable") from None
    except Exception:
        db.rollback()
        raise
