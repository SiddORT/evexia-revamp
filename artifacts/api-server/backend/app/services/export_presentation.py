"""Human file presentation only. Canonical DTOs and stored values never pass here."""
import csv
import io
import json
import re
import zipfile
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import date, datetime
from functools import wraps
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from defusedxml import ElementTree as SafeXML
from fastapi import HTTPException
from starlette.responses import JSONResponse
from xml.etree import ElementTree as XML

FORMATS = {"dd-mmm-yyyy", "mm-dd-yyyy", "dd-mm-yyyy", "yyyy-mm-dd"}
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
CALENDAR_HEADERS = {"Date of Joining", "Date of Birth", "Recorded date"}
INSTANT_HEADERS = {"Created At", "Updated At"}
MARKER = re.compile(r"^(.*?) \[EVEXIA date=(dd-mmm-yyyy|mm-dd-yyyy|dd-mm-yyyy|yyyy-mm-dd)\]$")
AUDIT_ZONE = re.compile(r"^(Created At|Updated At) \(([^()]{1,100})\)$")
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


@dataclass(frozen=True)
class Preferences:
    date_format: str
    time_zone: str
    clock: str


current_preferences = ContextVar("export_preferences", default=None)


def calendar(value, preferences):
    if value is None or value == "" or value == "None":
        return ""
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(value)):
            return "—"
        parsed = date.fromisoformat(str(value))
        y, m, d = parsed.year, parsed.month, parsed.day
        if preferences.date_format == "dd-mmm-yyyy":
            return f"{d:02} {MONTHS[m - 1]} {y:04}"
        if preferences.date_format == "mm-dd-yyyy":
            return f"{m:02}/{d:02}/{y:04}"
        if preferences.date_format == "dd-mm-yyyy":
            return f"{d:02}/{m:02}/{y:04}"
        return parsed.isoformat()
    except ValueError:
        return "—"


def instant(value, preferences):
    if value is None or value == "" or value == "None":
        return ""
    try:
        # Existing transfer producers use both datetime.isoformat() and
        # str(datetime). Both are unambiguous only with an explicit UTC offset.
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})", str(value), re.I):
            return "—"
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00").replace("z", "+00:00"))
        local = parsed.astimezone(ZoneInfo(preferences.time_zone))
        hour = local.hour if preferences.clock == "24" else local.hour % 12 or 12
        suffix = "" if preferences.clock == "24" else (" AM" if local.hour < 12 else " PM")
        return f"{calendar(local.date().isoformat(), preferences)}, {hour:02}:{local.minute:02}:{local.second:02}{suffix}"
    except (ValueError, OverflowError):
        return "—"


def normalized_import_dates(rows, invalid):
    """Strip only our explicit context and restore ISO before existing validation.

    Legacy ISO files are untouched. Audit columns remain informational/create-only.
    No inference from the importing browser's settings or ambiguous numeric cells.
    """
    if not rows:
        return rows
    for index, title in enumerate(rows[0]):
        audit = AUDIT_ZONE.fullmatch(title)
        if audit:
            try:
                ZoneInfo(audit[2])
            except (ValueError, ZoneInfoNotFoundError):
                invalid("Unsupported audit time zone.")
            rows[0][index] = audit[1]
            continue  # Audit cells are still ignored, never restored onto records.
        marker = MARKER.fullmatch(title)
        if not marker:
            continue
        base, style = marker.groups()
        if base not in CALENDAR_HEADERS:
            invalid("Unsupported date-format context.")
        rows[0][index] = base
        preferences = Preferences(style, "UTC", "24")
        for row in rows[1:]:
            if index >= len(row) or not row[index]:
                continue
            value = row[index]
            try:
                if style == "dd-mmm-yyyy":
                    match = re.fullmatch(r"(\d{2}) ([A-Z][a-z]{2}) (\d{4})", value)
                    if not match:
                        raise ValueError()
                    day, month, year = match.groups()
                    parsed = date(int(year), MONTHS.index(month) + 1, int(day))
                elif style == "yyyy-mm-dd":
                    parsed = date.fromisoformat(value)
                else:
                    match = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", value)
                    if not match:
                        raise ValueError()
                    a, b, year = map(int, match.groups())
                    parsed = date(year, a if style == "mm-dd-yyyy" else b, b if style == "mm-dd-yyyy" else a)
                if calendar(parsed.isoformat(), preferences) != value:
                    raise ValueError()
                row[index] = parsed.isoformat()
            except ValueError:
                invalid(f"Invalid {base}; use the date format declared in its header.")
    return rows


def _cell_value(node, strings):
    if node.get("t") == "inlineStr":
        return "".join(part.text or "" for part in node.iter(f"{{{NS}}}t"))
    value = node.find(f"{{{NS}}}v")
    text = value.text or "" if value is not None else ""
    return strings[int(text)] if node.get("t") == "s" else text


def _set_text(node, text):
    # Text cells intentionally prevent Excel from applying device locale/time zones.
    for child in list(node):
        node.remove(child)
    node.set("t", "inlineStr")
    content = XML.SubElement(node, f"{{{NS}}}is")
    XML.SubElement(content, f"{{{NS}}}t").text = text


def _kind(title):
    return calendar if title in CALENDAR_HEADERS else instant if title in INSTANT_HEADERS else None


def _heading(title, preferences):
    if title in CALENDAR_HEADERS:
        return f"{title} [EVEXIA date={preferences.date_format}]"
    return f"{title} ({preferences.time_zone})" if title in INSTANT_HEADERS else title


def present_bytes(data, preferences):
    if data.startswith(b"PK"):
        # Edit date cells only, not an openpyxl load/save round trip: monetary XML
        # lexemes, IDs, styles and spreadsheet-injection escaping remain intact.
        output = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(output, "w") as target:
            strings = []
            if "xl/sharedStrings.xml" in source.namelist():
                strings = ["".join(n.text or "" for n in item.iter(f"{{{NS}}}t"))
                           for item in SafeXML.fromstring(source.read("xl/sharedStrings.xml"))]
            for entry in source.infolist():
                content = source.read(entry.filename)
                if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", entry.filename):
                    root = SafeXML.fromstring(content)
                    rows = root.findall(f".//{{{NS}}}sheetData/{{{NS}}}row")
                    kinds = {}
                    if rows:
                        for node in rows[0]:
                            title = _cell_value(node, strings)
                            kind = _kind(title)
                            if kind:
                                column = re.sub(r"\d+$", "", node.get("r", ""))
                                kinds[column] = kind
                                _set_text(node, _heading(title, preferences))
                        for row in rows[1:]:
                            for node in row:
                                kind = kinds.get(re.sub(r"\d+$", "", node.get("r", "")))
                                if kind:
                                    _set_text(node, kind(_cell_value(node, strings), preferences))
                    if kinds:
                        content = XML.tostring(root, encoding="utf-8", xml_declaration=True)
                target.writestr(entry, content)
        return output.getvalue()
    rows = list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))
    if rows:
        kinds = [_kind(title) for title in rows[0]]
        rows[0] = [_heading(title, preferences) for title in rows[0]]
        for row in rows[1:]:
            for index, kind in enumerate(kinds):
                if kind and index < len(row):
                    row[index] = kind(row[index], preferences)
    output = io.StringIO()
    csv.writer(output, lineterminator="\r\n").writerows(rows)
    return output.getvalue().encode("utf-8-sig")


def present_export(function):
    """Decorate implemented file exports, never sample/import/JSON serializers."""
    @wraps(function)
    def wrapped(*args, **kwargs):
        preferences = current_preferences.get()
        data = function(*args, **kwargs)
        if preferences is None:
            return data  # Older API callers retain the canonical backup contract.
        result = present_bytes(data, preferences)
        if function.__module__.endswith("opening_stock_transfer") and len(result) > 2 * 1024 * 1024:
            raise HTTPException(422, "Transfer exceeds the 2 MiB portable limit; narrow the export.")
        return result
    return wrapped


class ExportPreferencesMiddleware:
    """Request-scoped immutable settings, copied into synchronous route workers."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        encoded = headers.get(b"x-evexia-export-display")
        preferences = None
        if encoded is not None:
            try:
                if len(encoded) > 512:
                    raise ValueError()
                value = json.loads(encoded)
                if not isinstance(value, dict) or set(value) != {"dateFormat", "timeZone", "clock"}:
                    raise ValueError()
                if value["dateFormat"] not in FORMATS or value["clock"] not in {"12", "24"}:
                    raise ValueError()
                ZoneInfo(value["timeZone"])
                preferences = Preferences(value["dateFormat"], value["timeZone"], value["clock"])
            except (ValueError, TypeError, KeyError, ZoneInfoNotFoundError):
                return await JSONResponse({"detail": "Invalid export display preferences."}, status_code=422)(scope, receive, send)
        token = current_preferences.set(preferences)
        try:
            await self.app(scope, receive, send)
        finally:
            current_preferences.reset(token)
