from sqlalchemy import String, and_, case, column, func, literal, or_, select, values
from app.db.download_models import DownloadLog as D
from app.db.models import User
from app.repositories.reporting import public_user, user_columns
from app.services.downloads import MODULES, BROWSER, SERVER, label


def download_labels():
    return {f"{s}/{k}": label(s, k) for catalog in (BROWSER, SERVER)
            for s, kinds in catalog.items() for k in kinds}


def display_labels(source, kind):
    labels = download_labels()
    return (case(labels, value=source + literal("/") + kind, else_="Download"),
            case(MODULES, value=source, else_="System"))


def alias_search(mapping, field, fallback, q, name):
    # Match the small live catalog once, in PostgreSQL (not Python casefold).
    # Only keys whose public labels match can qualify; raw keys are not searchable.
    aliases = values(column("key", String), column("label", String), name=name).data(list(mapping.items()))
    matching = select(aliases.c.key).where(aliases.c.label.icontains(q, autoescape=True))
    return or_(field.in_(matching), and_(
        literal(fallback).icontains(q, autoescape=True), field.not_in(list(mapping)),
    ))


def listing(db, limit, offset, user_id, start, end, q, format):
    # Keep the count and ordered page narrow. Identity state and friendly labels
    # are display work, not something to compute/materialize for the whole ledger.
    query = select(D.id, D.created_at, D.actor_id, D.source, D.kind, D.format, D.provenance)
    if user_id:
        query = query.where(D.actor_id == user_id)
    if start:
        query = query.where(D.created_at >= start)
    if end:
        query = query.where(D.created_at < end)
    if format:
        query = query.where(D.format == format)
    if q:
        actors = select(User.id).where(func.coalesce(User.username, User.email).icontains(q, autoescape=True))
        query = query.where(or_(
            alias_search(download_labels(), D.source + literal("/") + D.kind, "Download", q, "report_aliases"),
            alias_search(MODULES, D.source, "System", q, "module_aliases"),
            D.format.icontains(q, autoescape=True),
            D.actor_id.in_(actors),
            and_(literal("Server-prepared").icontains(q, autoescape=True), D.provenance == "server_prepared"),
            and_(literal("Browser-reported").icontains(q, autoescape=True), D.provenance == "browser_reported"),
        ))
    # A single statement guarantees consistent totals and rows under concurrent writes.
    # PostgreSQL otherwise materializes multiply referenced CTEs, losing the
    # ordered index path and spilling wide rows even for a first-page request.
    filtered = query.cte("filtered_downloads").prefix_with("NOT MATERIALIZED")
    count = select(func.count()).select_from(filtered).scalar_subquery()
    page = select(filtered).order_by(filtered.c.created_at.desc(), filtered.c.id.desc()).limit(limit).offset(offset).subquery()
    report_label, module = display_labels(page.c.source, page.c.kind)
    rows = db.execute(select(
        count.label("total"), page.c.id, page.c.created_at, page.c.format, page.c.provenance,
        report_label.label("download_label"), module.label("module"), *user_columns(),
    ).select_from(select(literal(1)).subquery()).outerjoin(page, literal(True)).outerjoin(
        User, User.id == page.c.actor_id).order_by(
            page.c.created_at.desc(), page.c.id.desc())).mappings().all()
    total = rows[0]["total"]
    items = [{**{k: r[k] for k in ("id", "created_at", "format", "provenance", "module")},
              "label": r["download_label"], "user": public_user(r)} for r in rows if r["id"] is not None]
    return dict(items=items, total=total, limit=limit, offset=offset, has_more=offset + len(items) < total)
