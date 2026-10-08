"""Exact legacy 17-column compatibility and bounded modern transfers."""
import csv
import hashlib
import hmac
import io
import json
import re
import uuid
from openpyxl import Workbook
from pydantic import ValidationError
from sqlalchemy import func, select
from app.core.config import get_settings
from app.db.doctor_models import DoctorDirectory as Doctor
from app.db.patient_models import PatientDirectory as Directory
from app.schemas.patients import PatientFields
from app.services import patients, mrs
from app.services.zone_transfer import workbook_rows, safe_text, UNSAFE
from app.services.zones import ZoneError

MAX_BYTES, MAX_ROWS, EXPORT_LIMIT = 2 * 1024 * 1024, 1000, 5000
LEGACY_COLUMNS = [
    ("code", "Patient ID"), ("name", "Patient Name"), ("gender", "Gender"), ("phone", "Phone No."),
    ("email", "Email ID"), ("dateOfBirth", "Date of Birth"), ("doctorId", "Doctor ID"),
    ("doctorRegistrationNumber", "Doctor Registration Number"), ("instructionsLanguage", "Instructions Language"),
    ("status", "Status"), ("addressLine1", "Address Line 1"), ("addressLine2", "Address Line 2"),
    ("landmark", "Landmark"), ("pincode", "Pincode"), ("city", "City"), ("state", "State"), ("country", "Country"),
]
COLUMNS = LEGACY_COLUMNS + [("dialCountry", "Dial Country")]
LEGACY = [title for _, title in LEGACY_COLUMNS]
HEADERS = [title for _, title in COLUMNS]
READABLE = [("doctorName", "Doctor Name"), ("mrName", "MR Name"), ("zoneName", "Zone"),
            ("createdBy", "Created By"), ("createdAt", "Created At"), ("updatedBy", "Updated By"), ("updatedAt", "Updated At")]
CURRENT = HEADERS + [title for _, title in READABLE]
DIAL = {"IN": "+91", "US": "+1", "GB": "+44", "AE": "+971"}


def invalid(message):
    raise patients.PatientError(message, 422, "patient_invalid_file")


def parse(data, filename):
    if not data or len(data) > MAX_BYTES:
        raise patients.PatientError("Use a non-empty CSV/XLSX no larger than 2 MiB.", 413, "patient_file_limit")
    if filename.lower().endswith(".csv"):
        try:
            rows = []
            for cells in csv.reader(io.StringIO(data.decode("utf-8-sig")), strict=True):
                if len(rows) >= MAX_ROWS + 1 or len(cells) > len(CURRENT) or any(len(v) > 10000 for v in cells):
                    invalid("Maximum 1,000 records and 10,000 characters per cell.")
                rows.append(cells)
        except (UnicodeError, csv.Error):
            invalid("Use well-formed UTF-8 CSV.")
    elif filename.lower().endswith(".xlsx"):
        try:
            rows = workbook_rows(data, max_columns=len(CURRENT))
        except ZoneError as exc:
            invalid(exc.message)
    else:
        invalid("Only UTF-8 CSV and genuine XLSX are supported.")
    if not rows or rows[0] not in (LEGACY, HEADERS, CURRENT):
        invalid("Use the exact legacy 17-column or current Patient sample/export schema; unknown columns are rejected.")
    if len(rows) < 2:
        invalid("At least one patient is required.")
    parsed = []
    for number, cells in enumerate(rows[1:], 2):
        errors = [] if len(cells) == len(rows[0]) else ["Row width must match headers."]
        values = {}
        for key, title in COLUMNS:
            index = rows[0].index(title) if title in rows[0] else -1
            value = cells[index].strip() if 0 <= index < len(cells) else ""
            if value.startswith("'") and (value[1:].startswith("'") or UNSAFE.match(value[1:]) or
                                           (key in ("phone", "pincode", "doctorRegistrationNumber") and re.fullmatch(r"\d+", value[1:]))):
                value = value[1:]
            values[key] = value
        values["dialCountry"] = values["dialCountry"].upper() or "IN"
        values["gender"] = values["gender"].lower()
        values["status"] = values["status"].lower()
        # Current exports contain the international prefix. Legacy national digits
        # default explicitly to India; never strip a different country's prefix.
        prefix = DIAL.get(values["dialCountry"], "")
        if prefix and values["phone"].startswith(prefix):
            values["phone"] = values["phone"][len(prefix):]
        parsed.append(dict(row=number, values=values, errors=errors))
    return parsed


def resolve_doctor(db, reference, registration):
    direct = None
    try:
        direct = db.get(Doctor, uuid.UUID(reference)) if reference else None
    except ValueError:
        pass
    matches = list(db.scalars(select(Doctor).where(func.lower(func.btrim(Doctor.registrationNumber)) == registration.strip().lower()).limit(2))) if registration else []
    if len(matches) != 1:
        invalid("Doctor Registration Number must resolve uniquely to an existing server Doctor. Local Doctor IDs are not live references.")
    doctor = matches[0]
    if direct and direct.id != doctor.id:
        invalid("Recognized live Doctor ID disagrees with Doctor Registration Number.")
    return doctor


def review_state(db, parsed):
    rows, bodies, snapshot, codes, duplicates = [], [], [], set(), set()
    for row in parsed:
        values, errors = dict(row["values"]), list(row["errors"])
        try:
            code = values.pop("code")
            if code and not re.fullmatch(r"PAT-[A-Z0-9][A-Z0-9-]{1,59}", code):
                invalid("Patient ID must be blank or a supported uppercase PAT-code.")
            if code and code in codes:
                invalid("Duplicate Patient ID in this file.")
            codes.add(code)
            registration = values.pop("doctorRegistrationNumber")
            doctor = resolve_doctor(db, values["doctorId"], registration)
            values["doctorId"] = doctor.id
            body = PatientFields(**values)
            _, mr, zone = patients.assignment(db, doctor.id)
            patients.unique(db, body, code)
            key = (body.name.lower(), body.dialCountry, body.phone, body.dateOfBirth)
            if key in duplicates:
                invalid("Duplicate name/phone/date-of-birth combination within this file.")
            duplicates.add(key)
            bodies.append((body, code))
            snapshot.append((body.model_dump(mode="json"), code, str(doctor.id), doctor.version,
                             str(mr.id), mr.version, str(zone.id), zone.version))
        except ValidationError as exc:
            errors.extend(["Invalid " + ".".join(map(str, e["loc"])) + ": " + e["msg"] for e in exc.errors()[:10]])
        except mrs.MRError as exc:
            errors.append(exc.message)
        rows.append(dict(row=row["row"], name=row["values"]["name"], code=row["values"]["code"], errors=errors))
    return rows, bodies, snapshot


def digest_for(actor, data, filename, snapshot):
    message = json.dumps(["patient", str(actor.user.id), actor.session_id, actor.user.identity_version,
                          filename, hashlib.sha256(data).hexdigest(), snapshot], sort_keys=True).encode()
    return hmac.new(get_settings().signing_key.encode(), message, hashlib.sha256).hexdigest()


def transfer(db, actor, data, filename, confirm=False, digest=None):
    parsed = parse(data, filename)
    def work():
        current = mrs.authorize(db, actor)
        mrs.graph_lock(db)
        rows, bodies, snapshot = review_state(db, parsed)
        fingerprint = digest_for(current, data, filename, snapshot)
        valid = not any(row["errors"] for row in rows)
        if confirm and (not valid or not hmac.compare_digest(digest or "", fingerprint)):
            raise patients.PatientError("File, session, assignments or conflicts changed. Nothing imported. Review again.", 409, "patient_review_changed")
        if confirm:
            # Acquire all owner locks in stable order before inserting any patients.
            from app.services.domain import _lock_mrs
            _lock_mrs(db, {db.get(Doctor, body.doctorId).mrId for body, _ in bodies})
            for body, code in bodies:
                patients.insert(db, current, body, code or None)
            result = dict(imported=len(bodies))
        else:
            result = dict(rows=rows, valid=valid, digest=fingerprint)
        db.commit()
        return result
    return patients.transaction(db, work)


def encode(rows, format, readable=False):
    headers = CURRENT if readable else HEADERS
    if format == "csv":
        stream = io.StringIO()
        writer = csv.writer(stream, lineterminator="\r\n")
        writer.writerow(headers)
        writer.writerows([[
            "'" + str(value) if index < len(COLUMNS) and COLUMNS[index][0] in ("phone", "pincode", "doctorRegistrationNumber")
            and re.fullmatch(r"\d+", str(value)) else safe_text(value) for index, value in enumerate(row)
        ] for row in rows])
        return ("\ufeff" + stream.getvalue()).encode()
    book = Workbook()
    sheet = book.active
    sheet.title = "Patient Master"
    sheet.append(headers)
    for row in rows:
        sheet.append([safe_text(value) for value in row])
    output = io.BytesIO()
    book.save(output)
    book.close()
    return output.getvalue()


def sample(format):
    values = {key: "" for key, _ in COLUMNS}
    values.update(name="Example Patient", gender="other", phone="9000000000", dialCountry="IN",
                  dateOfBirth="2000-01-01", doctorRegistrationNumber="REPLACE-WITH-SERVER-REGISTRATION",
                  instructionsLanguage="English", status="active", addressLine1="Example Road", landmark="Example landmark",
                  pincode="110001", city="Delhi", state="Delhi", country="India")
    return encode([[values[key] for key, _ in COLUMNS]], format)


def export(db, actor, query="", status="all", zone_id="", mr_id="", format="csv"):
    def work():
        mrs.authorize(db, actor, lock=False)
        clauses = patients.predicates(query, status, zone_id, mr_id)
        count = db.scalar(select(func.count()).select_from(Directory).where(*clauses))
        if count > EXPORT_LIMIT:
            raise patients.PatientError("More than 5,000 patients match. Narrow filters.", 409, "patient_export_limit")
        rows = list(db.scalars(select(Directory).where(*clauses).order_by(Directory.created_at.desc(), Directory.id.desc()).limit(EXPORT_LIMIT + 1)))
        if len(rows) > EXPORT_LIMIT:
            raise patients.PatientError("More than 5,000 patients match. Narrow filters.", 409, "patient_export_limit")
        context = patients.projection_context(db, rows)
        result = []
        for row in rows:
            values = patients.projection(db, row, context)
            # Registration is portable across environments; ownership UUID is excluded.
            values["doctorId"] = ""
            values["phone"] = DIAL[row.dialCountry] + row.phone
            result.append([str(values[key]) if values[key] is not None else "" for key, _ in COLUMNS + READABLE])
        db.commit()
        return encode(result, format, True)
    return patients.transaction(db, work)
