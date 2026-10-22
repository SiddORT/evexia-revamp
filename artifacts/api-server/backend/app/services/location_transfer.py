"""Inert, create-only location transfer; no bytes or review records are persisted."""
import csv
from app.services.export_presentation import present_export, normalized_import_dates
import hashlib
import hmac
import io

from openpyxl import Workbook
from pydantic import ValidationError
from sqlalchemy import Text, cast, select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy import func

from app.core.config import get_settings
from app.db.location_models import StorageLocation, normalized_name
from app.schemas.locations import LocationFields
from app.services import locations
from app.services.zone_transfer import workbook_rows, safe_text, UNSAFE
from app.services.zones import ZoneError

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 1000
EXPORT_LIMIT = 5000
LEGACY_HEADERS = ["Storage Location", "Address", "Status", "Created By", "Created At", "Updated By", "Updated At"]
GEO_FIELDS = ("pincode", "countryCode", "state", "city")
HEADERS = LEGACY_HEADERS[:3] + ["PIN Code", "Country Code", "State/UT", "City"] + LEGACY_HEADERS[3:]


def invalid(message):
    raise locations.LocationError(message, 422, "location_invalid_file")


def parse(data, filename):
    if not data or len(data) > MAX_BYTES:
        raise locations.LocationError("Use a non-empty file no larger than 2 MiB.", 413, "location_file_limit")
    if filename.lower().endswith(".csv"):
        try:
            rows = []
            for row in csv.reader(io.StringIO(data.decode("utf-8-sig")), strict=True):
                if len(rows) >= MAX_ROWS + 1 or len(row) > 11 or any(len(cell) > 10000 for cell in row):
                    invalid("CSV exceeds 1,000 records, eleven columns or 10,000 characters per cell.")
                rows.append(row)
        except (UnicodeError, csv.Error):
            invalid("Use valid UTF-8 CSV with well-formed quoted cells.")
    elif filename.lower().endswith(".xlsx"):
        try:
            rows = workbook_rows(data, max_columns=11)
        except ZoneError as exc:
            invalid(exc.message)
    else:
        invalid("Only UTF-8 .csv and genuine .xlsx are supported. No .xls or macro-enabled files.")
    rows = normalized_import_dates(rows, invalid)
    if not rows or rows[0] not in (LEGACY_HEADERS[:3], LEGACY_HEADERS, HEADERS[:7], HEADERS):
        invalid("Use the exact legacy three/seven-column or structured seven/eleven-column headers.")
    width = len(rows[0])
    structured = rows[0] in (HEADERS[:7], HEADERS)
    escaped = rows[0] in (LEGACY_HEADERS, HEADERS[:7], HEADERS)
    def decode(value):
        value = value.strip()
        return value[1:] if escaped and value.startswith("'") and (value[1:].startswith("'") or UNSAFE.match(value[1:])) else value
    reviewed = []
    for number, cells in enumerate(rows[1:], 2):
        errors = [] if len(cells) == width else ["Row must match the header column count."]
        name = decode(cells[0]) if cells else ""
        address = decode(cells[1]) if len(cells) > 1 else ""
        status = cells[2].strip().lower() if len(cells) > 2 else ""
        geo = {key: decode(cells[index]) if structured and len(cells) > index else ""
               for index, key in enumerate(GEO_FIELDS, 3)}
        try:
            fields = LocationFields(name=name, address=address, status=status, **geo)
            name, address = fields.name, fields.address
            geo = {key: getattr(fields, key) for key in GEO_FIELDS}
        except ValidationError as exc:
            errors.extend(f"{'.'.join(map(str, item['loc'])) or 'Address'}: {item['msg']}" for item in exc.errors())
        reviewed.append(dict(row=number, name=name, address=address, status=status, **geo, errors=errors))
    if not reviewed:
        invalid("At least one record is required.")
    return reviewed


def review_digest(actor, data, filename):
    # The confirmation is bound to the verified importer, session, exact bytes,
    # resource and format. A client-computed file hash is not proof of review.
    message = "\0".join(("location", str(actor.user.id), actor.session_id, filename,
                          hashlib.sha256(data).hexdigest())).encode()
    return hmac.new(get_settings().signing_key.encode(), message, hashlib.sha256).hexdigest()


def transfer(db, actor, data, filename, confirm=False, digest=None):
    rows = parse(data, filename)
    def work():
        current = locations.authorize(db, actor, "import")
        fingerprint = review_digest(current, data, filename)
        if confirm and not hmac.compare_digest(digest or "", fingerprint):
            raise locations.LocationError("File or session changed. Review again before confirming.", 409,
                                       "location_review_changed")
        # Invalid names must remain row-level errors, not become DB encoding
        # errors (e.g. an embedded NUL). Only validated names reach SQL.
        names = []
        for row in rows:
            try:
                names.append(LocationFields(name=row["name"], address=row["address"], status=row["status"]).name)
            except ValidationError:
                names.append("")
        normalized = list(db.scalars(select(normalized_name(func.unnest(cast(names, ARRAY(Text)))))))
        existing = set(db.scalars(select(normalized_name(StorageLocation.name)).where(
            StorageLocation.deleted_at.is_(None), normalized_name(StorageLocation.name).in_(normalized))))
        seen = set()
        for row, key in zip(rows, normalized):
            if key in seen:
                row["errors"].append("Duplicate name within this file.")
            if key in existing:
                row["errors"].append("A non-deleted storage location already uses this name.")
            seen.add(key)
        valid = not any(row["errors"] for row in rows)
        if confirm:
            if not valid:
                raise locations.LocationError("Invalid rows or new conflicts. Nothing was imported. Review again.",
                                           409, "location_import_conflict")
            for row in rows:
                locations.insert(db, current, LocationFields(**{key: row[key] for key in ("name", "address", "status", *GEO_FIELDS)}))
            db.commit()
            return {"imported": len(rows)}
        db.commit()
        return dict(rows=rows, valid=valid, digest=fingerprint)
    return locations.transaction(db, work)


@present_export
def export(db, actor, query, status, format):
    def work():
        locations.authorize(db, actor, "export")
        records = list(db.scalars(select(StorageLocation).where(*locations.predicates(query, status))
                                  .order_by(StorageLocation.created_at.desc(), StorageLocation.id.desc())
                                  .limit(EXPORT_LIMIT + 1)))
        if len(records) > EXPORT_LIMIT:
            raise locations.LocationError("Export exceeds 5,000 matching records. Narrow the name/address/status filters.",
                                       422, "location_export_limit")
        rows = [HEADERS]
        for row in records:
            record = locations.projection(db, row)
            rows.append([safe_text(row.name), safe_text(row.address), row.status,
                         *(safe_text(getattr(row, key)) for key in GEO_FIELDS),
                         safe_text(record["createdBy"]), row.created_at.isoformat(),
                         safe_text(record["updatedBy"]), row.updated_at.isoformat()])
        db.commit()
        return rows
    rows = locations.transaction(db, work)
    output = io.StringIO() if format == "csv" else io.BytesIO()
    if format == "csv":
        csv.writer(output).writerows(rows)
        return output.getvalue().encode("utf-8-sig")
    book = Workbook()
    try:
        book.active.title = "Storage Locations"
        for row in rows:
            book.active.append(row)
            for cell in book.active[book.active.max_row]:
                cell.data_type = "s"
        book.save(output)
        return output.getvalue()
    finally:
        book.close()
