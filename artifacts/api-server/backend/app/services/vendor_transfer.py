"""Inert bounded CSV/XLSX review, explicit atomic create-only commit."""
import csv
import hashlib
import hmac
import io

from openpyxl import Workbook
from pydantic import ValidationError
from sqlalchemy import Text, cast, func, select
from sqlalchemy.dialects.postgresql import ARRAY
from app.core.config import get_settings
from app.db.vendor_models import Vendor, normalized_name
from app.schemas.vendors import BUSINESS_FIELDS, VendorFields
from app.services import vendors
from app.services.zone_transfer import workbook_rows, safe_text, UNSAFE
from app.services.zones import ZoneError

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 1000
EXPORT_LIMIT = 5000
HEADERS = ["Vendor Name", "GST No.", "Registered Address", "Contact Person Name",
           "Email ID", "Phone No.", "Dial Country", "Status",
           "Created By", "Created At", "Updated By", "Updated At"]
LABELS = dict(zip(BUSINESS_FIELDS, HEADERS[:8]))


def invalid(message):
    raise vendors.VendorError(message, 422, "vendor_invalid_file")


def parse(data, filename):
    if not data or len(data) > MAX_BYTES:
        raise vendors.VendorError("Use a non-empty file no larger than 2 MiB.", 413, "vendor_file_limit")
    if filename.lower().endswith(".csv"):
        try:
            rows = []
            for row in csv.reader(io.StringIO(data.decode("utf-8-sig")), strict=True):
                if len(rows) >= MAX_ROWS + 1 or len(row) > 12 or any(len(cell) > 10000 for cell in row):
                    invalid("CSV exceeds 1,000 records, 12 columns or 10,000 characters per cell.")
                rows.append(row)
        except (UnicodeError, csv.Error):
            invalid("Use valid UTF-8 CSV with well-formed quoted cells.")
    elif filename.lower().endswith(".xlsx"):
        try:
            rows = workbook_rows(data, max_columns=12)
        except ZoneError as exc:
            invalid(exc.message)
    else:
        invalid("Only UTF-8 .csv and genuine .xlsx are supported. No .xls or macro-enabled files.")
    if not rows or rows[0] not in (HEADERS[:6], HEADERS[:8], HEADERS):
        invalid("Use the exact six legacy contact columns, eight business columns or twelve-column current export.")
    width = len(rows[0])
    reviewed = []
    for number, cells in enumerate(rows[1:], 2):
        errors = [] if len(cells) == width else ["Row must match the header column count."]
        values = dict(zip(BUSINESS_FIELDS, (cells + [""] * 8)[:8]))
        # Every server export is escaped; legacy browser exports used the same
        # formula-prefix escape. Never execute spreadsheet expressions.
        for field in BUSINESS_FIELDS[:6]:
            value = values[field].strip()
            if value.startswith("'") and (value[1:].startswith("'") or UNSAFE.match(value[1:])):
                value = value[1:]
            values[field] = value
        if width == 6:
            values.update(dialCountry="IN", status="active")
        else:
            values["dialCountry"] = values["dialCountry"].strip().upper()
            values["status"] = values["status"].strip().lower()
        try:
            values = VendorFields(**values).model_dump(mode="json")
        except ValidationError as exc:
            for error in exc.errors(include_input=False):
                field = error["loc"][0] if error["loc"] else None
                if field in LABELS:
                    errors.append(f"{LABELS[field]}: required and must meet the documented format/length.")
                else:
                    errors.append("Required vendor fields must meet the documented formats and limits.")
        reviewed.append(dict(row=number, values=values, errors=errors))
    if not reviewed:
        invalid("At least one record is required.")
    return reviewed


def review_digest(actor, data, filename):
    message = "\0".join(("vendor", str(actor.user.id), actor.session_id, filename,
                          hashlib.sha256(data).hexdigest())).encode()
    return hmac.new(get_settings().signing_key.encode(), message, hashlib.sha256).hexdigest()


def transfer(db, actor, data, filename, confirm=False, digest=None):
    rows = parse(data, filename)
    def work():
        current = vendors.authorize(db, actor)
        fingerprint = review_digest(current, data, filename)
        if confirm and not hmac.compare_digest(digest or "", fingerprint):
            raise vendors.VendorError("File or session changed. Review again before confirming.", 409, "vendor_review_changed")
        names = [row["values"]["vendorName"] for row in rows]
        normalized = list(db.scalars(select(normalized_name(func.unnest(cast(names, ARRAY(Text)))))))
        existing_names = set(db.scalars(select(normalized_name(Vendor.vendorName)).where(
            Vendor.deleted_at.is_(None), normalized_name(Vendor.vendorName).in_(normalized))))
        gst_numbers = [row["values"]["gstNo"].upper() for row in rows]
        existing_gst = set(db.scalars(select(Vendor.gstNo).where(
            Vendor.deleted_at.is_(None), Vendor.gstNo.in_(gst_numbers))))
        seen_names, seen_gst = set(), set()
        for row, key, gst in zip(rows, normalized, gst_numbers):
            if key in seen_names:
                row["errors"].append("Duplicate Vendor Name within this file.")
            if key in existing_names:
                row["errors"].append("A non-deleted vendor already uses this Vendor Name.")
            if gst in seen_gst:
                row["errors"].append("Duplicate GST No. within this file.")
            if gst in existing_gst:
                row["errors"].append("A non-deleted vendor already uses this GST No.")
            seen_names.add(key)
            seen_gst.add(gst)
        invalid_count = sum(bool(row["errors"]) for row in rows)
        if confirm:
            if invalid_count:
                raise vendors.VendorError("Invalid rows or new conflicts. Nothing was imported. Review again.",
                                          409, "vendor_import_conflict")
            for row in rows:
                vendors.insert(db, current, VendorFields(**row["values"]))
            db.commit()
            return {"imported": len(rows)}
        db.commit()
        return dict(rows=rows, valid=not invalid_count, digest=fingerprint,
                    validCount=len(rows) - invalid_count, invalidCount=invalid_count)
    return vendors.transaction(db, work)


def encode(rows, format):
    if format == "csv":
        output = io.StringIO()
        csv.writer(output).writerows(rows)
        return output.getvalue().encode("utf-8-sig")
    output = io.BytesIO()
    book = Workbook()
    try:
        book.active.title = "Vendors"
        for row in rows:
            book.active.append(row)
            for cell in book.active[book.active.max_row]:
                cell.data_type = "s"
        book.save(output)
        return output.getvalue()
    finally:
        book.close()


def sample(format):
    return encode([HEADERS[:8], ["Example vendor", "27AAAAA0000A1Z5", "Example registered address",
                                "Example contact", "contact@example.test", "9876543210", "IN", "active"]], format)


def export(db, actor, query, status, format):
    def work():
        vendors.authorize(db, actor)
        records = list(db.scalars(select(Vendor).where(*vendors.predicates(query, status))
                                  .order_by(Vendor.created_at.desc(), Vendor.id.desc()).limit(EXPORT_LIMIT + 1)))
        if len(records) > EXPORT_LIMIT:
            raise vendors.VendorError("Export exceeds 5,000 matching vendors. Narrow search/status filters.",
                                      422, "vendor_export_limit")
        rows = [HEADERS]
        for row in records:
            record = vendors.projection(db, row)
            values = [safe_text(getattr(row, field)) for field in BUSINESS_FIELDS]
            rows.append(values + [safe_text(record["createdBy"]), row.created_at.isoformat(),
                                  safe_text(record["updatedBy"]), row.updated_at.isoformat()])
        db.commit()
        return rows
    return encode(vendors.transaction(db, work), format)
