"""Protected singleton catalogue, optimistic writes and transaction-held references."""
from decimal import Decimal
from sqlalchemy import func, select, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.allergen_models import AllergenProduct, normalized_name
from app.db.product_category_models import ProductCategory
from app.db.location_models import StorageLocation
from app.schemas.allergens import BUSINESS_FIELDS
from app.schemas.product_categories import exact_price
from app.services.zones import label
from app.services.auth import revalidate_identity

REFERENCE_MODELS = {"categories": ProductCategory, "locations": StorageLocation}


class AllergenError(Exception):
    def __init__(self, message="Allergen persistence is unavailable. Your draft is preserved; retry later.",
                 status=503, code="allergen_unavailable"):
        self.message, self.status, self.code = message, status, code


def transaction(db, work):
    try:
        return work()
    except IntegrityError as exc:
        db.rollback()
        if getattr(getattr(exc.orig, "diag", None), "constraint_name", None) == "uq_allergen_live_name":
            raise AllergenError("A non-deleted product already uses this name. Review current records.", 409, "allergen_duplicate") from None
        raise AllergenError() from None
    except SQLAlchemyError:
        db.rollback()
        raise AllergenError() from None
    except Exception:
        db.rollback()
        raise


def authorize(db, actor):
    current = revalidate_identity(db, actor, lock=True)
    if not current.user.is_protected_system_admin or current.role != "super_admin" or "admin.access" not in current.permissions:
        raise AllergenError("Access denied", 403, "access_denied")
    return current


def reference_status(row):
    return "deleted" if row.deleted_at is not None else row.status


def projection(db, row):
    category = db.get(ProductCategory, row.category_id)
    location = db.get(StorageLocation, row.storage_location_id)
    values = {field: getattr(row, field) for field in BUSINESS_FIELDS}
    for field in ("selling_price", "gst", "threshold_limit"):
        values[field] = format(values[field], ".6f") if values[field] is not None else None
    return dict(id=row.id, **values, version=row.version,
                category_name=category.name, storage_location_name=location.name,
                category_status=reference_status(category), storage_location_status=reference_status(location),
                createdBy=label(db, row.created_by), updatedBy=label(db, row.updated_by),
                createdAt=row.created_at, updatedAt=row.updated_at)


def literal_term(query):
    return " ".join(query.split()).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def predicates(query="", status="all", min_price=None, max_price=None, category_id=None, storage_location_id=None, mix="all"):
    try:
        low = Decimal(exact_price(min_price)) if min_price not in (None, "") else None
        high = Decimal(exact_price(max_price)) if max_price not in (None, "") else None
    except ValueError:
        raise AllergenError("Price bounds must be non-negative decimals with at most 12 integer and 6 fractional digits.", 422, "allergen_invalid_bounds") from None
    if low is not None and high is not None and low > high:
        raise AllergenError("Minimum price must not exceed maximum price.", 422, "allergen_invalid_bounds")
    result = [AllergenProduct.deleted_at.is_(None)]
    term = literal_term(query)
    if term:
        pattern = "%" + term + "%"
        result.append(or_(AllergenProduct.name.ilike(pattern, escape="\\"),
                          AllergenProduct.concentration.ilike(pattern, escape="\\"),
                          AllergenProduct.category_id.in_(select(ProductCategory.id).where(ProductCategory.name.ilike(pattern, escape="\\"))),
                          AllergenProduct.storage_location_id.in_(select(StorageLocation.id).where(StorageLocation.name.ilike(pattern, escape="\\")))))
    if status != "all":
        result.append(AllergenProduct.status == status)
    if category_id:
        result.append(AllergenProduct.category_id == category_id)
    if storage_location_id:
        result.append(AllergenProduct.storage_location_id == storage_location_id)
    if mix != "all":
        result.append(AllergenProduct.mix.is_(mix == "mix"))
    if low is not None:
        result.append(AllergenProduct.selling_price >= low)
    if high is not None:
        result.append(AllergenProduct.selling_price <= high)
    return result


def listing(db, actor, query="", status="all", limit=10, offset=0, **filters):
    def work():
        authorize(db, actor)
        total = db.scalar(select(func.count()).select_from(AllergenProduct).where(AllergenProduct.deleted_at.is_(None)))
        conditions = predicates(query, status, **filters)
        filtered = db.scalar(select(func.count()).select_from(AllergenProduct).where(*conditions))
        rows = db.scalars(select(AllergenProduct).where(*conditions).order_by(
            AllergenProduct.created_at.desc(), AllergenProduct.id.desc()).limit(limit).offset(offset))
        result = dict(items=[projection(db, row) for row in rows], total=total, filtered=filtered, limit=limit, offset=offset)
        db.commit()
        return result
    return transaction(db, work)


def references(db, actor, kind, query="", limit=20, offset=0, include_unusable=False):
    def work():
        authorize(db, actor)
        model = REFERENCE_MODELS[kind]
        conditions = [] if include_unusable else [model.deleted_at.is_(None), model.status == "active"]
        term = literal_term(query)
        if term:
            conditions.append(model.name.ilike("%" + term + "%", escape="\\"))
        count = db.scalar(select(func.count()).select_from(model).where(*conditions))
        rows = db.scalars(select(model).where(*conditions).order_by(normalized_name(model.name), model.id).limit(limit).offset(offset))
        result = dict(items=[dict(id=row.id, name=row.name, status=reference_status(row)) for row in rows],
                      total=count, limit=limit, offset=offset)
        db.commit()
        return result
    return transaction(db, work)


def validate_references(db, body, existing=None):
    # SHARE locks serialize against reference edit/status/delete, held until the
    # catalogue commit. Never trust preflight choices or a prior import review.
    for model, field, title in ((ProductCategory, "category_id", "Category"),
                                (StorageLocation, "storage_location_id", "Storage Location")):
        record_id = getattr(body, field)
        row = db.scalar(select(model).where(model.id == record_id).execution_options(populate_existing=True).with_for_update(read=True))
        retained = existing is not None and getattr(existing, field) == record_id
        if row is None or (not retained and reference_status(row) != "active"):
            raise AllergenError(f"{title} must be an active, non-deleted shared record. An unchanged saved reference may be retained.",
                               409, "allergen_reference_changed")


def audit(db, actor, row, operation):
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id, action="allergen_" + operation,
                      resource_type="allergen", resource_id=row.id, outcome="success", request_id=db.info.get("request_id")))


def assignments(body):
    values = {field: getattr(body, field) for field in BUSINESS_FIELDS}
    for field in ("selling_price", "gst", "threshold_limit"):
        values[field] = Decimal(values[field]) if values[field] is not None else None
    return values


def insert(db, actor, body):
    validate_references(db, body)
    now = utcnow()
    row = AllergenProduct(**assignments(body), created_by=actor.user.id, updated_by=actor.user.id,
                          created_at=now, updated_at=now)
    db.add(row)
    db.flush()
    audit(db, actor, row, "create")
    return row


def create(db, actor, body):
    def work():
        current = authorize(db, actor)
        result = projection(db, insert(db, current, body))
        db.commit()
        return result
    return transaction(db, work)


def find(db, record_id):
    row = db.scalar(select(AllergenProduct).where(AllergenProduct.id == record_id, AllergenProduct.deleted_at.is_(None))
                    .execution_options(populate_existing=True).with_for_update())
    if row is None:
        raise AllergenError("Product not found. It may have been deleted.", 404, "not_found")
    return row


def detail(db, actor, record_id):
    def work():
        authorize(db, actor)
        result = projection(db, find(db, record_id))
        db.commit()
        return result
    return transaction(db, work)


def mutate(db, actor, record_id, body, operation):
    def work():
        current = authorize(db, actor)
        row = find(db, record_id)
        if row.version != body.expected_version:
            raise AllergenError("Product changed. Your draft is not saved. Review current details before retrying.", 409, "allergen_stale")
        now = utcnow()
        if operation == "delete":
            row.deleted_at, row.deleted_by = now, current.user.id
        else:
            row.status = body.status
            if operation == "edit":
                validate_references(db, body, row)
                for field, value in assignments(body).items():
                    setattr(row, field, value)
        row.version += 1
        row.updated_at, row.updated_by = now, current.user.id
        audit(db, current, row, operation)
        db.flush()
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)
