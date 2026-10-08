"""Bounded, inert, create-only transfer; reviewed bytes are never persisted."""
import csv
import hashlib
import hmac
import io
from openpyxl import Workbook
from pydantic import ValidationError
from sqlalchemy import Text, cast, func, select
from sqlalchemy.dialects.postgresql import ARRAY
from app.core.config import get_settings
from app.db.headquarter_models import Headquarter, normalized_name
from app.schemas.headquarters import HeadquarterFields, abbreviation
from app.services import headquarters
from app.services.zone_transfer import workbook_rows, safe_text, UNSAFE
from app.services.zones import ZoneError

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 1000
EXPORT_LIMIT = 5000
HEADERS = ["HQ Name", "State Code", "Status", "Created By", "Created At", "Updated By", "Updated At"]


def invalid(message):
    raise headquarters.HeadquarterError(message, 422, "headquarter_invalid_file")


def parse(data, filename):
    if not data or len(data) > MAX_BYTES:
        raise headquarters.HeadquarterError("Use a non-empty file no larger than 2 MiB.", 413, "headquarter_file_limit")
    if filename.lower().endswith(".csv"):
        try:
            rows = []
            for row in csv.reader(io.StringIO(data.decode("utf-8-sig")), strict=True):
                if len(rows) >= MAX_ROWS + 1 or len(row) > 7 or any(len(cell) > 10000 for cell in row):
                    invalid("CSV exceeds 1,000 records, seven columns or 10,000 characters per cell.")
                rows.append(row)
        except (UnicodeError, csv.Error):
            invalid("Use valid UTF-8 CSV with well-formed quoted cells.")
    elif filename.lower().endswith(".xlsx"):
        try:
            rows = workbook_rows(data, max_columns=7)
        except ZoneError as exc:
            invalid(exc.message)
    else:
        invalid("Only UTF-8 .csv and genuine .xlsx are supported.")
    if not rows or rows[0] not in (HEADERS[:3], HEADERS):
        invalid("Use exact HQ Name,State Code,Status headers or the seven-column audit export schema.")
    width = len(rows[0])
    reviewed = []
    for number, cells in enumerate(rows[1:], 2):
        errors = [] if len(cells) == width else ["Row must match the header column count."]
        values = [cells[index].strip() if len(cells) > index else "" for index in range(3)]
        if width == 7:
            for index in (0, 1):
                value = values[index]
                if value.startswith("'") and (value[1:].startswith("'") or UNSAFE.match(value[1:])):
                    values[index] = value[1:]
        name, code, status = values
        status = status.lower()
        try:
            fields = HeadquarterFields(name=name, status=status, **({"state_code": code} if code else {}))
            name, code = fields.name, fields.state_code or abbreviation(fields.name)
        except ValidationError:
            errors.append("Name must be 1–200 printable characters, code 1–16 and status Active or Inactive. Names without letters need a code.")
        reviewed.append(dict(row=number, name=name, state_code=code, status=status, errors=errors))
    if not reviewed:
        invalid("At least one record is required.")
    return reviewed


def review_digest(actor, data, filename):
    message = "\0".join(("headquarter", str(actor.user.id), actor.session_id, filename,
                         hashlib.sha256(data).hexdigest())).encode()
    return hmac.new(get_settings().signing_key.encode(), message, hashlib.sha256).hexdigest()


def transfer(db, actor, data, filename, confirm=False, digest=None):
    rows = parse(data, filename)
    def work():
        current = headquarters.authorize(db, actor, "import")
        fingerprint = review_digest(current, data, filename)
        if confirm and not hmac.compare_digest(digest or "", fingerprint):
            raise headquarters.HeadquarterError("File or session changed. Review again before confirming.", 409, "headquarter_review_changed")
        names = []
        for row in rows:
            try:
                names.append(HeadquarterFields(name=row["name"], state_code=row["state_code"], status=row["status"]).name)
            except ValidationError:
                names.append("")
        keys = list(db.scalars(select(normalized_name(func.unnest(cast(names, ARRAY(Text)))))))
        existing = set(db.scalars(select(normalized_name(Headquarter.name)).where(
            Headquarter.deleted_at.is_(None), normalized_name(Headquarter.name).in_(keys))))
        seen = set()
        for row, key in zip(rows, keys):
            if key in seen:
                row["errors"].append("Duplicate name within this file.")
            if key in existing:
                row["errors"].append("A non-deleted headquarter already uses this name.")
            seen.add(key)
        valid = not any(row["errors"] for row in rows)
        if confirm:
            if not valid:
                raise headquarters.HeadquarterError("Invalid rows or new conflicts. Nothing was imported. Review again.", 409, "headquarter_import_conflict")
            for row in rows:
                headquarters.insert(db, current, HeadquarterFields(name=row["name"], state_code=row["state_code"], status=row["status"]))
            db.commit()
            return {"imported": len(rows)}
        db.commit()
        return dict(rows=rows, valid=valid, digest=fingerprint)
    return headquarters.transaction(db, work)


def encode(rows, format):
    if format == "csv":
        output = io.StringIO()
        csv.writer(output).writerows(rows)
        return output.getvalue().encode("utf-8-sig")
    output = io.BytesIO()
    book = Workbook()
    try:
        book.active.title = "Headquarters"
        for row in rows:
            book.active.append(row)
            for cell in book.active[book.active.max_row]:
                cell.data_type = "s"
        book.save(output)
        return output.getvalue()
    finally:
        book.close()


def sample(format):
    return encode([HEADERS[:3], ["North Mumbai", "NM", "active"]], format)


def export(db, actor, query, status, format):
    def work():
        headquarters.authorize(db, actor, "export")
        records = list(db.scalars(select(Headquarter).where(*headquarters.predicates(query, status))
                                  .order_by(Headquarter.created_at.desc(), Headquarter.id.desc()).limit(EXPORT_LIMIT + 1)))
        if len(records) > EXPORT_LIMIT:
            raise headquarters.HeadquarterError("Export exceeds 5,000 matching records. Narrow name/code/status filters.", 422, "headquarter_export_limit")
        rows = [HEADERS]
        for row in records:
            record = headquarters.projection(db, row)
            rows.append([safe_text(row.name), safe_text(row.state_code), row.status,
                         safe_text(record["createdBy"]), row.created_at.isoformat(),
                         safe_text(record["updatedBy"]), row.updated_at.isoformat()])
        db.commit()
        return rows
    return encode(headquarters.transaction(db, work), format)
