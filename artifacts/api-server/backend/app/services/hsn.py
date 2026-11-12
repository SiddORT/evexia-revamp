"""One-to-one HSN/GST master. Changes never cascade into saved products."""
from decimal import Decimal
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.hsn_models import HsnMapping, HsnChange
from app.schemas.rates import rate, display_rate
from app.services.master_policy import authorize_master
from app.services.zones import label


class HsnError(Exception):
    def __init__(self, message="HSN storage is unavailable. Your draft is preserved; retry later.",
                 status=503, code="hsn_unavailable"):
        self.message, self.status, self.code = message, status, code


def transaction(db, work):
    try:
        return work()
    except IntegrityError as exc:
        db.rollback()
        constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", "")
        if constraint in ("hsn_mappings_code_key", "hsn_mappings_gst_key"):
            raise HsnError("HSN code or normalized GST rate is already assigned, including inactive mappings. Each must be unique.",
                           409, "hsn_duplicate") from None
        raise HsnError() from None
    except SQLAlchemyError:
        db.rollback()
        raise HsnError() from None
    except Exception:
        db.rollback()
        raise


def projection(db, row):
    return dict(id=row.id, code=row.code, gst=display_rate(row.gst), status=row.status, version=row.version,
                createdBy=label(db, row.created_by), updatedBy=label(db, row.updated_by),
                createdAt=row.created_at, updatedAt=row.updated_at)


def listing(db, actor, query="", status="all", limit=10, offset=0, *, lookup=False, code=None, gst=None):
    def work():
        authorize_master(db, actor, "allergen" if lookup else "hsn", error=HsnError)
        conditions = [HsnMapping.status == "active"] if lookup else []
        total = db.scalar(select(func.count()).select_from(HsnMapping).where(*conditions))
        if status != "all":
            conditions.append(HsnMapping.status == status)
        if code is not None:
            conditions.append(HsnMapping.code == code)
        if gst is not None:
            try:
                conditions.append(HsnMapping.gst == Decimal(rate(gst, Decimal("100"))))
            except ValueError:
                raise HsnError("GST must be a percentage from 0 to 100 with up to six source decimals.", 422, "hsn_invalid_gst") from None
        term = query.strip()
        if term:
            # An exact decimal equality enables reverse GST resolution. Code
            # substrings serve suggestions, never authorize product writes.
            pattern = "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            match = HsnMapping.code.like(pattern, escape="\\")
            try:
                match = or_(match, HsnMapping.gst == Decimal(rate(term, Decimal("100"))))
            except ValueError:
                pass
            conditions.append(match)
        filtered = db.scalar(select(func.count()).select_from(HsnMapping).where(*conditions))
        rows = db.scalars(select(HsnMapping).where(*conditions).order_by(HsnMapping.code, HsnMapping.id).limit(limit).offset(offset))
        result = dict(items=[projection(db, row) for row in rows], total=total, filtered=filtered, limit=limit, offset=offset)
        db.commit()
        return result
    return transaction(db, work)


def save(db, actor, body, record_id=None, *, status_only=False):
    def work():
        current = authorize_master(db, actor, "hsn", "edit" if record_id else "add", error=HsnError)
        before = {}
        now = utcnow()
        if record_id:
            row = db.scalar(select(HsnMapping).where(HsnMapping.id == record_id)
                            .execution_options(populate_existing=True).with_for_update())
            if row is None:
                raise HsnError("HSN mapping not found. Refresh records.", 404, "not_found")
            if row.version != body.expected_version:
                raise HsnError("HSN mapping changed. Keep your draft and review current records before retrying.", 409, "hsn_stale")
            before = dict(before_code=row.code, before_gst=row.gst, before_status=row.status)
            row.version += 1
            if not status_only:
                row.code, row.gst = body.code, Decimal(body.gst)
            row.status, row.updated_by, row.updated_at = body.status, current.user.id, now
        else:
            row = HsnMapping(code=body.code, gst=Decimal(body.gst), status=body.status, version=1,
                             created_by=current.user.id, updated_by=current.user.id, created_at=now, updated_at=now)
            db.add(row)
        db.flush()
        db.add(HsnChange(mapping_id=row.id, version=row.version, actor_id=current.user.id, at=now,
                         **before, after_code=row.code, after_gst=row.gst, after_status=row.status))
        db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
                         action="hsn_" + ("status" if status_only else "edit" if record_id else "create"),
                         resource_type="hsn", resource_id=row.id, outcome="success", request_id=db.info.get("request_id")))
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)
