"""Inert bounded transfers, identity/file-bound reviews and atomic create-only commits."""
import csv
import hashlib
import hmac
import io
import posixpath
import re
import zipfile
from decimal import Decimal, InvalidOperation
from defusedxml import ElementTree
from openpyxl import Workbook
from pydantic import ValidationError
from sqlalchemy import func, select
from app.core.config import get_settings
from app.db.sales_target_models import SalesTarget
from app.db.mr_models import MRDirectory
from app.schemas.sales_targets import SalesTargetFields, QUARTERS
from app.services import sales_targets
from app.services.zone_transfer import workbook_rows, safe_text, UNSAFE
from app.services.zones import ZoneError

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 1000
EXPORT_LIMIT = 5000
FIELDS = ("employeeCode", "startYear", "endYear", *QUARTERS, "status")
HEADERS = ["Employee Code", "Start Year", "End Year", "Q1", "Q2", "Q3", "Q4", "Status",
           "Created By", "Created At", "Updated By", "Updated At"]
LABELS = dict(zip(FIELDS, HEADERS))


def invalid(message):
    raise sales_targets.SalesTargetError(message, 422, "sales_target_invalid_file")


def exact_workbook_rows(data):
    rows = workbook_rows(data, max_columns=12)
    # Recover original numeric XML lexemes AFTER shared ZIP/XML/link/formula validation.
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
            for cell in ElementTree.fromstring(archive.read(path)).iter():
                if cell.tag.rsplit("}", 1)[-1] != "c" or cell.attrib.get("t", "n") != "n":
                    continue
                match = re.fullmatch(r"([B-G])([0-9]+)", cell.attrib.get("r", ""))
                if not match or int(match[2]) < 2:
                    continue
                index, column = int(match[2]) - 1, ord(match[1]) - ord("A")
                value = next((node.text for node in cell if node.tag.rsplit("}", 1)[-1] == "v"), None)
                if value is None or index >= len(rows) or column >= len(rows[index]):
                    continue
                amount = Decimal(value)
                # Cap before expansion of exponent notation, including adversarial long/huge exponents.
                precision = 0 if column in (1, 2) else 2
                maximum = Decimal("9999") if precision == 0 else Decimal("999999999999.99")
                if (not amount.is_finite() or amount < 0 or amount > maximum
                        or amount.as_tuple().exponent < -precision):
                    text = "invalid numeric value"
                else:
                    text = format(amount, "f")
                rows[index][column] = text
        return rows
    except (InvalidOperation, ValueError, KeyError, StopIteration, zipfile.BadZipFile):
        invalid("Malformed workbook amount or worksheet.")


def parse(data, filename):
    if not data or len(data) > MAX_BYTES:
        raise sales_targets.SalesTargetError("Use a non-empty file no larger than 2 MiB.", 413, "sales_target_file_limit")
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
            rows = exact_workbook_rows(data)
        except ZoneError as exc:
            invalid(exc.message)
    else:
        invalid("Only UTF-8 .csv and genuine .xlsx are supported. No .xls or macro-enabled files.")
    if not rows or rows[0] not in (HEADERS[:7], HEADERS[:8], HEADERS):
        invalid("Use the seven-column legacy schema, eight business columns or twelve-column current export in exact order.")
    width = len(rows[0])
    reviewed = []
    for number, cells in enumerate(rows[1:], 2):
        errors = [] if len(cells) == width else ["Row must match the header column count."]
        values = {key: cells[index].strip() if index < len(cells) else "" for index, key in enumerate(FIELDS)}
        code = values["employeeCode"]
        if code.startswith("'") and (code[1:].startswith("'") or UNSAFE.match(code[1:])):
            values["employeeCode"] = code[1:]
        if width == 7:
            values["status"] = "active"
        else:
            values["status"] = values["status"].lower()
        reviewed.append(dict(row=number, values=values, errors=errors))
    if not reviewed:
        invalid("At least one record is required.")
    return reviewed


def review_digest(actor, data, filename):
    message = "\0".join(("sales_target", str(actor.user.id), actor.session_id, filename,
                          hashlib.sha256(data).hexdigest())).encode()
    return hmac.new(get_settings().signing_key.encode(), message, hashlib.sha256).hexdigest()


def transfer(db, actor, data, filename, confirm=False, digest=None):
    def work():
        current = sales_targets.authorize(db, actor)
        rows = parse(data, filename)
        fingerprint = review_digest(current, data, filename)
        if confirm and not hmac.compare_digest(digest or "", fingerprint):
            raise sales_targets.SalesTargetError("File or session changed. Review again before confirming.",
                                                409, "sales_target_review_changed")
        codes = {row["values"]["employeeCode"].lower() for row in rows}
        references = list(db.scalars(select(MRDirectory).where(func.lower(MRDirectory.employeeCode).in_(codes))))
        by_code = {mr.employeeCode.lower(): mr for mr in references}
        existing = set(db.execute(select(SalesTarget.mrId, SalesTarget.startYear).where(
            SalesTarget.deleted_at.is_(None), SalesTarget.mrId.in_([mr.id for mr in references]))).all())
        seen = set()
        clean = []
        for row in rows:
            values = row["values"]
            mr = by_code.get(values["employeeCode"].lower())
            if not mr:
                row["errors"].append("Employee Code must match a saved server MR; missing records cannot be imported.")
            else:
                try:
                    sales_targets.reference(db, mr.id, lock=True)
                except sales_targets.SalesTargetError as exc:
                    row["errors"].append(exc.message)
            candidate = {key: values[key] for key in FIELDS if key != "employeeCode"}
            candidate["mrId"] = mr.id if mr else None
            for key in ("startYear", "endYear"):
                if re.fullmatch(r"[0-9]{1,4}", candidate[key]):
                    candidate[key] = int(candidate[key])
            try:
                fields = SalesTargetFields(**candidate)
                values.update({key: str(getattr(fields, key)) for key in FIELDS if key != "employeeCode"})
                key = (fields.mrId, fields.startYear)
                if key in existing:
                    row["errors"].append("This MR already has a non-deleted target for this financial year, including inactive targets.")
                if key in seen:
                    row["errors"].append("Duplicate Employee Code and financial year within this file.")
                seen.add(key)
                clean.append(fields)
            except ValidationError as exc:
                for error in exc.errors(include_input=False):
                    field = error["loc"][0] if error["loc"] else None
                    if field == "mrId":
                        continue
                    if field in LABELS:
                        row["errors"].append(f"{LABELS[field]}: {error['msg']}")
                    else:
                        row["errors"].append("Financial end year must be the consecutive year after start year.")
        invalid_count = sum(bool(row["errors"]) for row in rows)
        if confirm:
            if invalid_count:
                raise sales_targets.SalesTargetError("Invalid rows or new conflicts. Nothing was imported. Review again.",
                                                    409, "sales_target_import_conflict")
            for fields in clean:
                sales_targets.insert(db, current, fields)
            db.commit()
            return {"imported": len(rows)}
        db.commit()
        return dict(rows=rows, valid=not invalid_count, digest=fingerprint,
                    validCount=len(rows) - invalid_count, invalidCount=invalid_count)
    return sales_targets.transaction(db, work)


def encode(rows, format):
    if format == "csv":
        output = io.StringIO()
        csv.writer(output).writerows(rows)
        return output.getvalue().encode("utf-8-sig")
    output = io.BytesIO()
    book = Workbook()
    try:
        book.active.title = "SalesTargets"
        for row in rows:
            book.active.append(row)
            for cell in book.active[book.active.max_row]:
                cell.data_type = "s"
        book.save(output)
        return output.getvalue()
    finally:
        book.close()


def sample(format):
    now = sales_targets.datetime.now(sales_targets.timezone.utc)
    year = now.year - (now.month < 4)
    return encode([HEADERS[:8], ["REPLACE-WITH-SAVED-MR-CODE", str(year), str(year + 1),
                                 "100000.00", "100000.00", "100000.00", "100000.00", "active"]], format)


def export(db, actor, filters, format):
    def work():
        sales_targets.authorize(db, actor)
        records = list(db.scalars(select(SalesTarget).where(*sales_targets.predicates(**filters))
                                  .order_by(SalesTarget.created_at.desc(), SalesTarget.id.desc()).limit(EXPORT_LIMIT + 1)))
        if len(records) > EXPORT_LIMIT:
            raise sales_targets.SalesTargetError("Export exceeds 5,000 matching targets. Narrow the applied filters.",
                                                422, "sales_target_export_limit")
        rows = [HEADERS]
        for row in records:
            record = sales_targets.projection(db, row)
            rows.append([safe_text(record["employeeCode"]), str(row.startYear), str(row.endYear),
                         *(record[key] for key in QUARTERS), row.status,
                         safe_text(record["createdBy"]), row.created_at.isoformat(),
                         safe_text(record["updatedBy"]), row.updated_at.isoformat()])
        db.commit()
        return rows
    return encode(sales_targets.transaction(db, work), format)
