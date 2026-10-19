"""Singleton-only catalogue. History and metadata-only audit commit with each write."""
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.language_models import Language, LanguageChange
from app.services.auth import revalidate_identity
from app.services.zone_policy import lock_policy, zone_allowed
from app.services.zones import label


class LanguageError(Exception):
    def __init__(self, message="Language persistence is unavailable. Retry later.", status=503, code="language_unavailable"):
        self.message, self.status, self.code = message, status, code


def transaction(db, work):
    try:
        return work()
    except IntegrityError as exc:
        db.rollback()
        if getattr(getattr(exc.orig, "diag", None), "constraint_name", None) == "uq_languages_live_name":
            raise LanguageError("A non-deleted language already uses this name. Review current records.",
                                409, "language_duplicate") from None
        raise LanguageError() from None
    except SQLAlchemyError:
        db.rollback()
        raise LanguageError() from None
    except Exception:
        db.rollback()
        raise


def authorize(db, actor):
    lock_policy(db)
    current = revalidate_identity(db, actor, lock=True)
    if not zone_allowed(current, protected=True):
        raise LanguageError("Language access denied.", 403, "access_denied")
    return current


def projection(db, row):
    return dict(id=row.id, name=row.name, version=row.version,
                createdBy=label(db, row.created_by), updatedBy=label(db, row.updated_by),
                createdAt=row.created_at, updatedAt=row.updated_at,
                deletedBy=label(db, row.deleted_by) if row.deleted_by else None, deletedAt=row.deleted_at)


def find(db, record_id, *, deleted=False):
    filters = [Language.id == record_id]
    if not deleted:
        filters.append(Language.deleted_at.is_(None))
    row = db.scalar(select(Language).where(*filters).execution_options(populate_existing=True).with_for_update())
    if not row:
        raise LanguageError("Language not found. It may have been deleted.", 404, "not_found")
    return row


def listing(db, actor, query, limit, offset):
    def work():
        authorize(db, actor)
        filters = [Language.deleted_at.is_(None)]
        total = db.scalar(select(func.count()).select_from(Language).where(*filters))
        if query.strip():
            escaped = query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            filters.append(Language.name.collate("pg_c_utf8").ilike("%" + escaped + "%", escape="\\"))
        filtered = db.scalar(select(func.count()).select_from(Language).where(*filters))
        rows = db.scalars(select(Language).where(*filters).order_by(Language.created_at.desc(), Language.id.desc())
                          .limit(limit).offset(offset))
        result = dict(items=[projection(db, row) for row in rows], total=total, filtered=filtered,
                      limit=limit, offset=offset)
        db.commit()
        return result
    return transaction(db, work)


def detail(db, actor, record_id):
    def work():
        authorize(db, actor)
        result = projection(db, find(db, record_id))
        db.commit()
        return result
    return transaction(db, work)


def record_change(db, actor, row, action, before):
    event = AuditEvent(actor_id=actor.user.id, session_id=actor.session_id,
                       action="language_" + action, resource_type="language", resource_id=row.id,
                       outcome="success", request_id=db.info.get("request_id"), created_at=row.updated_at)
    db.add(event)
    db.flush()
    db.add(LanguageChange(language_id=row.id, version=row.version, action=action, actor_id=actor.user.id,
                          at=row.updated_at, before_name=before, after_name=row.name, event_id=event.id))
    db.flush()


def create(db, actor, body):
    def work():
        current = authorize(db, actor)
        now = utcnow()
        row = Language(name=body.name, created_by=current.user.id, updated_by=current.user.id,
                       created_at=now, updated_at=now)
        db.add(row)
        db.flush()
        record_change(db, current, row, "create", None)
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)


def mutate(db, actor, record_id, body, operation):
    def work():
        current = authorize(db, actor)
        row = find(db, record_id)
        if row.version != body.expected_version:
            raise LanguageError("Language changed. Your draft is preserved. Review current details before retrying.",
                                409, "language_stale")
        before = row.name
        now = utcnow()
        if operation == "delete":
            row.deleted_at, row.deleted_by = now, current.user.id
        else:
            row.name = body.name
        row.version += 1
        row.updated_at, row.updated_by = now, current.user.id
        db.flush()
        record_change(db, current, row, operation, before)
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)


def history(db, actor, record_id, limit, offset):
    def work():
        authorize(db, actor)
        record = projection(db, find(db, record_id, deleted=True))
        filters = [LanguageChange.language_id == record_id]
        counts = dict(db.execute(select(LanguageChange.action, func.count()).where(*filters)
                                 .group_by(LanguageChange.action)).all())
        latest = db.scalar(select(func.max(LanguageChange.at)).where(*filters))
        total = sum(counts.values())
        rows = db.scalars(select(LanguageChange).where(*filters).order_by(LanguageChange.version.asc())
                          .limit(limit).offset(offset))
        result = dict(record=record, items=[dict(id=row.id, action=row.action, version=row.version,
                      actor=label(db, row.actor_id), at=row.at, beforeName=row.before_name, afterName=row.after_name)
                      for row in rows], total=total, limit=limit, offset=offset,
                      summary=dict(scope="All committed changes for this language, including deletion",
                                   creates=counts.get("create", 0), edits=counts.get("edit", 0),
                                   deletes=counts.get("delete", 0), total=total, latestChange=latest))
        db.commit()
        return result
    return transaction(db, work)
