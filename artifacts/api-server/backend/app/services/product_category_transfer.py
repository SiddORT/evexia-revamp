"""Bounded, inert, create-only transfer; reviewed bytes are never persisted."""
import csv
import hashlib
import hmac
import io
import posixpath
import zipfile
from decimal import Decimal, InvalidOperation
from defusedxml import ElementTree
from openpyxl import Workbook
from pydantic import ValidationError
from sqlalchemy import Text, cast, func, select
from sqlalchemy.dialects.postgresql import ARRAY
from app.core.config import get_settings
from app.db.product_category_models import ProductCategory, normalized_name
from app.schemas.product_categories import ProductCategoryFields
from app.services import product_categories
from app.services.zone_transfer import workbook_rows, safe_text, UNSAFE
from app.services.zones import ZoneError

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 1000
EXPORT_LIMIT = 5000
HEADERS = ["Product Category Name", "Description", "Unit Price", "Status", "Created By", "Created At", "Updated By", "Updated At"]


def invalid(message):
    raise product_categories.ProductCategoryError(message, 422, "product_category_invalid_file")


def exact_workbook_rows(data):
    # First enforce the shared archive/XML/cell/formula/link safety boundary.
    rows = workbook_rows(data, max_columns=8)
    # openpyxl converts numeric cells to binary floats. Recover ONLY prices from
    # their original validated XML decimal lexemes, never from those floats.
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            book = ElementTree.fromstring(archive.read("xl/workbook.xml"))
            sheet = next(node for node in book.iter() if node.tag.rsplit("}", 1)[-1] == "sheet")
            relation_id = next(value for key, value in sheet.attrib.items() if key.rsplit("}", 1)[-1] == "id")
            rels = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            target = next(node.attrib["Target"] for node in rels if node.attrib.get("Id") == relation_id)
            path = posixpath.normpath(target.lstrip("/") if target.startswith("/") else "xl/" + target)
            if not path.startswith("xl/worksheets/"):
                invalid("Unsupported worksheet location.")
            root = ElementTree.fromstring(archive.read(path))
            for cell in root.iter():
                if cell.tag.rsplit("}", 1)[-1] != "c" or cell.attrib.get("t", "n") != "n":
                    continue
                coordinate = cell.attrib.get("r", "")
                if not coordinate.startswith("C") or coordinate == "C1":
                    continue
                index = int(coordinate[1:]) - 1
                value = next((node.text for node in cell if node.tag.rsplit("}", 1)[-1] == "v"), None)
                if value is None or index >= len(rows):
                    continue
                amount = Decimal(value)
                if not amount.is_finite() or amount < 0 or amount.adjusted() > 11 or amount.as_tuple().exponent < -6:
                    # Preserve an invalid sentinel for useful row-level review.
                    text = "invalid numeric price"
                else:
                    text = format(amount, "f")
                rows[index][2] = text
        return rows
    except (InvalidOperation, ValueError, KeyError, StopIteration, zipfile.BadZipFile):
        invalid("Malformed workbook price or worksheet.")


def parse(data, filename):
    if not data or len(data) > MAX_BYTES:
        raise product_categories.ProductCategoryError("Use a non-empty file no larger than 2 MiB.", 413, "product_category_file_limit")
    if filename.lower().endswith(".csv"):
        try:
            rows = []
            for row in csv.reader(io.StringIO(data.decode("utf-8-sig")), strict=True):
                if len(rows) >= MAX_ROWS + 1 or len(row) > 8 or any(len(cell) > 10000 for cell in row):
                    invalid("CSV exceeds 1,000 records, eight columns or 10,000 characters per cell.")
                rows.append(row)
        except (UnicodeError, csv.Error):
            invalid("Use valid UTF-8 CSV with well-formed quoted cells.")
    elif filename.lower().endswith(".xlsx"):
        try:
            rows = exact_workbook_rows(data)
        except ZoneError as exc:
            invalid(exc.message)
    else:
        invalid("Only UTF-8 .csv and genuine .xlsx are supported.")
    if not rows or rows[0] not in (HEADERS[:4], HEADERS):
        invalid("Use exact Product Category Name,Description,Unit Price,Status headers or the eight-column audit export schema.")
    width = len(rows[0])
    reviewed = []
    for number, cells in enumerate(rows[1:], 2):
        errors = [] if len(cells) == width else ["Row must match the header column count."]
        values = [cells[index].strip() if len(cells) > index else "" for index in range(4)]
        if width == 8:
            for index in (0, 1):
                value = values[index]
                if value.startswith("'") and (value[1:].startswith("'") or UNSAFE.match(value[1:])):
                    values[index] = value[1:]
        name, description, price, status = values
        status = status.lower()
        try:
            fields = ProductCategoryFields(name=name, description=description, unit_price=price, status=status)
            name, description, price = fields.name, fields.description, fields.unit_price
        except ValidationError:
            errors.append("Name must be 1–200 characters, description at most 2,000, status Active/Inactive and price a non-negative plain decimal with at most 12 integer and 6 fractional digits.")
        reviewed.append(dict(row=number, name=name, description=description, unit_price=price, status=status, errors=errors))
    if not reviewed:
        invalid("At least one record is required.")
    return reviewed


def review_digest(actor, data, filename):
    message = "\0".join(("product_category", str(actor.user.id), actor.session_id, filename,
                         hashlib.sha256(data).hexdigest())).encode()
    return hmac.new(get_settings().signing_key.encode(), message, hashlib.sha256).hexdigest()


def transfer(db, actor, data, filename, confirm=False, digest=None):
    def work():
        current = product_categories.authorize(db, actor, "import")
        rows = parse(data, filename)
        fingerprint = review_digest(current, data, filename)
        if confirm and not hmac.compare_digest(digest or "", fingerprint):
            raise product_categories.ProductCategoryError("File or session changed. Review again before confirming.", 409, "product_category_review_changed")
        names = []
        for row in rows:
            try:
                names.append(ProductCategoryFields(name=row["name"], description=row["description"], unit_price=row["unit_price"], status=row["status"]).name)
            except ValidationError:
                names.append("")
        keys = list(db.scalars(select(normalized_name(func.unnest(cast(names, ARRAY(Text)))))))
        existing = set(db.scalars(select(normalized_name(ProductCategory.name)).where(
            ProductCategory.deleted_at.is_(None), normalized_name(ProductCategory.name).in_(keys))))
        seen = set()
        for row, key in zip(rows, keys):
            if key in seen:
                row["errors"].append("Duplicate name within this file.")
            if key in existing:
                row["errors"].append("A non-deleted product category already uses this name.")
            seen.add(key)
        valid = not any(row["errors"] for row in rows)
        if confirm:
            if not valid:
                raise product_categories.ProductCategoryError("Invalid rows or new conflicts. Nothing was imported. Review again.", 409, "product_category_import_conflict")
            for row in rows:
                product_categories.insert(db, current, ProductCategoryFields(name=row["name"], description=row["description"], unit_price=row["unit_price"], status=row["status"]))
            db.commit()
            return {"imported": len(rows)}
        db.commit()
        return dict(rows=rows, valid=valid, digest=fingerprint)
    return product_categories.transaction(db, work)


def encode(rows, format, sheet_title="ProductCategorys"):
    if format == "csv":
        output = io.StringIO()
        csv.writer(output).writerows(rows)
        return output.getvalue().encode("utf-8-sig")
    output = io.BytesIO()
    book = Workbook()
    try:
        book.active.title = sheet_title
        for row in rows:
            book.active.append(row)
            for cell in book.active[book.active.max_row]:
                cell.data_type = "s"
        book.save(output)
        return output.getvalue()
    finally:
        book.close()


def sample(format):
    return encode([HEADERS[:4], ["Diagnostic reagents", "", "125.500000", "active"]], format)


def format_price(value):
    return format(value, ".6f")


def export(db, actor, query, status, format, min_price=None, max_price=None):
    def work():
        product_categories.authorize(db, actor, "export")
        records = list(db.scalars(select(ProductCategory).where(*product_categories.predicates(query, status, min_price, max_price))
                                  .order_by(ProductCategory.created_at.desc(), ProductCategory.id.desc()).limit(EXPORT_LIMIT + 1)))
        if len(records) > EXPORT_LIMIT:
            raise product_categories.ProductCategoryError("Export exceeds 5,000 matching records. Narrow name/description/price/status filters.", 422, "product_category_export_limit")
        rows = [HEADERS]
        for row in records:
            record = product_categories.projection(db, row)
            rows.append([safe_text(row.name), safe_text(row.description), format_price(row.unit_price), row.status,
                         safe_text(record["createdBy"]), row.created_at.isoformat(),
                         safe_text(record["updatedBy"]), row.updated_at.isoformat()])
        db.commit()
        return rows
    return encode(product_categories.transaction(db, work), format)
