import secrets
import uuid

from sqlalchemy import select, text, func, union
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.core.security import hash_password, utcnow
from app.db.models import AuditEvent, User
from app.db.staff_models import StaffProfile
from app.db.designation_models import Designation
from app.services.auth import revalidate_identity
from app.services.staff_crypto import StaffCrypto, StaffError
from app.db.role_models import CustomRole
from app.repositories import sessions as session_repository
from app.services.zone_policy import lock_policy


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


def projection(db, profile, crypto, username=None, designation_name=None):
    username = username if username is not None else db.get(User, profile.user_id).username
    designation_name = designation_name if designation_name is not None else db.get(Designation, profile.designation_id).name
    return dict(
        id=profile.id, userId=username, employeeCode=profile.employee_code, version=profile.version,
        **{field: crypto.decrypt(profile.id, field, getattr(profile, f"{field}_ciphertext"))
           for field in ("name", "email", "phone")},
        dialCountry=profile.dial_country, role=profile.role, designation_id=profile.designation_id,
        designationName=designation_name, deleted_at=profile.deleted_at, deleted_by=profile.deleted_by,
        dateOfJoining=profile.joining_date, status=profile.status,
        createdBy=str(profile.created_by), updatedBy=str(profile.updated_by),
        createdAt=profile.created_at, updatedAt=profile.updated_at,
        custom_role_id=profile.custom_role_id, workspace_login_enabled=profile.workspace_login_enabled,
    )


def assign(profile, body, crypto):
    for field in ("name", "email", "phone"):
        setattr(profile, f"{field}_ciphertext", crypto.encrypt(profile.id, field, str(getattr(body, field))))
    profile.email_index = crypto.email_index(str(body.email))
    profile.dial_country = body.dialCountry
    profile.role, profile.designation_id = body.role, body.designation_id
    profile.joining_date, profile.status = body.dateOfJoining, body.status
    # Old clients omit this optional metadata. Only an explicit value may clear it.
    if "employeeCode" in body.model_fields_set:
        profile.employee_code = body.employeeCode


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


def validate_designation(db, designation_id, saved_id=None):
    row = db.scalar(select(Designation).where(Designation.id == designation_id)
                    .execution_options(populate_existing=True).with_for_update(read=True))
    if not row or (designation_id != saved_id and (row.status != "active" or row.deleted_at is not None)):
        raise StaffError("Choose an active, non-deleted designation.", 409, "staff_designation_invalid")
    return row


def validate_business_role(db, name, saved_name=None):
    # Historical snapshots may be retained verbatim. Never assign access here.
    if name == saved_name:
        return
    role = db.scalar(select(CustomRole).where(CustomRole.name == name, CustomRole.deleted_at.is_(None))
                     .execution_options(populate_existing=True).with_for_update(read=True))
    if role is None:
        raise StaffError("Selected business role is no longer available. Search current roles and choose again; your draft is retained.",
                         409, "staff_role_invalid")


def role_choices(db, actor, settings, query, offset, include_retained=False):
    def work():
        db.execute(text("SET LOCAL statement_timeout = '2000ms'"))
        db.execute(text("SET LOCAL lock_timeout = '1000ms'"))
        authorize(db, actor, settings)
        names = select(CustomRole.name.label("name")).where(CustomRole.deleted_at.is_(None))
        if include_retained:
            # Directory filters include historical snapshots, not permission assignments.
            names = union(names, select(StaffProfile.role.label("name")).where(StaffProfile.deleted_at.is_(None)))
        source = names.subquery()
        condition = source.c.name.icontains(query, autoescape=True)
        total = db.scalar(select(func.count()).select_from(source).where(condition))
        rows = db.scalars(select(source.c.name).where(condition).order_by(source.c.name).limit(50).offset(offset))
        result = dict(items=[dict(name=name) for name in rows], total=total)
        db.commit()
        return result
    return transaction(work, db)


def generated_staff_password():
    # Staff-specific candidates; manual/recovery and MR policies are unchanged.
    groups = ("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz", "0123456789", "!@#$%^&*_-+?")
    chars = [secrets.choice(group) for group in groups]
    chars.extend(secrets.choice("".join(groups)) for _ in range(8))
    for index in range(len(chars) - 1, 0, -1):
        other = secrets.randbelow(index + 1)
        chars[index], chars[other] = chars[other], chars[index]
    return "".join(chars)


def create(db, actor, body, settings):
    def work():
        current, crypto = authorize(db, actor, settings)
        validate_designation(db, body.designation_id)
        validate_business_role(db, body.role)
        # 120 random bits in a 32-character username, independent of personal data.
        chosen = getattr(body, "initialPassword", None)
        password = chosen if chosen is not None else generated_staff_password()
        encoded_password = hash_password(password)
        for attempt in range(5):
            try:
                with db.begin_nested():
                    user = User(id=uuid.uuid4(), username="st_" + secrets.token_hex(14), email=None,
                                password_hash=encoded_password, system_role=None,
                                password_setup_required=chosen is None)
                    db.add(user)
                    db.flush()
                break
            except IntegrityError as error:
                if getattr(getattr(error.orig, "diag", None), "constraint_name", None) not in {
                    "ix_users_username", "uq_users_lower_username", "uq_users_login_namespace", "uq_users_username_index",
                }:
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


def directory_filters(stmt, filters):
    # Exact predicates on existing business metadata only; never workspace roles
    # or designation availability. Historical saved designation IDs remain valid.
    for field in ("status", "designation_id", "role"):
        value = getattr(filters, field, None)
        if value is not None:
            stmt = stmt.where(getattr(StaffProfile, field) == value)
    return stmt


def filter_designations(db, actor, settings, cursor):
    def work():
        db.execute(text("SET LOCAL statement_timeout = '2000ms'"))
        db.execute(text("SET LOCAL lock_timeout = '1000ms'"))
        authorize(db, actor, settings)
        used = select(StaffProfile.id).where(
            StaffProfile.designation_id == Designation.id,
            StaffProfile.deleted_at.is_(None)).exists()
        stmt = select(Designation).where(used)
        if cursor is not None:
            stmt = stmt.where(Designation.id > cursor)
        rows = list(db.scalars(stmt.order_by(Designation.id).limit(101)))
        result = dict(
            items=[dict(id=row.id, name=row.name, status=row.status,
                        deleted=row.deleted_at is not None) for row in rows[:100]],
            has_more=len(rows) > 100,
            next_cursor=rows[99].id if len(rows) > 100 else None)
        db.commit()
        return result
    return transaction(work, db)


def listing(db, actor, settings, limit, offset, filters=None):
    def work():
        _current, crypto = authorize(db, actor, settings)
        stmt = directory_filters(select(StaffProfile, User.id, User.username_ciphertext, User.username_index, Designation.name)
            .join(User, User.id == StaffProfile.user_id)
            .join(Designation, Designation.id == StaffProfile.designation_id)
            .where(StaffProfile.deleted_at.is_(None)), filters)
        rows = list(db.execute(stmt.order_by(
            StaffProfile.created_at.desc(), StaffProfile.id.desc()).limit(limit + 1).offset(offset)))
        from app.services.account_crypto import read
        result = {"items": [projection(db, row, crypto, read(owner, "username", ciphertext, digest), name)
                            for row, owner, ciphertext, digest, name in rows[:limit]],
                  "has_more": len(rows) > limit, "limit": limit, "offset": offset}
        db.commit()
        return result
    return transaction(work, db)


SEARCH_SCAN_LIMIT = 500
SEARCH_FIELDS = ("name", "email", "phone", "userId", "dialCountry", "role",
                 "designationName", "dateOfJoining", "status")


def search(db, actor, settings, body):
    def work():
        # Transaction-local only; bound DB execution and same-admin lock waits.
        db.execute(text("SET LOCAL statement_timeout = '2000ms'"))
        db.execute(text("SET LOCAL lock_timeout = '1000ms'"))
        _current, crypto = authorize(db, actor, settings)
        # Primary-key keyset scan: no plaintext personal-data predicates, new
        # blind indexes, counts, offsets, stored sessions or unbounded buffers.
        stmt = (select(StaffProfile, User.id, User.username_ciphertext, User.username_index, Designation.name).join(User, User.id == StaffProfile.user_id)
                .join(Designation, Designation.id == StaffProfile.designation_id)
                .where(StaffProfile.deleted_at.is_(None)))
        stmt = directory_filters(stmt, body)
        if body.cursor is not None:
            stmt = stmt.where(StaffProfile.id > body.cursor)
        rows = list(db.execute(stmt.order_by(StaffProfile.id).limit(SEARCH_SCAN_LIMIT + 1)))
        term = body.query.casefold()
        items, scanned, last_id = [], 0, None
        from app.services.account_crypto import read
        for profile, owner, ciphertext, digest, name in rows[:SEARCH_SCAN_LIMIT]:
            username = read(owner, "username", ciphertext, digest)
            record = projection(db, profile, crypto, username, name)
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
        if not profile or profile.deleted_at is not None:
            raise StaffError("Staff member not found", 404, "not_found")
        result = projection(db, profile, crypto)
        db.commit()
        return result
    return transaction(work, db)


def edit(db, actor, settings, profile_id, body, status_only=False):
    def work():
        lock_policy(db)
        current, crypto = authorize(db, actor, settings)
        snapshot = db.get(StaffProfile, profile_id)
        if not snapshot or snapshot.deleted_at is not None:
            raise StaffError("Staff member not found", 404, "not_found")
        user = session_repository.lock_user(db, snapshot.user_id)
        profile = db.scalar(select(StaffProfile).where(StaffProfile.id == profile_id)
                            .execution_options(populate_existing=True).with_for_update())
        if not profile or profile.deleted_at is not None:
            raise StaffError("Staff member not found", 404, "not_found")
        # Verify stored ciphertext even for status-only writes.
        projection(db, profile, crypto)
        if profile.version != body.expected_version:
            raise StaffError("Staff record changed. Your draft has not been saved. Review current details before retrying.",
                             409, "staff_stale")
        if status_only:
            profile.status = body.status
        else:
            validate_designation(db, body.designation_id, profile.designation_id)
            validate_business_role(db, body.role, profile.role)
            assign(profile, body, crypto)
        if profile.status != "active":
            session_repository.revoke_user_sessions(db, user.id, "identity_invalid", db.info.get("request_id"))
        profile.version += 1
        profile.updated_by, profile.updated_at = current.user.id, utcnow()
        audit(db, current, profile, "staff_status" if status_only else "staff_update")
        db.flush()
        result = projection(db, profile, crypto)
        db.commit()
        return result
    return transaction(work, db)


def access(db, actor, settings, profile_id, body):
    def work():
        lock_policy(db)
        current, crypto = authorize(db, actor, settings)
        snapshot = db.get(StaffProfile, profile_id)
        if not snapshot or snapshot.deleted_at is not None:
            raise StaffError("Staff member not found", 404, "not_found")
        user = session_repository.lock_user(db, snapshot.user_id)
        profile = db.scalar(select(StaffProfile).where(StaffProfile.id == profile_id)
                            .execution_options(populate_existing=True).with_for_update())
        if not profile or profile.deleted_at is not None:
            raise StaffError("Staff member not found", 404, "not_found")
        if (not user or user.system_role is not None
                or user.is_protected_system_admin or user.email is not None):
            raise StaffError("This identity cannot be assigned staff access", 403, "access_denied")
        projection(db, profile, crypto)
        if profile.version != body.expected_version:
            raise StaffError("Staff record changed. Review current details before retrying.", 409, "staff_stale")
        if body.custom_role_id is not None:
            role = db.scalar(select(CustomRole).where(CustomRole.id == body.custom_role_id).with_for_update())
            if not role or role.deleted_at is not None:
                raise StaffError("Selected role is unavailable. Choose a current role or explicitly unassign it.", 409, "role_deleted")
        if body.workspace_login_enabled and (profile.status != "active" or not user.is_active):
            raise StaffError("Activate this staff account before enabling workspace login.", 409, "staff_inactive")
        profile.custom_role_id = body.custom_role_id
        profile.workspace_login_enabled = body.workspace_login_enabled
        profile.version += 1
        profile.updated_by, profile.updated_at = current.user.id, utcnow()
        if not body.workspace_login_enabled:
            session_repository.revoke_user_sessions(db, user.id, "identity_invalid", db.info.get("request_id"))
        audit(db, current, profile, "staff_access")
        db.flush()
        result = projection(db, profile, crypto)
        try:
            db.commit()
        except SQLAlchemyError:
            raise StaffError("Access change outcome unknown. Refresh current staff details before submitting again.",
                             503, "staff_outcome_unknown") from None
        return result
    return transaction(work, db)


def delete(db, actor, settings, profile_id, body):
    def work():
        lock_policy(db)
        current, crypto = authorize(db, actor, settings)
        snapshot = db.get(StaffProfile, profile_id)
        if not snapshot or snapshot.deleted_at is not None:
            raise StaffError("Staff member not found", 404, "not_found")
        user = session_repository.lock_user(db, snapshot.user_id)
        profile = db.scalar(select(StaffProfile).where(StaffProfile.id == profile_id)
                            .execution_options(populate_existing=True).with_for_update())
        if not profile or profile.deleted_at is not None:
            raise StaffError("Staff member not found", 404, "not_found")
        projection(db, profile, crypto)  # Verify ciphertext before lifecycle writes.
        if profile.version != body.expected_version:
            raise StaffError("Staff record changed. Review current details before deleting.", 409, "staff_stale")
        profile.deleted_at, profile.deleted_by = utcnow(), current.user.id
        profile.version += 1
        profile.updated_at, profile.updated_by = profile.deleted_at, current.user.id
        session_repository.revoke_user_sessions(db, user.id, "identity_invalid", db.info.get("request_id"))
        audit(db, current, profile, "staff_delete")
        db.flush()
        result = projection(db, profile, crypto)
        try:
            db.commit()
        except SQLAlchemyError:
            raise StaffError("Delete outcome unknown. Refresh the directory before retrying.",
                             503, "staff_outcome_unknown") from None
        return result
    return transaction(work, db)
