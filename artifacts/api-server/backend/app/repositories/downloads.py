from sqlalchemy import case, func, literal, or_, select
from app.db.download_models import DownloadLog as D
from app.db.models import User
from app.repositories.reporting import public_user, user_columns
from app.services.downloads import MODULES, BROWSER, SERVER, label


def listing(db, limit, offset, user_id, start, end, q, format):
    labels = {f"{s}/{k}": label(s, k) for catalog in (BROWSER, SERVER)
              for s, kinds in catalog.items() for k in kinds}
    report_label = case(labels, value=D.source + literal("/") + D.kind, else_="Download")
    module = case(MODULES, value=D.source, else_="System")
    query = select(D.id, D.created_at, D.format, D.provenance,
                   report_label.label("download_label"), module.label("module"), *user_columns()
                   ).select_from(D).outerjoin(User, User.id == D.actor_id)
    if user_id:
        query = query.where(D.actor_id == user_id)
    if start:
        query = query.where(D.created_at >= start)
    if end:
        query = query.where(D.created_at < end)
    if format:
        query = query.where(D.format == format)
    if q:
        query = query.where(or_(*(field.icontains(q, autoescape=True) for field in (
            report_label, module, D.format, func.coalesce(User.username, User.email),
            case({"server_prepared": "Server-prepared", "browser_reported": "Browser-reported"},
                 value=D.provenance)))))
    # A single statement guarantees consistent totals and rows under concurrent writes.
    filtered = query.cte("filtered_downloads")
    count = select(func.count()).select_from(filtered).scalar_subquery()
    page = select(filtered).order_by(filtered.c.created_at.desc(), filtered.c.id.desc()).limit(limit).offset(offset).subquery()
    rows = db.execute(select(count.label("total"), page).select_from(
        select(literal(1)).subquery()).outerjoin(page, literal(True)).order_by(
            page.c.created_at.desc(), page.c.id.desc())).mappings().all()
    total = rows[0]["total"]
    items = [{**{k: r[k] for k in ("id", "created_at", "format", "provenance", "module")},
              "label": r["download_label"], "user": public_user(r)} for r in rows if r["id"] is not None]
    return dict(items=items, total=total, limit=limit, offset=offset, has_more=offset + len(items) < total)
