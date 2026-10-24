"""Name-only, bounded, create-only transfers; uploaded bytes are never persisted."""
import csv
import hashlib
import hmac
import io

from openpyxl import Workbook
from pydantic import ValidationError
from sqlalchemy import Text, cast, func, select
from sqlalchemy.dialects.postgresql import ARRAY

from app.core.config import get_settings
from app.db.language_models import Language
from app.schemas.languages import LanguageFields
from app.services import languages
from app.services.zone_transfer import workbook_rows, safe_text, UNSAFE
from app.services.zones import ZoneError

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 1000
EXPORT_LIMIT = 1000
HEADERS = ["Language name"]


def invalid(message):
    raise languages.LanguageError(message, 422, "language_invalid_file")


def parse(data, filename):
    if not data or len(data) > MAX_BYTES:
        raise languages.LanguageError("Use a non-empty file no larger than 2 MiB.", 413, "language_file_limit")
    if filename.lower().endswith(".csv"):
        try:
            rows = []
            for cells in csv.reader(io.StringIO(data.decode("utf-8-sig")), strict=True):
                if len(rows) >= MAX_ROWS + 1 or len(cells) > 1 or any(len(cell) > 10000 for cell in cells):
                    invalid("CSV allows 1,000 records, exactly one column and at most 10,000 characters per cell.")
                rows.append(cells)
        except (UnicodeError, csv.Error):
            invalid("Use valid UTF-8 CSV with well-formed quoted cells.")
    elif filename.lower().endswith(".xlsx"):
        try:
            rows = workbook_rows(data, max_columns=1)
        except ZoneError as exc:
            invalid(exc.message)
    else:
        invalid("Only UTF-8 .csv and genuine single-sheet .xlsx files are supported; no .xls or macro-enabled files.")
    if not rows or rows[0] != HEADERS:
        invalid('Use exactly one column headed "Language name". No extra, reordered or audit columns.')
    reviewed = []
    for number, cells in enumerate(rows[1:], 2):
        errors = [] if len(cells) == 1 else ["Row must contain exactly one Language name cell."]
        name = cells[0].strip() if cells else ""
        # This is the documented convention for ALL Language transfer files:
        # double literal leading apostrophes; prefix formula-like names with one.
        if name.startswith("'") and (name[1:].startswith("'") or UNSAFE.match(name[1:])):
            name = name[1:]
        try:
            name = LanguageFields(name=name).name
        except ValidationError as exc:
            errors.extend(f"Language name: {e['msg']}" for e in exc.errors(include_input=False))
        # Sanitize invalid surrogate/noncharacter text so even an invalid review
        # can be safely serialized; these rows remain ineligible for insertion.
        display = "".join("\ufffd" if 0xD800 <= ord(char) <= 0xDFFF or char in "\ufffe\uffff" else char for char in name)
        reviewed.append(dict(row=number, values={"name": display}, errors=errors))
    if not reviewed:
        invalid("At least one record is required.")
    return reviewed


def normalized(value):
    return func.lower(value.collate("pg_c_utf8"))


def review_digest(actor, data, filename):
    message = "\0".join(("language", str(actor.user.id), actor.session_id, filename,
                          hashlib.sha256(data).hexdigest())).encode()
    return hmac.new(get_settings().signing_key.encode(), message, hashlib.sha256).hexdigest()


def transfer(db, actor, data, filename, confirm=False, digest=None):
    rows = parse(data, filename)
    def work():
        current = languages.authorize(db, actor, "import")
        fingerprint = review_digest(current, data, filename)
        if confirm and not hmac.compare_digest(digest or "", fingerprint):
            raise languages.LanguageError("File or login session changed. Review again before confirming.",
                                          409, "language_review_changed")
        # Do not send invalid NUL/control text to PostgreSQL. Invalid rows already
        # carry field errors, and never participate in successful insertion.
        eligible = [row for row in rows if not row["errors"]]
        names = [row["values"]["name"] for row in eligible]
        keys = list(db.scalars(select(normalized(func.unnest(cast(names, ARRAY(Text)))))))
        existing = set(db.scalars(select(normalized(Language.name)).where(
            Language.deleted_at.is_(None), normalized(Language.name).in_(keys))))
        counts = {}
        for key in keys:
            counts[key] = counts.get(key, 0) + 1
        for row, key in zip(eligible, keys):
            if counts[key] > 1:
                row["errors"].append("Duplicate language name within this file.")
            if key in existing:
                row["errors"].append("A non-deleted language already uses this name.")
        invalid_count = sum(bool(row["errors"]) for row in rows)
        if confirm:
            if invalid_count:
                raise languages.LanguageError("Invalid rows or current name conflicts. Nothing was imported. Review again.",
                                              409, "language_import_conflict")
            for row in rows:
                languages.insert(db, current, LanguageFields(**row["values"]))
            # Unique index races, audits and retained create histories share this commit.
            db.commit()
            return {"imported": len(rows)}
        db.commit()
        return dict(rows=rows, valid=not invalid_count, digest=fingerprint,
                    validCount=len(rows) - invalid_count, invalidCount=invalid_count)
    return languages.transaction(db, work)


def encode(rows, format):
    if format == "csv":
        output = io.StringIO()
        csv.writer(output).writerows(rows)
        return output.getvalue().encode("utf-8-sig")
    output = io.BytesIO()
    book = Workbook()
    try:
        book.active.title = "Languages"
        for row in rows:
            book.active.append(row)
            for cell in book.active[book.active.max_row]:
                cell.data_type = "s"
        book.save(output)
        return output.getvalue()
    finally:
        book.close()


def sample(format):
    return encode([HEADERS, ["Example language"]], format)


def export(db, actor, query, format):
    def work():
        languages.authorize(db, actor, "export")
        filters = [Language.deleted_at.is_(None)]
        if query.strip():
            escaped = query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            filters.append(Language.name.collate("pg_c_utf8").ilike("%" + escaped + "%", escape="\\"))
        records = list(db.scalars(select(Language).where(*filters)
                                 .order_by(Language.created_at.desc(), Language.id.desc()).limit(EXPORT_LIMIT + 1)))
        if len(records) > EXPORT_LIMIT:
            raise languages.LanguageError("Export exceeds 1,000 matching languages. Narrow the name search; no partial file was exported.",
                                          422, "language_export_limit")
        rows = [HEADERS] + [[safe_text(record.name)] for record in records]
        db.commit()
        return rows
    return encode(languages.transaction(db, work), format)
