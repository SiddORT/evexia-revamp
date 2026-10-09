"""Policy → verified actor/session → Doctor graph → reference → balance."""
from decimal import Decimal
from sqlalchemy import String, cast, func, or_, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.doctor_models import DoctorDirectory as Doctor
from app.db.opening_balance_models import OpeningBalance as Balance
from app.services import mrs
from app.services.auth import revalidate_identity
from app.services.zone_policy import lock_policy
from app.services.zones import label
from app.services import directory_runtime as encrypted


class OpeningBalanceError(Exception):
    def __init__(self, message="Opening Balance service is unavailable. Your draft is preserved; retry later.",
                 status=503, code="opening_balance_unavailable"):
        self.message, self.status, self.code = message, status, code


def transaction(db, work):
    try:
        db.execute(text("SET LOCAL lock_timeout = '5s'"))
        db.execute(text("SET LOCAL statement_timeout = '15s'"))
        return work()
    except IntegrityError:
        db.rollback()
        raise OpeningBalanceError("Doctor/year already exists or a reference changed. Review current records.",
                                  409, "opening_balance_conflict") from None
    except SQLAlchemyError:
        db.rollback()
        raise OpeningBalanceError() from None
    except Exception:
        db.rollback()
        raise


def authorize(db, actor):
    # This workflow is deliberately absent from the assignable master catalogue.
    lock_policy(db)
    current = revalidate_identity(db, actor, lock=True)
    if not (current.user.is_protected_system_admin and current.role == "super_admin"
            and "admin.access" in current.permissions):
        raise OpeningBalanceError("Access denied", 403, "access_denied")
    encrypted.ready(db)
    return current


def usable(doctor):
    return bool(doctor and not getattr(doctor, "deleted_at", None) and doctor.status == "active")


def reference(db, doctor_id, existing=None):
    doctor = db.scalar(select(Doctor).where(Doctor.id == doctor_id)
                       .execution_options(populate_existing=True).with_for_update())
    if not doctor or (not usable(doctor) and (not existing or existing.doctorId != doctor_id)):
        raise OpeningBalanceError("New references require an active shared Doctor. The unchanged saved reference may be retained.",
                                  409, "opening_balance_reference")
    return doctor


def projection(db, row, context=None):
    doctor = context["doctors"].get(row.doctorId) if context is not None else db.get(Doctor, row.doctorId)
    return dict(id=row.id, startYear=row.startYear, endYear=row.endYear, doctorId=row.doctorId,
                amount=format(row.amount, ".2f"), status=row.status, version=row.version,
                doctorName=doctor.name if doctor else "Unavailable saved Doctor",
                registrationNumber=doctor.registrationNumber if doctor else "", doctorUsable=usable(doctor),
                createdBy=context["authors"].get(row.created_by, "Backend user") if context is not None else label(db, row.created_by),
                updatedBy=context["authors"].get(row.updated_by, "Backend user") if context is not None else label(db, row.updated_by),
                createdAt=row.created_at, updatedAt=row.updated_at)


def projection_context(db, rows):
    from app.db.models import User
    from types import SimpleNamespace
    docs = mrs._bulk(db, (row.doctorId for row in rows),
                    lambda ids: select(Doctor.id, Doctor.name_ciphertext, Doctor.registrationNumber,
                                       Doctor.deleted_at, Doctor.status).where(Doctor.id.in_(ids)))
    docs = {key: SimpleNamespace(**dict(value._mapping), name=encrypted.read_name(value, "doctor_directory"))
            for key, value in docs.items()}
    authors = mrs._bulk(db, (key for row in rows for key in (row.created_by, row.updated_by)),
                       lambda ids: select(User.id, User.is_protected_system_admin).where(User.id.in_(ids)))
    return dict(doctors=docs, authors={key: "Super Admin" if value.is_protected_system_admin else "Backend user"
                                     for key, value in authors.items()})


def predicates(query="", status="all"):
    result = [Balance.deleted_at.is_(None)]
    if query.strip():
        pattern = "%" + mrs.literal(query) + "%"
        years = cast(Balance.startYear, String) + "-" + cast(Balance.endYear, String)
        displayed_years = cast(Balance.startYear, String) + "–" + cast(Balance.endYear, String)
        amount_text = cast(Balance.amount, String)
        grouped_amount = func.regexp_replace(func.regexp_replace(amount_text,
            r"(\d)(?=(\d{2})+\d{3}\.)", r"\1,", "g"), r"(\d)(\d{3}\.)", r"\1,\2")
        result.append(or_(years.ilike(pattern, escape="\\"), displayed_years.ilike(pattern, escape="\\"),
            grouped_amount.ilike(pattern, escape="\\"),
            cast(Balance.amount, String).ilike(pattern, escape="\\"),
            Balance.doctorId.in_(select(Doctor.id).where(or_(
                Doctor.registrationNumber.ilike(pattern, escape="\\"))))))
    if status != "all":
        result.append(Balance.status == status)
    return result


def search_matcher(db, query, rows):
    names = {}
    ids = list({row.doctorId for row in rows})
    for start in range(0, len(ids), 500):
        for row in db.execute(select(Doctor.id, Doctor.name_ciphertext, Doctor.registrationNumber).where(
                Doctor.id.in_(ids[start:start + 500]))):
            names[row.id] = (encrypted.read_name(row, "doctor_directory"), row.registrationNumber)
    def matches(row):
        import re
        amount = format(row.amount, ".2f")
        grouped = re.sub(r"(\d)(?=(\d{2})+\d{3}\.)", r"\1,", amount)
        grouped = re.sub(r"(\d)(\d{3}\.)", r"\1,\2", grouped)
        return encrypted.match(query, *names.get(row.doctorId, ()), f"{row.startYear}-{row.endYear}",
                               f"{row.startYear}–{row.endYear}", amount, grouped)
    return matches


def listing(db, actor, query="", status="all", limit=10, offset=0, cursor=None):
    def work():
        authorize(db, actor)
        total = db.scalar(select(func.count()).select_from(Balance).where(Balance.deleted_at.is_(None)))
        meta = {}
        if query.strip():
            rows, meta = encrypted.scan(db, Balance, predicates("", status), None, limit=limit, cursor=cursor,
                                        prepare=lambda rows: search_matcher(db, query, rows))
            filtered = None
        else:
            filtered = db.scalar(select(func.count()).select_from(Balance).where(*predicates("", status)))
            rows = db.scalars(select(Balance).where(*predicates("", status)).order_by(
                Balance.created_at.desc(), Balance.id.desc()).limit(limit).offset(offset))
        rows = list(rows)
        context = projection_context(db, rows)
        result = dict(items=[projection(db, row, context) for row in rows], total=total, filtered=filtered, limit=limit, offset=offset, **meta)
        db.commit()
        return result
    return transaction(db, work)


def choices(db, actor, query="", limit=50, offset=0, balance_id=None, cursor=None):
    def work():
        authorize(db, actor)
        clauses = [Doctor.status == "active", Doctor.deleted_at.is_(None)]
        if query.strip():
            rows, meta = encrypted.scan(db, Doctor, clauses, lambda row: encrypted.match(query, row.name, row.registrationNumber), limit=limit, cursor=cursor)
            total = None
        else:
            total = db.scalar(select(func.count()).select_from(Doctor).where(*clauses))
            rows = list(db.scalars(select(Doctor).where(*clauses).order_by(Doctor.id).limit(limit).offset(offset)))
            meta = {}
        # Only a saved balance authorizes retaining an unavailable reference.
        saved = db.get(Doctor, find(db, balance_id).doctorId) if balance_id else None
        if saved and not saved.deleted_at and saved not in rows:
            rows.append(saved)
        result = dict(items=[dict(id=d.id, name=d.name, registrationNumber=d.registrationNumber, usable=usable(d)) for d in rows],
                      total=total, limit=limit, offset=offset, **meta)
        db.commit()
        return result
    return transaction(db, work)


def find(db, record_id):
    row = db.scalar(select(Balance).where(Balance.id == record_id, Balance.deleted_at.is_(None))
                    .execution_options(populate_existing=True).with_for_update())
    if not row:
        raise OpeningBalanceError("Opening balance not found. It may have been deleted.", 404, "not_found")
    return row


def detail(db, actor, record_id):
    def work():
        authorize(db, actor)
        result = projection(db, find(db, record_id))
        db.commit()
        return result
    return transaction(db, work)


def audit(db, actor, row, operation):
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id, action="opening_balance_" + operation,
                     resource_type="opening_balance", resource_id=row.id, outcome="success", request_id=db.info.get("request_id")))


def insert(db, actor, body):
    now = utcnow()
    row = Balance(**body.model_dump(exclude={"amount"}), amount=Decimal(body.amount),
                  created_by=actor.user.id, updated_by=actor.user.id, created_at=now, updated_at=now)
    db.add(row)
    db.flush()
    audit(db, actor, row, "create")
    return row


def create(db, actor, body):
    def work():
        current = authorize(db, actor)
        mrs.graph_lock(db)
        reference(db, body.doctorId)
        result = projection(db, insert(db, current, body))
        db.commit()
        return result
    return transaction(db, work)


def mutate(db, actor, record_id, body, operation):
    def work():
        current = authorize(db, actor)
        mrs.graph_lock(db)
        row = find(db, record_id)
        if row.version != body.expected_version:
            raise OpeningBalanceError("Opening balance changed. Your draft was not saved. Reload current details before retrying.",
                                      409, "opening_balance_stale")
        now = utcnow()
        if operation == "delete":
            row.deleted_at, row.deleted_by = now, current.user.id
        else:
            if operation == "edit":
                reference(db, body.doctorId, row)
                for field, value in body.model_dump(exclude={"expected_version"}).items():
                    setattr(row, field, Decimal(value) if field == "amount" else value)
            else:
                row.status = body.status
        row.version += 1
        row.updated_at, row.updated_by = now, current.user.id
        audit(db, current, row, operation)
        db.flush()
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)
