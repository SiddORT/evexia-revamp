"""Inert bounded transfers. Upload attribution is ignored, not restored."""
import csv
import hashlib
import hmac
import io
import posixpath
import re
import uuid
import zipfile
from decimal import Decimal, InvalidOperation
from datetime import timedelta
from defusedxml import ElementTree
from pydantic import ValidationError
from sqlalchemy import func, select
from app.core.config import get_settings
from app.core.security import utcnow
from app.db.doctor_models import DoctorDirectory as Doctor
from app.db.opening_balance_models import OpeningBalance as Balance, OpeningBalanceImportReview
from app.schemas.opening_balances import OpeningBalanceFields, exact_amount
from app.services import opening_balances as balances, mrs
from app.services.product_category_transfer import encode
from app.services.zone_transfer import workbook_rows, safe_text
from app.services.zones import ZoneError

HEADERS = ["Financial Start Year", "Financial End Year", "Doctor Registration Number", "Opening Balance", "Status",
           "Created By", "Created At", "Updated By", "Updated At"]
MAX_BYTES, MAX_ROWS, EXPORT_LIMIT = 2 * 1024 * 1024, 1000, 5000


def invalid(message):
    raise balances.OpeningBalanceError(message, 422, "opening_balance_invalid_file")


def workbook(data):
    rows = workbook_rows(data, max_columns=9)
    # Safety checks precede XML access. Recover original D-column decimal lexemes.
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            book = ElementTree.fromstring(archive.read("xl/workbook.xml"))
            sheet = next(n for n in book.iter() if n.tag.rsplit("}", 1)[-1] == "sheet")
            rid = next(v for k, v in sheet.attrib.items() if k.rsplit("}", 1)[-1] == "id")
            rels = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            target = next(n.attrib["Target"] for n in rels if n.attrib.get("Id") == rid)
            path = posixpath.normpath(target.lstrip("/") if target.startswith("/") else "xl/" + target)
            if not path.startswith("xl/worksheets/"):
                invalid("Unsupported worksheet location.")
            for cell in ElementTree.fromstring(archive.read(path)).iter():
                coordinate = cell.attrib.get("r", "")
                if cell.tag.rsplit("}", 1)[-1] != "c" or cell.attrib.get("t", "n") != "n" or not re.fullmatch(r"D[2-9]\d*|D1\d+", coordinate):
                    continue
                index = int(coordinate[1:]) - 1
                raw = next((n.text for n in cell if n.tag.rsplit("}", 1)[-1] == "v"), None)
                if raw is None or index >= len(rows):
                    continue
                try:
                    amount = Decimal(raw)
                    if not amount.is_finite() or amount.copy_abs() > Decimal("9999999999999.99") or amount.as_tuple().exponent < -2:
                        raise ValueError()
                    text = exact_amount(format(amount, "f"))
                except (ValueError, InvalidOperation):
                    text = "invalid numeric amount"
                while len(rows[index]) < 4:
                    rows[index].append("")
                rows[index][3] = text
    except (ValueError, KeyError, StopIteration, zipfile.BadZipFile):
        invalid("Malformed monetary workbook.")
    return rows


def parse(data, filename):
    if not data or len(data) > MAX_BYTES:
        raise balances.OpeningBalanceError("Use a non-empty file no larger than 2 MiB.", 413, "opening_balance_file_limit")
    if filename.lower().endswith(".csv"):
        try:
            rows = []
            for row in csv.reader(io.StringIO(data.decode("utf-8-sig")), strict=True):
                if len(rows) >= MAX_ROWS + 1 or len(row) > 9 or any(len(c) > 10000 for c in row):
                    invalid("Limit: 1,000 records, nine columns, 10,000 characters per cell.")
                rows.append(row)
        except (UnicodeError, csv.Error):
            invalid("Use valid UTF-8 CSV with well-formed quoted cells.")
    elif filename.lower().endswith(".xlsx"):
        try:
            rows = workbook(data)
        except ZoneError as exc:
            invalid(exc.message)
    else:
        invalid("Only UTF-8 .csv and genuine .xlsx are supported.")
    if not rows or rows[0] not in (HEADERS[:5], HEADERS):
        invalid("Use the exact five-column legacy/sample headers or nine-column server export headers.")
    reviewed = []
    for number, cells in enumerate(rows[1:], 2):
        values = [cells[i].strip() if len(cells) > i else "" for i in range(5)]
        # Reverse our spreadsheet escaping, including legacy signed-money CSV.
        for index in (2, 3):
            if values[index].startswith("'") and (values[index][1:].startswith("'") or re.match(r"^[\s\x00-\x1f]*[=+\-@]", values[index][1:])):
                values[index] = values[index][1:]
        row = dict(row=number, **dict(zip(("startYear", "endYear", "registrationNumber", "amount", "status"), values)),
                   errors=[] if len(cells) == len(rows[0]) else ["Row must match the header column count."])
        row["status"] = row["status"].lower()
        try:
            body = fields(row, uuid.UUID(int=0))
            row["amount"] = body.amount
        except (ValueError, ValidationError):
            row["errors"].append("Years must be 1900–9998 and the following year; signed amount must be within ±9999999999999.99 with at most two decimals; status Active/Inactive.")
        reviewed.append(row)
    if not reviewed:
        invalid("At least one record is required.")
    return reviewed


def fields(row, doctor_id):
    if not re.fullmatch(r"\d{4}", row["startYear"]) or not re.fullmatch(r"\d{4}", row["endYear"]):
        raise ValueError("Four-digit years required")
    return OpeningBalanceFields(startYear=int(row["startYear"]), endYear=int(row["endYear"]),
                                doctorId=doctor_id, amount=row["amount"], status=row["status"])


def review_digest(actor, data, filename):
    message = "\0".join(("opening_balance", str(actor.user.id), actor.session_id, filename, hashlib.sha256(data).hexdigest())).encode()
    return hmac.new(get_settings().signing_key.encode(), message, hashlib.sha256).hexdigest()


def transfer(db, actor, data, filename, confirm=False, digest=None):
    def work():
        current = balances.authorize(db, actor)
        fingerprint = review_digest(current, data, filename)
        saved_review = db.get(OpeningBalanceImportReview, current.session_id, with_for_update=True)
        if confirm:
            accepted = (saved_review and saved_review.actor_id == current.user.id
                        and saved_review.expires_at > utcnow()
                        and hmac.compare_digest(saved_review.digest, digest or "")
                        and hmac.compare_digest(fingerprint, digest or ""))
            # Consume before attempting writes. Conflicts, parser failures and lost
            # commit responses cannot replay this reviewed batch without new review.
            if saved_review:
                db.delete(saved_review)
            db.commit()
            if not accepted:
                raise balances.OpeningBalanceError("Review expired, replaced or consumed; file/session may have changed. Review again.",
                                                  409, "opening_balance_review_changed")
            current = balances.authorize(db, actor)
        elif saved_review:
            # Even an invalid replacement invalidates the older review.
            db.delete(saved_review)
            db.commit()
            saved_review = None
            current = balances.authorize(db, actor)
        mrs.graph_lock(db)
        rows = parse(data, filename)
        registrations = [r["registrationNumber"].lower() for r in rows]
        doctors = list(db.scalars(select(Doctor).where(func.lower(func.btrim(Doctor.registrationNumber)).in_(registrations))
                                 .order_by(Doctor.id).execution_options(populate_existing=True).with_for_update()))
        matches = {}
        for doctor in doctors:
            matches.setdefault(doctor.registrationNumber.strip().lower(), []).append(doctor)
        existing = set(db.execute(select(Balance.doctorId, Balance.startYear).where(
            Balance.deleted_at.is_(None), Balance.doctorId.in_([d.id for d in doctors]))).all())
        seen, batch = set(), []
        for row in rows:
            candidates = matches.get(row["registrationNumber"].lower(), [])
            if len(candidates) != 1 or not balances.usable(candidates[0]):
                row["errors"].append("Registration must resolve unambiguously to an active shared Doctor.")
                continue
            try:
                body = fields(row, candidates[0].id)
            except (ValueError, ValidationError):
                continue
            key = (body.doctorId, body.startYear)
            if key in seen or key in existing:
                row["errors"].append("Doctor/year already exists in this file or the live register.")
            seen.add(key)
            batch.append(body)
        valid = not any(r["errors"] for r in rows)
        if confirm:
            if not valid:
                raise balances.OpeningBalanceError("Invalid rows or changed references/duplicates. Nothing imported. Review again.",
                                                  409, "opening_balance_import_conflict")
            for body in batch:
                balances.insert(db, current, body)
            db.commit()
            return {"imported": len(batch)}
        if saved_review:
            db.delete(saved_review)
            db.flush()
        if valid:
            db.add(OpeningBalanceImportReview(session_id=current.session_id, actor_id=current.user.id,
                                              digest=fingerprint, expires_at=utcnow() + timedelta(minutes=15)))
        db.commit()
        return dict(rows=rows, valid=valid, digest=fingerprint)
    return balances.transaction(db, work)


def sample(format):
    return encode([HEADERS[:5], ["2026", "2027", "REPLACE-WITH-SHARED-REGISTRATION",
        safe_text("-1250.50") if format == "csv" else "-1250.50", "active"]], format, "Opening Balances")


def export(db, actor, query, status, format):
    def work():
        balances.authorize(db, actor)
        records = list(db.scalars(select(Balance).where(*balances.predicates(query, status))
                                  .order_by(Balance.created_at.desc(), Balance.id.desc()).limit(EXPORT_LIMIT + 1)))
        if len(records) > EXPORT_LIMIT:
            raise balances.OpeningBalanceError("Export exceeds 5,000 matches. Narrow search/status filters.", 422, "opening_balance_export_limit")
        rows = [HEADERS]
        for row in records:
            p = balances.projection(db, row)
            rows.append([str(row.startYear), str(row.endYear), safe_text(p["registrationNumber"]),
                         safe_text(p["amount"]) if format == "csv" else p["amount"], row.status,
                         safe_text(p["createdBy"]), row.created_at.isoformat(), safe_text(p["updatedBy"]), row.updated_at.isoformat()])
        db.commit()
        return rows
    return encode(balances.transaction(db, work), format, "Opening Balances")
