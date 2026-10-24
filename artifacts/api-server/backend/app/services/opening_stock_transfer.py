"""Bounded inert transfers with durable source/row identity, never name deduplication."""
import csv
from app.services.export_presentation import present_export, normalized_import_dates
import io
import uuid
from datetime import date
from decimal import Decimal
from pydantic import ValidationError
from sqlalchemy import select
from app.core.security import utcnow
from app.schemas.opening_stock import OpeningRow, OpeningInput
from app.db.location_models import StorageLocation
from app.services import inventory as inv, opening_stock as service
from app.services.allergen_transfer import exact_workbook_rows, unsafed
from app.services.product_category_transfer import encode
from app.services.zone_transfer import safe_text
from app.services.zones import ZoneError
from app.services.allergens import AllergenError
from app.services.purchase_received_crypto import PRError

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 1000
HEADERS = ["Source ID", "Row ID", "Item type", "Item ID", "Item name", "Unit", "Quantity",
           "Unit rate", "Storage location ID", "Storage location name", "Recorded date", "Location guidance"]
GUIDANCE = ("Blank location = Unallocated. Use a current active Storage Location UUID (see the import page location guide), "
            "or an exact unique active name. Never use catalogue location hints. Keep quantity/rate cells as text.")


def invalid(message):
    raise PRError(message, 422, "opening_invalid_file")


def parse(data, filename):
    if not data or len(data) > MAX_BYTES:
        raise PRError("Use a non-empty file no larger than 2 MiB.", 413, "opening_file_limit")
    if filename.lower().endswith(".csv"):
        rows = []
        try:
            for row in csv.reader(io.StringIO(data.decode("utf-8-sig")), strict=True):
                if len(rows) > MAX_ROWS or len(row) > len(HEADERS) or any(len(v) > 10000 for v in row):
                    invalid("CSV exceeds 1000 catalogue rows, 12 columns or 10000 characters per cell.")
                rows.append(row)
        except (UnicodeError, csv.Error):
            invalid("Use well-formed UTF-8 CSV.")
    elif filename.lower().endswith(".xlsx"):
        try:
            rows = exact_workbook_rows(data, max_columns=len(HEADERS), numeric_columns={"G": 6, "H": 7})
        except (ZoneError, AllergenError) as exc:
            invalid(exc.message)
    else:
        invalid("Only UTF-8 CSV and genuine inert XLSX files are supported.")
    rows = normalized_import_dates(rows, invalid)
    if not rows or rows[0] != HEADERS or len(rows) < 2:
        invalid("Use the unchanged 12-column Opening Stock sample or exported backup headers.")
    return rows[1:]


def review(db, actor, data, filename):
    cells = parse(data, filename)
    def work(_, crypto):
        locations = inv.bounded(db, select(StorageLocation).where(
            StorageLocation.deleted_at.is_(None), StorageLocation.status == "active").order_by(StorageLocation.id))
        output, commands, reviewed, seen, new_dates = [], [], [], set(), set()
        for number, raw in enumerate(cells, 2):
            errors, row, state, values = [], None, "ready", None
            if len(raw) != len(HEADERS):
                output.append(dict(row=number, values=None, errors=["Row must contain exactly 12 cells."], state="ready"))
                continue
            source, rid, kind, iid, name, unit, qty, rate, lid, lname, recorded, _ = [unsafed(v.strip()) for v in raw]
            # Untouched catalogue rows and genuinely empty rows are not inputs.
            if not any((qty, rate, lid, lname, recorded)):
                output.append(dict(row=number, values=None, errors=[], state="skipped"))
                continue
            try:
                if not qty:
                    raise ValueError("Quantity is required on a partially filled row.")
                amount = Decimal(qty)
                if not rate and amount != 0:
                    raise ValueError("Unit rate is required on positive quantities; zero is an explicit rate.")
                if lname:
                    matches = [r for r in locations if r.name.casefold() == lname.casefold()]
                    if not lid:
                        if len(matches) != 1:
                            raise ValueError("Location name must resolve to exactly one active location; use its UUID to disambiguate.")
                        lid = str(matches[0].id)
                row = OpeningRow(sourceId=source, rowId=rid, itemKind=kind, itemId=iid,
                    quantity=qty, unitRate=rate or "0", locationId=lid or None)
                key = (row.sourceId, row.rowId)
                if key in seen:
                    raise ValueError("Repeated source/row identity within this file.")
                seen.add(key)
                when = date.fromisoformat(recorded) if recorded else utcnow().date()
                candidate = service.review_row(db, crypto, row, when)
                if lname and lname.casefold() != candidate["location"]["name"].casefold():
                    raise ValueError("Location ID/name do not match the reviewed location snapshot.")
                # Readable names/units are guidance, but mismatched catalogue
                # labels must not lead the operator to confirm the wrong UUID.
                if name and name != candidate["productName"]:
                    raise ValueError("Item name changed or does not match its stable ID. Download a current sample.")
                if unit and unit != candidate["unit"]:
                    raise ValueError("Item unit does not match the established item contract.")
                state = candidate["state"]
                if state == "ready":
                    new_dates.add(when)
                reviewed.append(candidate)
                commands.append(row)
                values = row.model_dump(mode="json")
            except ValidationError as exc:
                labels = {"quantity": "Quantity: use exact 0–1000000 (up to 3 decimals for allergens, whole products).",
                          "unitRate": "Unit rate: nonnegative decimal string, up to 6 source decimals, rounded half-up to 2, maximum 999999999999.99."}
                for err in exc.errors():
                    field = str(err["loc"][0]) if err["loc"] else "row"
                    errors.append("Quantity: finished products require whole quantities." if not err["loc"] else
                        labels.get(field, f"{field}: invalid or missing value; stable UUIDs and item type are required."))
            except (ValueError, ArithmeticError) as exc:
                errors.append(str(exc) if isinstance(exc, ValueError) else "Quantity must be a plain exact decimal.")
            except PRError as exc:
                errors.append(exc.message)
            output.append(dict(row=number, values=values, errors=errors, state=state))
        if len(new_dates) > 1:
            for row in output:
                if row["state"] == "ready" and not row["errors"]:
                    row["errors"].append("Use one recorded date per new reviewed import operation, or leave dates blank for today.")
        invalid_count = sum(bool(r["errors"]) for r in output)
        command, token = None, None
        if not invalid_count and commands:
            body = OpeningInput(rows=commands, recordedDate=next(iter(new_dates), utcnow().date()), mode="import")
            review_result = service.review_data(db, crypto, body)
            command, token = body.model_dump(mode="json"), review_result["reviewToken"]
        return dict(rows=output, valid=not invalid_count, invalidCount=invalid_count,
            validCount=sum(r["state"] == "ready" and not r["errors"] for r in output),
            skippedCount=sum(r["state"] == "skipped" for r in output),
            alreadyImportedCount=sum(r["state"] == "already_imported" and not r["errors"] for r in output),
            reviewToken=token, command=command,
            summary=service.summary([{**r, "mode": "import"} for r in reviewed if r["state"] == "ready"]))
    return inv.transaction(db, actor, work, capability=("opening_stock", "import"))


def encoded(rows, format):
    # ALL cells are text in XLSX. CSV escaping is reversible and prevents formula
    # execution; quantities/rates are plain exact nonnegative decimal strings.
    data = encode([[safe_text(v) for v in row] for row in rows], format, sheet_title="Opening Stock")
    if len(data) > MAX_BYTES:
        raise PRError("Transfer exceeds the 2 MiB portable limit; narrow the export. No partial file returned.", 422, "opening_export_limit")
    return data


def sample(db, actor, format):
    def work(_, crypto):
        catalogue = service.catalogue(db, crypto)
        if len(catalogue) > MAX_ROWS:
            raise PRError("Eligible catalogue exceeds the 1000-row sample limit. No partial catalogue returned.", 422, "opening_sample_limit")
        source = str(uuid.uuid4())
        return encoded([HEADERS] + [[source, str(uuid.uuid4()), r["itemKind"], r["id"], r["name"], r["unit"],
            "", "", "", "", "", GUIDANCE] for r in catalogue], format)
    return inv.transaction(db, actor, work, capability=("opening_stock", "import"))


@present_export
def export(db, actor, query, format):
    def work(_, crypto):
        rows, _ = service.matching(db, crypto, query)
        if len(rows) > MAX_ROWS:
            raise PRError("More than 1000 matching openings; narrow the search. No partial export returned.", 422, "opening_export_limit")
        return encoded([HEADERS] + [[r["sourceId"], r["rowId"], r["itemKind"], r["itemId"], r["productName"],
            r["unit"], r["quantity"], r["unitRate"], r["locationId"] or "",
            r["location"]["name"] if r["locationId"] else "", r["recordedDate"], GUIDANCE] for r in rows], format)
    return inv.transaction(db, actor, work, capability=("opening_stock", "export"))
