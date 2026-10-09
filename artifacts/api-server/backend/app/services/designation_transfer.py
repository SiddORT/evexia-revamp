"""Bounded inert transfers. No uploaded bytes or historical attribution persisted."""
import csv
import hashlib
import hmac
import io

from openpyxl import Workbook
from pydantic import ValidationError
from sqlalchemy import Text, cast, func, select
from sqlalchemy.dialects.postgresql import ARRAY

from app.core.config import get_settings
from app.db.designation_models import Designation, normalized_name
from app.schemas.designations import BUSINESS_FIELDS, DesignationFields
from app.services import designations
from app.services.zone_transfer import workbook_rows, safe_text, UNSAFE
from app.services.zones import ZoneError

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 1000
EXPORT_LIMIT = 5000
LEGACY_HEADERS = ["Designation Name", "Short Name", "Level", "Status", "Basic + DA (%)", "HRA (%)",
           "Medical Allowance (%)", "Travelling Allowance (%)", "Special Allowance (%)",
           "professional tax (Rs)", "Created By", "Created At", "Updated By", "Updated At"]
HEADERS = ["Designation Name", "Short Name", "Status", *LEGACY_HEADERS[10:]]


def invalid(message):
    raise designations.DesignationError(message, 422, "designation_invalid_file")


def parse(data, filename):
    if not data or len(data) > MAX_BYTES:
        raise designations.DesignationError("Use a non-empty file no larger than 2 MiB.", 413, "designation_file_limit")
    if filename.lower().endswith(".csv"):
        try:
            rows = []
            for row in csv.reader(io.StringIO(data.decode("utf-8-sig")), strict=True):
                if len(rows) >= MAX_ROWS + 1 or len(row) > 14 or any(len(cell) > 10000 for cell in row):
                    invalid("CSV exceeds 1,000 records, 14 columns or 10,000 characters per cell.")
                rows.append(row)
        except (UnicodeError, csv.Error):
            invalid("Use valid UTF-8 CSV with well-formed quoted cells.")
    elif filename.lower().endswith(".xlsx"):
        try:
            rows = workbook_rows(data, max_columns=14)
        except ZoneError as exc:
            invalid(exc.message)
    else:
        invalid("Only UTF-8 .csv and genuine .xlsx are supported. No .xls or macro-enabled files.")
    if not rows or rows[0] not in (HEADERS[:3], HEADERS, LEGACY_HEADERS[:10], LEGACY_HEADERS):
        invalid("Use the exact three/seven-column current schema or ten/fourteen-column legacy schema, in order.")
    width = len(rows[0])
    legacy = rows[0] in (LEGACY_HEADERS[:10], LEGACY_HEADERS)
    positions = (0, 1, 3) if legacy else (0, 1, 2)
    reviewed = []
    for number, cells in enumerate(rows[1:], 2):
        errors = [] if len(cells) == width else ["Row must match the header column count."]
        padded = cells + [""] * width
        values = dict(zip(BUSINESS_FIELDS, (padded[index] for index in positions)))
        for field in ("name", "shortName"):
            value = values[field].strip()
            if width in (7, 14) and value.startswith("'") and (value[1:].startswith("'") or UNSAFE.match(value[1:])):
                value = value[1:]
            values[field] = value
        values["status"] = values["status"].strip().lower()
        try:
            fields = DesignationFields(**values)
            values = fields.model_dump(mode="json")
        except ValidationError:
            errors.append("Name 1–200, short name 1–50; status Active/Inactive.")
        reviewed.append(dict(row=number, values=values, errors=errors))
    if not reviewed:
        invalid("At least one record is required.")
    return reviewed


def review_digest(actor, data, filename):
    message = "\0".join(("designation", str(actor.user.id), actor.session_id, filename,
                          hashlib.sha256(data).hexdigest())).encode()
    return hmac.new(get_settings().signing_key.encode(), message, hashlib.sha256).hexdigest()


def transfer(db, actor, data, filename, confirm=False, digest=None):
    rows = parse(data, filename)
    def work():
        current = designations.authorize(db, actor)
        fingerprint = review_digest(current, data, filename)
        if confirm and not hmac.compare_digest(digest or "", fingerprint):
            raise designations.DesignationError("File or session changed. Review again before confirming.", 409, "designation_review_changed")
        names = []
        for row in rows:
            try:
                names.append(DesignationFields(**row["values"]).name)
            except ValidationError:
                names.append("")
        normalized = list(db.scalars(select(normalized_name(func.unnest(cast(names, ARRAY(Text)))))))
        existing = set(db.scalars(select(normalized_name(Designation.name)).where(
            Designation.deleted_at.is_(None), normalized_name(Designation.name).in_(normalized))))
        seen = set()
        for row, key in zip(rows, normalized):
            if key in seen:
                row["errors"].append("Duplicate name within this file.")
            if key in existing:
                row["errors"].append("A non-deleted designation already uses this name.")
            seen.add(key)
        invalid_count = sum(bool(row["errors"]) for row in rows)
        if confirm:
            if invalid_count:
                raise designations.DesignationError("Invalid rows or new conflicts. Nothing was imported. Review again.", 409, "designation_import_conflict")
            for row in rows:
                designations.insert(db, current, DesignationFields(**row["values"]))
            db.commit()
            return {"imported": len(rows)}
        db.commit()
        return dict(rows=rows, valid=not invalid_count, digest=fingerprint,
                    validCount=len(rows) - invalid_count, invalidCount=invalid_count)
    return designations.transaction(db, work)


def encode(rows, format):
    if format == "csv":
        output = io.StringIO()
        csv.writer(output).writerows(rows)
        return output.getvalue().encode("utf-8-sig")
    output = io.BytesIO()
    book = Workbook()
    try:
        book.active.title = "Designations"
        for row in rows:
            book.active.append(row)
            for cell in book.active[book.active.max_row]:
                cell.data_type = "s"
        book.save(output)
        return output.getvalue()
    finally:
        book.close()


def sample(format):
    return encode([HEADERS[:3], ["Example designation", "EX", "active"]], format)


def export(db, actor, query, status, format):
    def work():
        designations.authorize(db, actor)
        records = list(db.scalars(select(Designation).where(*designations.predicates(query, status))
                                  .order_by(Designation.created_at.desc(), Designation.id.desc()).limit(EXPORT_LIMIT + 1)))
        if len(records) > EXPORT_LIMIT:
            raise designations.DesignationError("Export exceeds 5,000 matching records. Narrow name/short name/status filters.", 422, "designation_export_limit")
        rows = [HEADERS]
        for row in records:
            record = designations.projection(db, row)
            values = [safe_text(getattr(row, field)) if field in ("name", "shortName") else str(getattr(row, field))
                      for field in BUSINESS_FIELDS]
            rows.append(values + [safe_text(record["createdBy"]), row.created_at.isoformat(),
                                  safe_text(record["updatedBy"]), row.updated_at.isoformat()])
        db.commit()
        return rows
    return encode(designations.transaction(db, work), format)
