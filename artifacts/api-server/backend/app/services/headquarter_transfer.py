"""Bounded, inert, create-only transfer; reviewed bytes are never persisted."""
import csv
from app.services.export_presentation import present_export, normalized_import_dates
import hashlib
import hmac
import io
import uuid
import zipfile
from types import SimpleNamespace
from functools import wraps
from openpyxl import Workbook
from pydantic import ValidationError
from sqlalchemy import select
from app.core.config import get_settings
from app.db.headquarter_models import Headquarter, normalized_name
from app.db.zone_models import Zone
from app.schemas.headquarters import HeadquarterFields, HeadquarterAreaInput, abbreviation
from app.services import headquarters
from app.services.zone_transfer import workbook_rows, safe_text, UNSAFE
from app.services.zones import ZoneError

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 1000
EXPORT_LIMIT = 5000
EXPORT_ROW_LIMIT = 10000
EXPORT_BYTES = 8 * 1024 * 1024
LEGACY_HEADERS = ["HQ Name", "State Code", "Status", "Created By", "Created At", "Updated By", "Updated At"]
BASIC_HEADERS = ["HQ Name", "State Code", "Status", "Zone ID", "Zone Name", "Area Name", "Area Code"]
HEADERS = BASIC_HEADERS + LEGACY_HEADERS[3:]


def invalid(message):
    raise headquarters.HeadquarterError(message, 422, "headquarter_invalid_file")


def parse(data, filename):
    if not data or len(data) > MAX_BYTES:
        raise headquarters.HeadquarterError("Use a non-empty file no larger than 2 MiB.", 413, "headquarter_file_limit")
    if filename.lower().endswith(".csv"):
        try:
            rows = []
            for row in csv.reader(io.StringIO(data.decode("utf-8-sig")), strict=True):
                if len(rows) >= MAX_ROWS + 1 or len(row) > len(HEADERS) or any(len(cell) > 10000 for cell in row):
                    invalid("CSV exceeds 1,000 data rows, eleven columns or 10,000 characters per cell.")
                rows.append(row)
        except (UnicodeError, csv.Error):
            invalid("Use valid UTF-8 CSV with well-formed quoted cells.")
    elif filename.lower().endswith(".xlsx"):
        try:
            rows = workbook_rows(data, max_columns=len(HEADERS))
        except ZoneError as exc:
            invalid(exc.message)
    else:
        invalid("Only UTF-8 .csv and genuine .xlsx are supported.")
    rows = normalized_import_dates(rows, invalid)
    if not rows or rows[0] not in (LEGACY_HEADERS[:3], LEGACY_HEADERS, BASIC_HEADERS, HEADERS):
        invalid("Use the exact current sample/export headers or the legacy three/seven-column headers.")
    width = len(rows[0])
    legacy = rows[0] in (LEGACY_HEADERS[:3], LEGACY_HEADERS)
    escaped = rows[0] in (LEGACY_HEADERS, HEADERS)
    reviewed = []
    for number, cells in enumerate(rows[1:], 2):
        errors = [] if len(cells) == width else ["Row must match the header column count."]
        values = [cells[index].strip() if len(cells) > index else "" for index in range(3 if legacy else 7)]
        if escaped:
            for index in ((0, 1) if legacy else (0, 1, 4, 5, 6)):
                value = values[index]
                if value.startswith("'") and (value[1:].startswith("'") or UNSAFE.match(value[1:])):
                    values[index] = value[1:]
        name, code, status = values[:3]
        status = status.lower()
        try:
            fields = HeadquarterFields(name=name, status=status, **({"state_code": code} if code else {}))
            name, code = fields.name, fields.state_code or abbreviation(fields.name)
        except ValidationError as exc:
            errors.extend(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors(include_input=False))
        zone_id, zone_name = ("", "") if legacy else values[3:5]
        if not legacy:
            try:
                zone_id = str(uuid.UUID(zone_id))
            except ValueError:
                errors.append("Zone ID: supply a saved active Zone UUID from this import page's Zone references or an export. Empty/unavailable historical links cannot be newly assigned.")
        area = None
        if not legacy:
            area_name, area_code = values[5:7]
            if area_name or area_code:
                area = dict(row=number, name=area_name, code=area_code, generated=not bool(area_code))
                try:
                    body = HeadquarterAreaInput(name=area_name, **({"code": area_code} if area_code else {}))
                    area.update(name=body.name, code=body.code or "")
                except ValidationError as exc:
                    errors.extend(f"Area {'.'.join(map(str, e['loc']))}: {e['msg']}"
                                  for e in exc.errors(include_input=False))
        reviewed.append(dict(row=number, name=name, state_code=code, status=status,
                             zone_id=zone_id, zone_name=zone_name, legacy=legacy, area=area, errors=errors))
    if not reviewed:
        invalid("At least one record is required.")
    return reviewed


def group_rows(db, parsed):
    """Group using the same database name comparison as live uniqueness."""
    # Invalid control characters are already review errors. PostgreSQL text
    # cannot carry NUL even for a read-only comparison of rejected input.
    keys = headquarters.comparison_keys(db, [row["name"].replace("\0", "\ufffd") for row in parsed])
    groups = {}
    for row, key in zip(parsed, keys):
        group = groups.get(key)
        if group is None:
            group = dict(row=row["row"], source_rows=[], name=row["name"], state_code=row["state_code"],
                         status=row["status"], zone_id=row["zone_id"], zone_name=row["zone_name"],
                         legacy=row["legacy"], areas=[], errors=[], blank_rows=0)
            groups[key] = group
        elif row["legacy"]:
            group["errors"].append(f"Row {row['row']}: duplicate name within this legacy file.")
        elif any(group[field] != row[field] for field in ("name", "state_code", "status", "zone_id", "zone_name")):
            group["errors"].append(f"Row {row['row']}: repeated HQ fields and Zone fields must match.")
        group["source_rows"].append(row["row"])
        group["errors"].extend(f"Row {row['row']}: {message}" for message in row["errors"])
        if row["area"] is None:
            group["blank_rows"] += 1
        else:
            group["areas"].append(row["area"])
    for group in groups.values():
        if not group["legacy"] and group["blank_rows"] and len(group["source_rows"]) != 1:
            group["errors"].append("An empty area list requires exactly one blank-area row; do not mix blank and populated area rows.")
        if len(group["areas"]) > 200:
            group["errors"].append("At most 200 areas are allowed per headquarter, including non-adjacent repeated HQ rows.")
    return groups


def area_inputs(group):
    return [HeadquarterAreaInput(name=area["name"], **({} if area["generated"] else {"code": area["code"]}))
            for area in group["areas"]]


def review_digest(actor, data, filename):
    message = "\0".join(("headquarter", str(actor.user.id), actor.session_id, filename,
                         hashlib.sha256(data).hexdigest())).encode()
    return hmac.new(get_settings().signing_key.encode(), message, hashlib.sha256).hexdigest()


def transfer(db, actor, data, filename, confirm=False, digest=None):
    parsed = parse(data, filename)
    def work():
        current = headquarters.authorize(db, actor, "import")
        fingerprint = review_digest(current, data, filename)
        if confirm and not hmac.compare_digest(digest or "", fingerprint):
            raise headquarters.HeadquarterError("File or session changed. Review again before confirming.", 409, "headquarter_review_changed")
        groups = group_rows(db, parsed)
        rows = list(groups.values())
        existing = set(db.scalars(select(normalized_name(Headquarter.name)).where(
            Headquarter.deleted_at.is_(None), normalized_name(Headquarter.name).in_(list(groups)))))
        # Lock selected zones in UUID order for the whole review/commit. This is
        # the same HQ-authorized catalogue as the picker, never Zone admin access.
        zone_ids = sorted({uuid.UUID(row["zone_id"]) for row in rows
                           if row["zone_id"] and not any("Zone ID:" in e for e in row["errors"])})
        zones = {str(zone.id): zone for zone in db.scalars(
            select(Zone).where(Zone.id.in_(zone_ids)).order_by(Zone.id)
            .execution_options(populate_existing=True).with_for_update())}
        for key, row in groups.items():
            if key in existing:
                row["errors"].append("A non-deleted headquarter already uses this name.")
            if not row["legacy"]:
                zone = zones.get(row["zone_id"])
                if zone is None or zone.deleted_at is not None or zone.status != "active":
                    row["errors"].append("Zone is missing, inactive or deleted. Copy a saved active Zone ID from this import page's Zone references; update all rows for this HQ and review again.")
                else:
                    # UUID is authoritative; review shows the current saved name.
                    row["zone_name"] = zone.name
            if not row["errors"]:
                try:
                    plan, _ = headquarters.plan_areas(db, SimpleNamespace(
                        state_code=row["state_code"], next_area_sequence=1), area_inputs(row))
                    for area, (_, _, code, _, _) in zip(row["areas"], plan):
                        area["code"] = code
                except headquarters.HeadquarterError as exc:
                    row["errors"].append(exc.message)
        valid = not any(row["errors"] for row in rows)
        if confirm:
            if not valid:
                raise headquarters.HeadquarterError("Invalid rows or new conflicts. Nothing was imported. Review again.", 409, "headquarter_import_conflict")
            for row in rows:
                parent = headquarters.insert(db, current, HeadquarterFields(name=row["name"], state_code=row["state_code"], status=row["status"]))
                if not row["legacy"]:
                    headquarters.assign_zone(db, parent, uuid.UUID(row["zone_id"]))
                    headquarters.save_areas(db, current, parent, area_inputs(row))
                    parent.updated_at = parent.created_at
            db.flush()
            db.commit()
            return {"imported": len(rows), "imported_areas": sum(len(row["areas"]) for row in rows)}
        db.commit()
        return dict(rows=rows, valid=valid, digest=fingerprint, area_count=sum(len(row["areas"]) for row in rows))
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
    zone = "REPLACE_WITH_SAVED_ZONE_UUID"
    return encode([BASIC_HEADERS,
                   ["North Mumbai", "NM", "active", zone, "Your saved active Zone", "Central", "NM1"],
                   ["North Mumbai", "NM", "active", zone, "Your saved active Zone", "West", ""],
                   ["South Mumbai", "SM", "active", zone, "Your saved active Zone", "", ""]], format)


def bounded_export(function):
    """Enforce file/workbook bounds after date presentation as well."""
    @wraps(function)
    def wrapped(*args, **kwargs):
        result = function(*args, **kwargs)
        if len(result) > EXPORT_BYTES:
            raise headquarters.HeadquarterError("Export exceeds 8 MiB. Narrow HQ filters; nothing was truncated.",
                                               422, "headquarter_export_limit")
        if result.startswith(b"PK"):
            with zipfile.ZipFile(io.BytesIO(result)) as archive:
                if sum(item.file_size for item in archive.infolist()) > EXPORT_BYTES or any(
                        item.file_size > 4 * 1024 * 1024 for item in archive.infolist()):
                    raise headquarters.HeadquarterError("Excel export exceeds safe workbook size limits. Narrow HQ filters.",
                                                       422, "headquarter_export_limit")
        return result
    return wrapped


@bounded_export
@present_export
def export(db, actor, query, status, format):
    def work():
        headquarters.authorize(db, actor, "export")
        records = list(db.scalars(select(Headquarter).where(*headquarters.predicates(query, status))
                                  .order_by(Headquarter.created_at.desc(), Headquarter.id.desc())
                                  .limit(EXPORT_LIMIT + 1).with_for_update(read=True)))
        if len(records) > EXPORT_LIMIT:
            raise headquarters.HeadquarterError("Export exceeds 5,000 matching records. Narrow name/code/status filters.", 422, "headquarter_export_limit")
        rows = [HEADERS]
        for row in records:
            record = headquarters.projection(db, row)
            if len(rows) + max(1, len(record["areas"])) > EXPORT_ROW_LIMIT + 1:
                raise headquarters.HeadquarterError("Export exceeds 10,000 expanded area rows. Narrow HQ name/code/status filters; no HQ is truncated.",
                                                   422, "headquarter_export_limit")
            zone = record["zone"]
            zone_name = ("No zone assigned" if not zone else zone["name"] +
                         (" (deleted)" if zone["deleted"] else " (inactive)" if zone["status"] != "active" else ""))
            for area in record["areas"] or [None]:
                rows.append([safe_text(row.name), safe_text(row.state_code), row.status,
                             str(row.zone_id) if row.zone_id else "", safe_text(zone_name),
                             safe_text(area["name"]) if area else "", safe_text(area["code"]) if area else "",
                             safe_text(record["createdBy"]), row.created_at.isoformat(),
                             safe_text(record["updatedBy"]), row.updated_at.isoformat()])
        db.commit()
        return rows
    return encode(headquarters.transaction(db, work), format)
