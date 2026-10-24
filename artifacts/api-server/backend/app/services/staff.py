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


def authorize(db, actor, settings, action=None, *, protected=False, access_read=False):
    from app.services.capability_policy import authorize as check, is_super_admin
    if protected:
        lock_policy(db)
        current = revalidate_identity(db, actor, lock=True)
        if not is_super_admin(current):
            raise StaffError("Only Super Admin may change staff access", 403, "access_denied")
    else:
        current = check(db, actor, "staff_access" if access_read else "staff",
                        "view" if access_read else action, error=StaffError)
    crypto = StaffCrypto(settings)
    crypto.authorized_identity = current
    # Validate the stable blind-index key against persisted data before reads or
    # writes. An accidentally changed index key must not admit duplicate emails.
    first = db.scalar(select(StaffProfile).order_by(StaffProfile.id).limit(1))
    if first:
        email = crypto.decrypt(first.id, "email", first.email_ciphertext)
        if not secrets.compare_digest(crypto.email_index(email), first.email_index):
            raise StaffError()
    return current, crypto


def ordinary_target(user):
    if not user or user.system_role is not None or user.is_protected_system_admin or user.email is not None:
        raise StaffError("Protected accounts cannot be changed through Staff Management", 403, "access_denied")


def access_fields(current, body):
    # Reject even a no-op assignment supplied by an ordinary form. Omission,
    # not an unchanged client-supplied role, is the metadata-edit contract.
    from app.services.capability_policy import is_super_admin
    if not is_super_admin(current) and {"custom_role_id", "initialPassword"} & body.model_fields_set:
        raise StaffError("Only Super Admin may assign roles or configure credentials", 403, "access_denied")


def projection(db, profile, crypto, designation_name=None, role_name=None, role_available=None):
    from app.services.capability_policy import allowed
    access_visible = allowed(crypto.authorized_identity, "staff_access", "view")
    if role_name is None:
        assigned_role = db.get(CustomRole, profile.custom_role_id) if profile.custom_role_id else None
        role_name = assigned_role.name if assigned_role and assigned_role.deleted_at is None else (
            "Unavailable role" if profile.custom_role_id else "No role")
        role_available = bool(assigned_role and assigned_role.deleted_at is None)
    designation_name = designation_name if designation_name is not None else db.get(Designation, profile.designation_id).name
    return dict(
        id=profile.id, employeeCode=profile.employee_code, version=profile.version,
        **{field: crypto.decrypt(profile.id, field, getattr(profile, f"{field}_ciphertext"))
           for field in ("name", "email", "phone")},
        dialCountry=profile.dial_country, role=role_name, designation_id=profile.designation_id,
        role_resolution_required=profile.role_resolution_required,
        role_available=bool(role_available),
        legacy_role=profile.role if profile.role_resolution_required else None,
        login_identifiers_ready=profile.login_identifiers_ready if access_visible else None,
        designationName=designation_name, deleted_at=profile.deleted_at, deleted_by=profile.deleted_by,
        dateOfJoining=profile.joining_date, status=profile.status,
        createdBy=str(profile.created_by), updatedBy=str(profile.updated_by),
        createdAt=profile.created_at, updatedAt=profile.updated_at,
        custom_role_id=profile.custom_role_id if access_visible else None,
        workspace_login_enabled=profile.workspace_login_enabled if access_visible else None,
    )


def access_directory_base(status=None, workspace_login_enabled=None):
    # Keep exactly the existing access-directory eligibility exclusions, separate
    # from Staff Management's broader projection and authorization.
    stmt = (select(StaffProfile, CustomRole.name, CustomRole.deleted_at)
            .join(User, User.id == StaffProfile.user_id)
            .outerjoin(CustomRole, CustomRole.id == StaffProfile.custom_role_id)
            .where(StaffProfile.deleted_at.is_(None), User.system_role.is_(None),
                   User.is_protected_system_admin.is_(False), User.email_ciphertext.is_(None)))
    if status is not None:
        stmt = stmt.where(StaffProfile.status == status)
    if workspace_login_enabled is not None:
        stmt = stmt.where(StaffProfile.workspace_login_enabled == workspace_login_enabled)
    return stmt


def access_projection(row, role_name, role_deleted, crypto):
    return dict(id=row.id, name=crypto.decrypt(row.id, "name", row.name_ciphertext),
                employeeCode=row.employee_code, status=row.status,
                role=role_name if role_name and role_deleted is None else "No available role",
                workspace_login_enabled=row.workspace_login_enabled)


def access_directory(db, actor, settings, offset, limit, status=None, workspace_login_enabled=None):
    def work():
        db.execute(text("SET LOCAL statement_timeout = '2000ms'"))
        db.execute(text("SET LOCAL lock_timeout = '1000ms'"))
        _, crypto = authorize(db, actor, settings, access_read=True)
        total = db.scalar(select(func.count()).select_from(access_directory_base().subquery()))
        base = access_directory_base(status, workspace_login_enabled)
        filtered = total if status is None and workspace_login_enabled is None else db.scalar(
            select(func.count()).select_from(base.subquery()))
        rows = db.execute(base.order_by(StaffProfile.created_at.desc(), StaffProfile.id).offset(offset).limit(limit))
        items = [access_projection(row, role_name, deleted, crypto) for row, role_name, deleted in rows]
        db.commit()
        return dict(items=items, total=total, filtered=filtered)
    return transaction(work, db)


def search_access_directory(db, actor, settings, body):
    def work():
        db.execute(text("SET LOCAL statement_timeout = '2000ms'"))
        db.execute(text("SET LOCAL lock_timeout = '1000ms'"))
        _, crypto = authorize(db, actor, settings, access_read=True)
        stmt = access_directory_base(body.status, body.workspace_login_enabled)
        if body.cursor is not None:
            stmt = stmt.where(StaffProfile.id > body.cursor)
        rows = list(db.execute(stmt.order_by(StaffProfile.id).limit(SEARCH_SCAN_LIMIT + 1)))
        term = body.query.casefold()
        items, scanned, last_id = [], 0, None
        for row, role_name, deleted in rows[:SEARCH_SCAN_LIMIT]:
            record = access_projection(row, role_name, deleted, crypto)
            scanned += 1
            last_id = row.id
            if term in record["name"].casefold() or term in (record["employeeCode"] or "").casefold():
                items.append(record)
                if len(items) == body.limit:
                    break
        has_more = len(rows) > scanned
        result = dict(items=items, has_more=has_more, next_cursor=last_id if has_more else None,
                      scanned=scanned, scan_limit=SEARCH_SCAN_LIMIT, limit=body.limit)
        db.commit()
        return result
    return transaction(work, db)


def designation_references(db, actor, settings, query, offset):
    def work():
        authorize(db, actor, settings, ("add", "edit"))
        condition = (Designation.deleted_at.is_(None), Designation.status == "active",
                     Designation.name.icontains(query, autoescape=True))
        rows = db.scalars(select(Designation).where(*condition).order_by(Designation.name, Designation.id).offset(offset).limit(50))
        items = [dict(id=row.id, name=row.name, status=row.status, deleted=False) for row in rows]
        total = db.scalar(select(func.count()).select_from(Designation).where(*condition))
        db.commit()
        return dict(items=items, total=total)
    return transaction(work, db)


def assign(profile, body, crypto):
    for field in ("name", "email", "phone"):
        setattr(profile, f"{field}_ciphertext", crypto.encrypt(profile.id, field, str(getattr(body, field))))
    profile.email_index = crypto.email_index(str(body.email))
    profile.dial_country = body.dialCountry
    profile.designation_id = body.designation_id
    profile.joining_date, profile.status = body.dateOfJoining, body.status
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
    except IntegrityError as error:
        db.rollback()
        constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", "")
        if "email" in (constraint or ""):
            raise StaffError("Email ID is already used by another staff account.", 409, "staff_email_duplicate") from None
        raise StaffError("Employee Code or email is already used or reserved. Review both identifiers.", 409, "staff_duplicate") from None
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


def assign_role(db, profile, role_id):
    role = None
    if role_id is not None:
        role = db.scalar(select(CustomRole).where(CustomRole.id == role_id)
                         .execution_options(populate_existing=True).with_for_update(read=True))
        if role is None or role.deleted_at is not None:
            raise StaffError("Selected role is unavailable. Choose a current role.", 409, "role_deleted")
    profile.custom_role_id = role_id
    profile.role = role.name if role else "No role"
    profile.role_resolution_required = False


def role_choices(db, actor, settings, query, offset, include_retained=False):
    def work():
        db.execute(text("SET LOCAL statement_timeout = '2000ms'"))
        db.execute(text("SET LOCAL lock_timeout = '1000ms'"))
        authorize(db, actor, settings)
        names = select(CustomRole.id.label("id"), CustomRole.name.label("name")).where(CustomRole.deleted_at.is_(None))
        if include_retained:
            # Directory filters include historical snapshots, not permission assignments.
            names = union(names, select(CustomRole.id.label("id"), CustomRole.name.label("name"))
                          .join(StaffProfile, StaffProfile.custom_role_id == CustomRole.id)
                          .where(StaffProfile.deleted_at.is_(None), CustomRole.deleted_at.is_(None)))
        source = names.subquery()
        condition = source.c.name.icontains(query, autoescape=True)
        total = db.scalar(select(func.count()).select_from(source).where(condition))
        rows = db.execute(select(source.c.id, source.c.name).where(condition).order_by(source.c.name, source.c.id).limit(50).offset(offset))
        result = dict(items=[dict(id=row.id, name=row.name) for row in rows], total=total)
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
        lock_policy(db)
        current, crypto = authorize(db, actor, settings, "add")
        access_fields(current, body)
        validate_designation(db, body.designation_id)
        chosen = getattr(body, "initialPassword", None)
        password = chosen if chosen is not None else generated_staff_password()
        encoded_password = hash_password(password)
        from app.services.staff_account_numbers import allocate
        user = User(id=uuid.uuid4(), username=allocate(db), email=None,
                    password_hash=encoded_password, system_role=None,
                    password_setup_required=chosen is None)
        db.add(user)
        db.flush()
        profile = StaffProfile(id=uuid.uuid4(), user_id=user.id, version=1,
                               created_by=current.user.id, updated_by=current.user.id)
        assign_role(db, profile, body.custom_role_id)
        assign(profile, body, crypto)
        db.add(profile)
        from app.services.staff_identifiers import save_identifiers
        with db.no_autoflush:
            save_identifiers(db, profile, str(body.email), body.employeeCode, crypto)
        db.flush()
        audit(db, current, profile, "staff_create")
        result = projection(db, profile, crypto)
        db.commit()
        from app.services.capability_policy import is_super_admin
        return {"record": result, "initial_password": password if is_super_admin(current) else None}
    return transaction(work, db)


def directory_filters(stmt, filters):
    # Exact predicates on existing business metadata only; never workspace roles
    # or designation availability. Historical saved designation IDs remain valid.
    for field in ("status", "designation_id", "role"):
        value = getattr(filters, field, None)
        if value is not None:
            if field == "role":
                stmt = stmt.where(StaffProfile.custom_role_id.in_(
                    select(CustomRole.id).where(CustomRole.name == value, CustomRole.deleted_at.is_(None))))
            else:
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
        stmt = directory_filters(select(StaffProfile, Designation.name, CustomRole.name, CustomRole.deleted_at)
            .join(Designation, Designation.id == StaffProfile.designation_id)
            .outerjoin(CustomRole, CustomRole.id == StaffProfile.custom_role_id)
            .where(StaffProfile.deleted_at.is_(None)), filters)
        rows = list(db.execute(stmt.order_by(
            StaffProfile.created_at.desc(), StaffProfile.id.desc()).limit(limit + 1).offset(offset)))
        result = {"items": [projection(db, row, crypto, name,
                            role_name if role_name and deleted is None else "Unavailable role" if row.custom_role_id else "No role",
                            bool(role_name and deleted is None))
                            for row, name, role_name, deleted in rows[:limit]],
                  "has_more": len(rows) > limit, "limit": limit, "offset": offset}
        db.commit()
        return result
    return transaction(work, db)


SEARCH_SCAN_LIMIT = 500
SEARCH_FIELDS = ("name", "email", "phone", "employeeCode", "dialCountry", "role",
                 "designationName", "dateOfJoining", "status")


def search(db, actor, settings, body):
    def work():
        # Transaction-local only; bound DB execution and same-admin lock waits.
        db.execute(text("SET LOCAL statement_timeout = '2000ms'"))
        db.execute(text("SET LOCAL lock_timeout = '1000ms'"))
        _current, crypto = authorize(db, actor, settings)
        # Primary-key keyset scan: no plaintext personal-data predicates, new
        # blind indexes, counts, offsets, stored sessions or unbounded buffers.
        stmt = (select(StaffProfile, Designation.name, CustomRole.name, CustomRole.deleted_at)
                .join(Designation, Designation.id == StaffProfile.designation_id)
                .outerjoin(CustomRole, CustomRole.id == StaffProfile.custom_role_id)
                .where(StaffProfile.deleted_at.is_(None)))
        stmt = directory_filters(stmt, body)
        if body.cursor is not None:
            stmt = stmt.where(StaffProfile.id > body.cursor)
        rows = list(db.execute(stmt.order_by(StaffProfile.id).limit(SEARCH_SCAN_LIMIT + 1)))
        term = body.query.casefold()
        items, scanned, last_id = [], 0, None
        for profile, name, role_name, deleted in rows[:SEARCH_SCAN_LIMIT]:
            record = projection(db, profile, crypto, name,
                                role_name if role_name and deleted is None else "Unavailable role" if profile.custom_role_id else "No role",
                                bool(role_name and deleted is None))
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
        current, crypto = authorize(db, actor, settings, "status" if status_only else "edit")
        access_fields(current, body)
        snapshot = db.get(StaffProfile, profile_id)
        if not snapshot or snapshot.deleted_at is not None:
            raise StaffError("Staff member not found", 404, "not_found")
        user = session_repository.lock_user(db, snapshot.user_id)
        ordinary_target(user)
        profile = db.scalar(select(StaffProfile).where(StaffProfile.id == profile_id)
                            .execution_options(populate_existing=True).with_for_update())
        if not profile or profile.deleted_at is not None:
            raise StaffError("Staff member not found", 404, "not_found")
        # Verify stored ciphertext even for status-only writes.
        projection(db, profile, crypto)
        if profile.version != body.expected_version:
            raise StaffError("Staff record changed. Your draft has not been saved. Review current details before retrying.",
                             409, "staff_stale")
        if not status_only and body.status != profile.status:
            from app.services.capability_policy import allowed
            if not allowed(current, "staff", "status"):
                raise StaffError("Activate or Deactivate permission is required to change staff status",
                                 403, "access_denied")
        if status_only:
            profile.status = body.status
        else:
            validate_designation(db, body.designation_id, profile.designation_id)
            if "custom_role_id" in body.model_fields_set:
                assign_role(db, profile, body.custom_role_id)
            assign(profile, body, crypto)
            from app.services.staff_identifiers import save_identifiers
            with db.no_autoflush:
                save_identifiers(db, profile, str(body.email), body.employeeCode, crypto)
            user.identity_version += 1
            session_repository.revoke_user_sessions(db, user.id, "identity_invalid", db.info.get("request_id"))
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
        current, crypto = authorize(db, actor, settings, protected=True)
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
        if body.workspace_login_enabled and (profile.status != "active" or not user.is_active):
            raise StaffError("Activate this staff account before enabling workspace login.", 409, "staff_inactive")
        assign_role(db, profile, body.custom_role_id)
        profile.workspace_login_enabled = body.workspace_login_enabled
        profile.version += 1
        profile.updated_by, profile.updated_at = current.user.id, utcnow()
        user.identity_version += 1
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
        current, crypto = authorize(db, actor, settings, "delete")
        snapshot = db.get(StaffProfile, profile_id)
        if not snapshot or snapshot.deleted_at is not None:
            raise StaffError("Staff member not found", 404, "not_found")
        user = session_repository.lock_user(db, snapshot.user_id)
        ordinary_target(user)
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
