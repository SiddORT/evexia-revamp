"""Inert bounded transfers. No uploaded bytes, legacy IDs or audit values saved."""
import csv
import hashlib
import hmac
import io
import posixpath
import zipfile
from decimal import Decimal, InvalidOperation
from defusedxml import ElementTree
from pydantic import ValidationError
from sqlalchemy import Text, cast, func, select
from sqlalchemy.dialects.postgresql import ARRAY
from app.core.config import get_settings
from app.core.security import utcnow
from app.db.allergen_models import AllergenProduct, normalized_name
from app.db.product_category_models import ProductCategory
from app.db.location_models import StorageLocation
from app.schemas.allergens import AllergenFields
from app.services import allergens
from app.services.product_category_transfer import encode as encode_master
from app.services.zone_transfer import workbook_rows, safe_text, UNSAFE
from app.services.zones import ZoneError

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 1000
EXPORT_LIMIT = 5000
REVIEW_SECONDS = 15 * 60
HEADERS = ["Product Name", "Category", "Selling Price", "GST", "Storage Location",
           "Concentration", "Threshold limit", "Status", "Mix / No Mix",
           "Created By", "Created At", "Updated By", "Updated At"]
LEGACY = HEADERS[:7] + ["HSN code", "Status", "Allergens / No Mix"]
ROW_FIELDS = ("name", "category_name", "selling_price", "gst", "storage_location_name",
              "concentration", "threshold_limit", "status", "mix")


def encode(rows, format):
    return encode_master(rows, format, sheet_title="Allergens")


def invalid(message):
    raise allergens.AllergenError(message, 422, "allergen_invalid_file")


def exact_workbook_rows(data):
    rows = workbook_rows(data, max_columns=13)
    # Retain original numeric XML lexemes for all decimal columns. Excel numeric
    # cells can already be rounded by their producer; text cells are recommended.
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
            columns = {"C": 2, "D": 3, "G": 6}
            for cell in root.iter():
                if cell.tag.rsplit("}", 1)[-1] != "c" or cell.attrib.get("t", "n") != "n":
                    continue
                coordinate = cell.attrib.get("r", "")
                if coordinate[:1] not in columns or not coordinate[1:].isdigit():
                    continue
                index = int(coordinate[1:]) - 1
                value = next((node.text for node in cell if node.tag.rsplit("}", 1)[-1] == "v"), None)
                if value is None or index < 1 or index >= len(rows):
                    continue
                amount = Decimal(value)
                text = "invalid numeric amount" if (
                    not amount.is_finite() or amount < 0 or amount.adjusted() > 11 or amount.as_tuple().exponent < -6
                ) else format(amount, "f")
                column = columns[coordinate[0]]
                if column < len(rows[index]):
                    rows[index][column] = text
        return rows
    except (InvalidOperation, ValueError, KeyError, StopIteration, zipfile.BadZipFile):
        invalid("Malformed workbook amount or worksheet.")


def unsafed(value):
    # Inverse of the shared reversible spreadsheet escaping, never execution.
    return value[1:] if value.startswith("'") and (value[1:].startswith("'") or UNSAFE.match(value[1:])) else value


def parse(data, filename):
    if not data or len(data) > MAX_BYTES:
        raise allergens.AllergenError("Use a non-empty file no larger than 2 MiB.", 413, "allergen_file_limit")
    csv_file = filename.lower().endswith(".csv")
    if csv_file:
        try:
            rows = []
            for row in csv.reader(io.StringIO(data.decode("utf-8-sig")), strict=True):
                if len(rows) >= MAX_ROWS + 1 or len(row) > 13 or any(len(cell) > 10000 for cell in row):
                    invalid("CSV exceeds 1,000 records, thirteen columns or 10,000 characters per cell.")
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
    if not rows or rows[0] not in (HEADERS[:9], HEADERS, LEGACY):
        invalid("Use the nine-column sample, thirteen-column current export, or exact legacy CSV headers.")
    legacy = rows[0] == LEGACY
    if legacy and not csv_file:
        invalid("The obsolete HSN / Allergens layout is supported only for legacy CSV backups.")
    width = len(rows[0])
    reviewed = []
    for number, cells in enumerate(rows[1:], 2):
        errors = [] if len(cells) == width else ["Row must match the header column count."]
        values = [(cells[index].strip() if index < len(cells) else "") for index in range(width)]
        if legacy:
            # HSN is explicitly discarded; never added to the business model.
            del values[7]
        values = values[:9]
        values.extend([""] * (9 - len(values)))
        for index in (0, 1, 4, 5):
            value = values[index]
            # Local CSV exports escaped formula prefixes, but did NOT escape
            # leading apostrophes. Do not silently rewrite literal legacy text.
            values[index] = (value[1:] if value.startswith("'") and UNSAFE.match(value[1:]) else value) if legacy else unsafed(value)
        row = dict(zip(ROW_FIELDS, values))
        row["selling_price"] = row["selling_price"] or None
        row["threshold_limit"] = row["threshold_limit"] or None
        row["status"] = row["status"].lower()
        raw_mix = row["mix"]
        accepted = ("Allergens", "No Mix") if legacy else ("Mix", "No Mix")
        if raw_mix not in accepted:
            errors.append("Mix / No Mix must be Mix or No Mix." if not legacy else "Legacy Allergens / No Mix must be Allergens or No Mix.")
        row["mix"] = "Mix" if raw_mix == ("Allergens" if legacy else "Mix") else "No Mix"
        # Reference resolution is authoritative SQL, never browser-local IDs.
        try:
            body = AllergenFields(**business(row, "00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000"))
            for field in ("name", "selling_price", "gst", "concentration", "threshold_limit", "status"):
                row[field] = getattr(body, field)
        except ValidationError as exc:
            labels = {"name": "Product Name", "selling_price": "Selling Price", "gst": "GST",
                      "concentration": "Concentration", "threshold_limit": "Threshold limit", "status": "Status"}
            for issue in exc.errors():
                field = issue["loc"][0]
                errors.append(f"{labels.get(field, 'Product')}: {issue['msg']}.")
        reviewed.append(dict(row=number, **row, errors=errors))
    if not reviewed:
        invalid("At least one record is required.")
    return reviewed


def business(row, category_id, storage_location_id):
    return dict(name=row["name"], category_id=category_id, storage_location_id=storage_location_id,
                selling_price=row["selling_price"], gst=row["gst"], concentration=row["concentration"],
                threshold_limit=row["threshold_limit"], status=row["status"], mix=row["mix"] == "Mix")


def normalized_keys(db, names):
    return list(db.scalars(select(normalized_name(func.unnest(cast(names, ARRAY(Text)))))))


def resolve(db, rows):
    snapshots = []
    resolved = {}
    # Table and row lock order is stable, held through an all-or-nothing commit.
    for model, name_field, title in ((ProductCategory, "category_name", "Category"),
                                     (StorageLocation, "storage_location_name", "Storage Location")):
        keys = normalized_keys(db, [row[name_field] for row in rows])
        matches = list(db.scalars(select(model).where(
            normalized_name(model.name).in_(set(keys)), model.deleted_at.is_(None), model.status == "active")
            .order_by(model.id).execution_options(populate_existing=True).with_for_update(read=True)))
        names = normalized_keys(db, [record.name for record in matches]) if matches else []
        by_name = {}
        for key, record in zip(names, matches):
            by_name.setdefault(key, []).append(record)
        resolved[name_field] = []
        for row, key in zip(rows, keys):
            choices = by_name.get(key, [])
            record = choices[0] if len(choices) == 1 else None
            resolved[name_field].append(record.id if record else None)
            snapshots.append(f"{name_field}:{row['row']}:{record.id}:{record.version}" if record else f"{name_field}:{row['row']}:unavailable")
            if record is None:
                row["errors"].append(f"{title} must uniquely match an active non-deleted shared record by name.")
    return resolved, snapshots


def review_digest(actor, data, filename, snapshots):
    # An intentionally short, stateless review lease: no file bytes saved.
    # References, actor and refresh session are bound, not merely file bytes.
    bucket = int(utcnow().timestamp()) // REVIEW_SECONDS
    message = "\0".join(("allergen", str(actor.user.id), actor.session_id, str(bucket), filename,
                         hashlib.sha256(data).hexdigest(), *snapshots)).encode()
    return hmac.new(get_settings().signing_key.encode(), message, hashlib.sha256).hexdigest()


def transfer(db, actor, data, filename, confirm=False, digest=None):
    def work():
        current = allergens.authorize(db, actor)
        rows = parse(data, filename)
        resolved, snapshots = resolve(db, rows)
        fingerprint = review_digest(current, data, filename, snapshots)
        if confirm and not hmac.compare_digest(digest or "", fingerprint):
            raise allergens.AllergenError("File, session, reference or review lease changed/expired. Review again before confirming.", 409, "allergen_review_changed")
        keys = normalized_keys(db, [row["name"] for row in rows])
        existing = set(db.scalars(select(normalized_name(AllergenProduct.name)).where(
            AllergenProduct.deleted_at.is_(None), normalized_name(AllergenProduct.name).in_(set(keys)))))
        seen = set()
        for row, key in zip(rows, keys):
            if key in seen:
                row["errors"].append("Duplicate product name within this file.")
            if key in existing:
                row["errors"].append("A non-deleted product already uses this name.")
            seen.add(key)
        valid = not any(row["errors"] for row in rows)
        if confirm:
            if not valid:
                raise allergens.AllergenError("Invalid rows or new conflicts. Nothing was imported. Review again.", 409, "allergen_import_conflict")
            for index, row in enumerate(rows):
                allergens.insert(db, current, AllergenFields(**business(row, resolved["category_name"][index], resolved["storage_location_name"][index])))
            db.commit()
            return {"imported": len(rows)}
        db.commit()
        return dict(rows=rows, valid=valid, digest=fingerprint)
    return allergens.transaction(db, work)


def sample(format):
    # Deliberately not local sample references. Operators replace these labels
    # with names from their active shared directories before review.
    return encode([HEADERS[:9], ["Diagnostic reagent", "Your active category", "125.500000", "12.000000",
                                "Your active location", "10 mg/mL", "", "active", "Mix"]], format)


def export(db, actor, query="", status="all", format="csv", **filters):
    def work():
        allergens.authorize(db, actor)
        records = list(db.scalars(select(AllergenProduct).where(*allergens.predicates(query, status, **filters))
                                  .order_by(AllergenProduct.created_at.desc(), AllergenProduct.id.desc()).limit(EXPORT_LIMIT + 1)))
        if len(records) > EXPORT_LIMIT:
            raise allergens.AllergenError("Export exceeds 5,000 matching records. Narrow your search and filters.", 422, "allergen_export_limit")
        rows = [HEADERS]
        for row in records:
            record = allergens.projection(db, row)
            rows.append([safe_text(row.name), safe_text(record["category_name"]), record["selling_price"] or "",
                         record["gst"], safe_text(record["storage_location_name"]), safe_text(row.concentration),
                         record["threshold_limit"] or "", row.status, "Mix" if row.mix else "No Mix",
                         safe_text(record["createdBy"]), row.created_at.isoformat(),
                         safe_text(record["updatedBy"]), row.updated_at.isoformat()])
        db.commit()
        return rows
    return encode(allergens.transaction(db, work), format)
