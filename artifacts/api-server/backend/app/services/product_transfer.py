"""Catalogue recipes only. No file bytes, stock or incoming activity are stored."""
import csv
import hashlib
import hmac
import io
import posixpath
import re
import uuid
import zipfile
from decimal import Decimal, InvalidOperation

from defusedxml import ElementTree
from pydantic import ValidationError
from sqlalchemy import select

from app.core.config import get_settings
from app.schemas.master_validation import name_text
from app.schemas.products import ProductFields, ProductCreate
from app.services import inventory as inv, products
from app.services.product_category_transfer import encode
from app.services.purchase_received_crypto import PRError
from app.services.zone_transfer import workbook_rows, safe_text, UNSAFE
from app.services.zones import ZoneError

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 1000
MAX_PRODUCTS = 500
HEADERS = ["Product Name", "MRP", "Selling Price", "Status", "Allergen ID", "Allergen Name", "Quantity"]
EXPORT_HEADERS = HEADERS + ["Recipe Format"]
FORMAT = "EVEXIA recipe v1"


def invalid(message):
    raise PRError(message, 422, "product_invalid_file")


def exact_rows(data):
    """Validate the entire workbook first, then recover original numeric XML."""
    try:
        rows = workbook_rows(data, max_columns=8)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            book = ElementTree.fromstring(archive.read("xl/workbook.xml"))
            sheet = next(n for n in book.iter() if n.tag.rsplit("}", 1)[-1] == "sheet")
            rid = next(v for k, v in sheet.attrib.items() if k.rsplit("}", 1)[-1] == "id")
            rels = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            target = next(n.attrib["Target"] for n in rels if n.attrib.get("Id") == rid)
            path = posixpath.normpath(target.lstrip("/") if target.startswith("/") else "xl/" + target)
            if not path.startswith("xl/worksheets/"):
                invalid("Unsupported worksheet location.")
            root = ElementTree.fromstring(archive.read(path))
            for cell in root.iter():
                if cell.tag.rsplit("}", 1)[-1] != "c" or cell.attrib.get("t", "n") != "n":
                    continue
                match = re.fullmatch(r"([BCG])([1-9][0-9]*)", cell.attrib.get("r", ""))
                if not match or int(match[2]) == 1:
                    continue
                index, column = int(match[2]) - 1, {"B": 1, "C": 2, "G": 6}[match[1]]
                value = next((n.text for n in cell if n.tag.rsplit("}", 1)[-1] == "v"), None)
                if value is None:
                    continue
                amount = Decimal(value)
                # Avoid enormous exponents and never round a binary float.
                valid = amount.is_finite() and amount >= 0 and amount.adjusted() <= 11 and amount.as_tuple().exponent >= -6
                rows[index] += [""] * max(0, column + 1 - len(rows[index]))
                rows[index][column] = format(amount, "f") if valid else "invalid numeric decimal"
        return rows
    except ZoneError as exc:
        invalid(exc.message)
    except (InvalidOperation, ValueError, KeyError, IndexError, StopIteration, zipfile.BadZipFile):
        invalid("Malformed workbook decimal or worksheet.")


def parse(data, filename):
    if not data or len(data) > MAX_BYTES:
        raise PRError("Use a non-empty file no larger than 2 MiB.", 413, "product_file_limit")
    if filename.lower().endswith(".csv"):
        try:
            rows = []
            for row in csv.reader(io.StringIO(data.decode("utf-8-sig")), strict=True):
                if len(rows) >= MAX_ROWS + 1 or len(row) > 8 or any(len(c) > 10000 for c in row):
                    invalid("Use at most 1,000 member rows, eight columns and 10,000 characters per cell.")
                rows.append(row)
        except (UnicodeError, csv.Error):
            invalid("Use valid UTF-8 CSV with well-formed quoted cells.")
    elif filename.lower().endswith(".xlsx"):
        rows = exact_rows(data)
    else:
        invalid("Only UTF-8 .csv and genuine single-sheet .xlsx files are supported.")
    if not rows or rows[0] not in (HEADERS, EXPORT_HEADERS) or len(rows) < 2:
        invalid("Keep the exact seven-column sample or eight-column recipe export headers and include member rows.")
    width = len(rows[0])
    reviewed, groups = [], {}
    for number, cells in enumerate(rows[1:], 2):
        values = [(cells[i] if i < len(cells) else "").strip() for i in range(7)]
        errors = [] if len(cells) == width else ["Row must match the header column count."]
        if width == 8:
            if len(cells) != 8 or cells[7] != FORMAT:
                errors.append("Recipe Format must be EVEXIA recipe v1.")
            for i in (0, 5):
                if values[i].startswith("'") and (values[i][1:].startswith("'") or UNSAFE.match(values[i][1:])):
                    values[i] = values[i][1:]
        row = dict(zip(("name", "mrp", "sellingPrice", "status", "allergenId", "allergenName", "quantity"), values))
        row.update(row=number, errors=errors)
        reviewed.append(row)
        groups.setdefault(products.normalized(name_text(row["name"])), []).append(row)
    if len(groups) > MAX_PRODUCTS:
        invalid("Import is limited to 500 products and 1,000 total member rows.")
    return reviewed, groups


def fingerprint(actor, data, filename):
    message = "\0".join(("product-recipes:v1", str(actor.user.id), actor.session_id, filename,
                         hashlib.sha256(data).hexdigest())).encode()
    return hmac.new(get_settings().signing_key.encode(), message, hashlib.sha256).hexdigest()


def transfer(db, actor, data, filename, confirm=False, digest=None, key=None):
    def work(current, crypto):
        token = fingerprint(current, data, filename)
        command = ["recipe-import:v1", filename, hashlib.sha256(data).hexdigest(), digest]
        if confirm:
            found, result, hashes = products.retry_result(db, current, crypto, key, command)
            if found:
                return result
            if not hmac.compare_digest(digest or "", token):
                raise PRError("File or session changed. Review again.", 409, "product_review_changed")
        rows, groups = parse(data, filename)
        saved = inv.bounded(db, select(products.Product).where(products.Product.deleted_at.is_(None)).order_by(products.Product.id))
        names = {products.normalized(products.projection(db, crypto, p, False)["name"]): p.id for p in saved}
        fields = []
        for name, members in groups.items():
            first = members[0]
            problems = []
            if name in names:
                problems.append("A non-deleted product already uses this name (including inactive products). Import is create-only.")
            if any(tuple(m[k] for k in ("mrp", "sellingPrice", "status")) !=
                   tuple(first[k] for k in ("mrp", "sellingPrice", "status")) for m in members):
                problems.append("Repeated MRP, Selling Price and Status must agree for every member of this product.")
            try:
                body = ProductFields(name=first["name"], mrp=first["mrp"], sellingPrice=first["sellingPrice"],
                    status=first["status"], members=[dict(allergenId=m["allergenId"], quantity=m["quantity"]) for m in members])
                fields.append(body)
                products.recipe(db, body.members)
                for row in members:
                    row.update(name=body.name, mrp=body.mrp, sellingPrice=body.sellingPrice)
            except ValidationError as exc:
                problems.extend(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors(include_input=False))
            except PRError as exc:
                problems.append(exc.message)
            for row in members:
                row["errors"].extend(problems)
        valid = not any(r["errors"] for r in rows)
        if not confirm:
            return dict(rows=rows, products=len(groups), memberRows=len(rows), valid=valid, digest=token)
        if not valid:
            raise PRError("Invalid rows or new conflicts. Nothing was imported. Review again.", 409, "product_import_conflict")
        if len(saved) + len(fields) > inv.LIMIT:
            raise PRError("Import would exceed the 2,000-product catalogue scope. Nothing was imported.", 422, "product_scope")
        # Reuse the real encrypted CRUD writer inside this ONE outer transaction.
        for index, body in enumerate(fields):
            products.mutate(db, current, ProductCreate(**body.model_dump(), idempotencyKey=uuid.uuid5(key, f"member:{index}")),
                            transaction_context=(current, crypto), name_catalogue=names)
        result = dict(id=str(key), kind="product_import", imported=len(fields), memberRows=len(rows))
        products.save_retry(db, current, crypto, key, hashes, result)
        return result
    return inv.transaction(db, actor, work)


def sample(format):
    return encode([HEADERS,
        ["Example combo", "150.00", "125.50", "active", "00000000-0000-4000-8000-000000000001", "Replace with saved allergen", "1.000"],
        ["Example combo", "150.00", "125.50", "active", "00000000-0000-4000-8000-000000000002", "Replace with another saved allergen", "0.125"]], format, "ProductRecipes")


def export(db, actor, query, status, format):
    def work(_, crypto):
        saved = inv.bounded(db, select(products.Product).where(products.Product.deleted_at.is_(None))
                           .order_by(products.Product.created_at.desc(), products.Product.id))
        matches = [p for p in (products.projection(db, crypto, r, False) for r in saved)
                   if (status == "all" or p["status"] == status) and products.normalized(query) in products.normalized(p["name"])]
        if len(matches) > MAX_PRODUCTS or sum(len(p["members"]) for p in matches) > MAX_ROWS:
            raise PRError("Export exceeds 500 products or 1,000 member rows. Narrow search/status filters; no partial file is returned.", 422, "product_export_limit")
        rows = [EXPORT_HEADERS]
        for product in matches:
            for member in product["members"]:
                rows.append([safe_text(product["name"]), product["mrp"], product["sellingPrice"], product["status"],
                             member["allergenId"], safe_text(member["name"]), member["quantity"], FORMAT])
        return rows
    return encode(inv.transaction(db, actor, work), format, "ProductRecipes")
