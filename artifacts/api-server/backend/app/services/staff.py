import secrets
import uuid

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.security import hash_password, utcnow
from app.db.models import AuditEvent, User
from app.db.staff_models import StaffProfile
from app.services.auth import revalidate_identity
from app.services.staff_crypto import StaffCrypto, StaffError


def authorize(db, actor, settings):
    current = revalidate_identity(db, actor, lock=True)
    if "staff.manage" not in current.permissions:
        raise StaffError("Access denied", 403, "access_denied")
    crypto = StaffCrypto(settings)
    # Validate the stable blind-index key against persisted data before reads or
    # writes. An accidentally changed index key must not admit duplicate emails.
    first = db.scalar(select(StaffProfile).order_by(StaffProfile.id).limit(1))
    if first:
        email = crypto.decrypt(first.id, "email", first.email_ciphertext)
        if not secrets.compare_digest(crypto.email_index(email), first.email_index):
            raise StaffError()
    return current, crypto


def projection(db, profile, crypto, username=None):
    username = username if username is not None else db.get(User, profile.user_id).username
    return dict(
        id=profile.id, userId=username, version=profile.version,
        **{field: crypto.decrypt(profile.id, field, getattr(profile, f"{field}_ciphertext"))
           for field in ("name", "email", "phone")},
        dialCountry=profile.dial_country, role=profile.role, designation=profile.designation,
        dateOfJoining=profile.joining_date, status=profile.status,
        createdBy=str(profile.created_by), updatedBy=str(profile.updated_by),
        createdAt=profile.created_at, updatedAt=profile.updated_at,
    )


def assign(profile, body, crypto):
    for field in ("name", "email", "phone"):
        setattr(profile, f"{field}_ciphertext", crypto.encrypt(profile.id, field, str(getattr(body, field))))
    profile.email_index = crypto.email_index(str(body.email))
    profile.dial_country = body.dialCountry
    profile.role, profile.designation = body.role, body.designation
    profile.joining_date, profile.status = body.dateOfJoining, body.status


def audit(db, actor, profile, action):
    db.add(AuditEvent(
        actor_id=actor.user.id, session_id=actor.session_id, action=action,
        resource_type="staff", resource_id=profile.id, outcome="success",
        request_id=db.info.get("request_id"),
    ))


def transaction(work, db):
    try:
        return work()
    except IntegrityError:
        db.rollback()
        raise StaffError("Staff email or identity already exists", 409, "staff_duplicate") from None
    except SQLAlchemyError:
        db.rollback()
        raise StaffError() from None
    except Exception:
        db.rollback()
        raise


def create(db, actor, body, settings):
    def work():
        current, crypto = authorize(db, actor, settings)
        # 120 random bits in a 32-character username, independent of personal data.
        password = secrets.token_urlsafe(24)
        encoded_password = hash_password(password)
        for attempt in range(5):
            try:
                with db.begin_nested():
                    user = User(id=uuid.uuid4(), username="st_" + secrets.token_hex(14), email=None,
                                password_hash=encoded_password, system_role=None)
                    db.add(user)
                    db.flush()
                break
            except IntegrityError as error:
                if getattr(getattr(error.orig, "diag", None), "constraint_name", None) != "ix_users_username":
                    raise
                if attempt == 4:
                    raise StaffError()
        profile = StaffProfile(id=uuid.uuid4(), user_id=user.id, version=1,
                               created_by=current.user.id, updated_by=current.user.id)
        assign(profile, body, crypto)
        db.add(profile)
        db.flush()
        audit(db, current, profile, "staff_create")
        result = projection(db, profile, crypto)
        db.commit()
        return {"record": result, "initial_password": password}
    return transaction(work, db)


def listing(db, actor, settings, limit, offset):
    def work():
        _current, crypto = authorize(db, actor, settings)
        rows = list(db.scalars(select(StaffProfile).order_by(
            StaffProfile.created_at.desc(), StaffProfile.id.desc()).limit(limit + 1).offset(offset)))
        result = {"items": [projection(db, row, crypto) for row in rows[:limit]],
                  "has_more": len(rows) > limit, "limit": limit, "offset": offset}
        db.commit()
        return result
    return transaction(work, db)


SEARCH_SCAN_LIMIT = 500
SEARCH_FIELDS = ("name", "email", "phone", "userId", "dialCountry", "role",
                 "designation", "dateOfJoining", "status")


def search(db, actor, settings, body):
    def work():
        # Transaction-local only; bound DB execution and same-admin lock waits.
        db.execute(text("SET LOCAL statement_timeout = '2000ms'"))
        db.execute(text("SET LOCAL lock_timeout = '1000ms'"))
        _current, crypto = authorize(db, actor, settings)
        # Primary-key keyset scan: no plaintext predicates, new blind indexes,
        # counts, offsets, stored search sessions, or unbounded result buffers.
        stmt = select(StaffProfile, User.username).join(User, User.id == StaffProfile.user_id)
        if body.cursor is not None:
            stmt = stmt.where(StaffProfile.id > body.cursor)
        rows = list(db.execute(stmt.order_by(StaffProfile.id).limit(SEARCH_SCAN_LIMIT + 1)))
        term = body.query.casefold()
        items, scanned, last_id = [], 0, None
        for profile, username in rows[:SEARCH_SCAN_LIMIT]:
            record = projection(db, profile, crypto, username)
            scanned += 1
            last_id = profile.id
            if any(term in str(record[field]).casefold() for field in SEARCH_FIELDS):
                items.append(record)
                if len(items) == body.limit:
                    break
        has_more = len(rows) > scanned
        result = dict(items=items, has_more=has_more,
                      next_cursor=last_id if has_more else None,
                      scanned=scanned, scan_limit=SEARCH_SCAN_LIMIT, limit=body.limit)
        db.commit()
        return result
    return transaction(work, db)


def detail(db, actor, settings, profile_id):
    def work():
        _current, crypto = authorize(db, actor, settings)
        profile = db.get(StaffProfile, profile_id)
        if not profile:
            raise StaffError("Staff member not found", 404, "not_found")
        result = projection(db, profile, crypto)
        db.commit()
        return result
    return transaction(work, db)


def edit(db, actor, settings, profile_id, body, status_only=False):
    def work():
        current, crypto = authorize(db, actor, settings)
        profile = db.scalar(select(StaffProfile).where(StaffProfile.id == profile_id)
                            .execution_options(populate_existing=True).with_for_update())
        if not profile:
            raise StaffError("Staff member not found", 404, "not_found")
        # Verify stored ciphertext even for status-only writes.
        projection(db, profile, crypto)
        if profile.version != body.expected_version:
            raise StaffError("Staff record changed. Your draft has not been saved. Review current details before retrying.",
                             409, "staff_stale")
        if status_only:
            profile.status = body.status
        else:
            assign(profile, body, crypto)
        profile.version += 1
        profile.updated_by, profile.updated_at = current.user.id, utcnow()
        audit(db, current, profile, "staff_status" if status_only else "staff_update")
        db.flush()
        result = projection(db, profile, crypto)
        db.commit()
        return result
    return transaction(work, db)
