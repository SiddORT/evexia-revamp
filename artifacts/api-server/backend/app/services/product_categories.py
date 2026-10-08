from decimal import Decimal
from sqlalchemy import func, select, or_, cast, String
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.product_category_models import ProductCategory, normalized_name
from app.schemas.product_categories import exact_price
from app.services.zones import label
from app.services.master_policy import authorize_master


class ProductCategoryError(Exception):
    def __init__(self, message="Product category persistence is unavailable. Your draft is preserved; retry later.",
                 status=503, code="product_category_unavailable"):
        self.message, self.status, self.code = message, status, code


def transaction(db, work):
    try:
        return work()
    except IntegrityError as exc:
        db.rollback()
        if getattr(getattr(exc.orig, "diag", None), "constraint_name", None) == "uq_product_category_live_name":
            raise ProductCategoryError("A non-deleted product category already uses this name. Review current records.",
                                   409, "product_category_duplicate") from None
        raise ProductCategoryError() from None
    except SQLAlchemyError:
        db.rollback()
        raise ProductCategoryError() from None
    except Exception:
        db.rollback()
        raise


def authorize(db, actor, action=None):
    return authorize_master(db, actor, "product_category", action, error=ProductCategoryError)


def projection(db, row):
    return dict(id=row.id, name=row.name, description=row.description, unit_price=format(row.unit_price, ".6f"), status=row.status, version=row.version,
                createdBy=label(db, row.created_by), updatedBy=label(db, row.updated_by),
                createdAt=row.created_at, updatedAt=row.updated_at)


def predicates(query="", status="all", min_price=None, max_price=None):
    try:
        low = Decimal(exact_price(min_price)) if min_price not in (None, "") else None
        high = Decimal(exact_price(max_price)) if max_price not in (None, "") else None
    except ValueError:
        raise ProductCategoryError("Price bounds must be non-negative decimals with at most 12 integer and 6 fractional digits.", 422, "product_category_invalid_bounds") from None
    if low is not None and high is not None and low > high:
        raise ProductCategoryError("Minimum price must not exceed maximum price.", 422, "product_category_invalid_bounds")
    result = [ProductCategory.deleted_at.is_(None)]
    term = " ".join(query.split())
    if term:
        term = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        result.append(or_(ProductCategory.name.ilike("%" + term + "%", escape="\\"),
                          ProductCategory.description.ilike("%" + term + "%", escape="\\"),
                          cast(ProductCategory.unit_price, String).ilike("%" + term + "%", escape="\\")))
    if status != "all":
        result.append(ProductCategory.status == status)
    if low is not None:
        result.append(ProductCategory.unit_price >= low)
    if high is not None:
        result.append(ProductCategory.unit_price <= high)
    return result


def listing(db, actor, query, status, limit, offset, min_price=None, max_price=None):
    def work():
        authorize(db, actor)
        total = db.scalar(select(func.count()).select_from(ProductCategory).where(ProductCategory.deleted_at.is_(None)))
        filters = predicates(query, status, min_price, max_price)
        filtered = db.scalar(select(func.count()).select_from(ProductCategory).where(*filters))
        rows = db.scalars(select(ProductCategory).where(*filters).order_by(
            ProductCategory.created_at.desc(), ProductCategory.id.desc()).limit(limit).offset(offset))
        result = dict(items=[projection(db, row) for row in rows], total=total, filtered=filtered,
                      limit=limit, offset=offset)
        db.commit()
        return result
    return transaction(db, work)


def audit(db, actor, row, operation):
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id, action="product_category_" + operation,
                      resource_type="product_category", resource_id=row.id, outcome="success",
                      request_id=db.info.get("request_id")))


def insert(db, actor, body):
    now = utcnow()
    row = ProductCategory(name=body.name, description=body.description, unit_price=Decimal(body.unit_price), status=body.status,
                      created_by=actor.user.id, updated_by=actor.user.id, created_at=now, updated_at=now)
    db.add(row)
    db.flush()
    audit(db, actor, row, "create")
    return row


def create(db, actor, body):
    def work():
        current = authorize(db, actor, "add")
        result = projection(db, insert(db, current, body))
        db.commit()
        return result
    return transaction(db, work)


def find(db, record_id):
    row = db.scalar(select(ProductCategory).where(ProductCategory.id == record_id, ProductCategory.deleted_at.is_(None))
                    .execution_options(populate_existing=True).with_for_update())
    if not row:
        raise ProductCategoryError("Product category not found. It may have been deleted.", 404, "not_found")
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
        current = authorize(db, actor, "delete" if operation == "delete" else "edit")
        row = find(db, record_id)
        if row.version != body.expected_version:
            raise ProductCategoryError("Product category changed. Your draft is not saved. Review current details before retrying.",
                                   409, "product_category_stale")
        now = utcnow()
        if operation == "delete":
            row.deleted_at, row.deleted_by = now, current.user.id
        else:
            row.status = body.status
            if operation == "edit":
                row.name = body.name
                row.description = body.description
                row.unit_price = Decimal(body.unit_price)
        row.version += 1
        row.updated_at, row.updated_by = now, current.user.id
        audit(db, current, row, operation)
        db.flush()
        result = projection(db, row)
        db.commit()
        return result
    return transaction(db, work)
