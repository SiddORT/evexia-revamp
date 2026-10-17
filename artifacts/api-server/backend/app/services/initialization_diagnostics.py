"""Bounded operator errors; never render SQL statements, parameters or tracebacks."""
import json
import os
import re
import subprocess
from urllib.parse import quote, quote_plus, unquote, urlsplit


def _redact(message):
    # Values stay inside this process. Also cover encoded URL passwords and
    # individual keyring entries, not just the entire JSON environment value.
    values = set()
    for name, value in os.environ.items():
        if value and re.search(r"password|secret|token|credential|(?:^|_)key(?:s|_|$)|"
                               r"database_url|dsn", name, re.I):
            values.add(value)
            try:
                parsed = json.loads(value)
                if isinstance(parsed, dict):
                    values.update(item for item in parsed.values() if isinstance(item, str) and item)
            except ValueError:
                pass
            if "://" in value:
                try:
                    password = urlsplit(value).password
                    if password:
                        values.update((password, unquote(password)))
                except ValueError:
                    pass
    encoded = {part for value in values
               for part in (value, quote(value, safe=""), quote_plus(value)) if part}
    for value in sorted(encoded, key=len, reverse=True):
        message = message.replace(value, "[REDACTED]")
    message = re.sub(r"(?i)\b[a-z][a-z0-9+.-]*://[^\s<>]+", "[URL REDACTED]", message)
    # Quoted values can be SQL data, file names, credentials or identifiers.
    message = re.sub(r"""'[^']*'|"[^"]*"|`[^`]*`""", "[REDACTED]", message)
    message = re.sub(
        r"(?i)\b[\w.-]*(?:password|passwd|secret|token|credential|key|dsn|database_url)"
        r"[\w.-]*\s*[:=]\s*[^\s,;]+", "[SECRET REDACTED]", message)
    message = re.sub(r"\b[A-Za-z0-9_+/=-]{32,}\b", "[OPAQUE VALUE REDACTED]", message)
    # Do not print subsequent SQL, parameters, DETAIL/CONTEXT or terminal escapes.
    return re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", message.splitlines()[0] if message else "")[:700]


def exception_diagnostic(exception):
    """Use DBAPI primary diagnostics, not SQLAlchemy's SQL/parameter-bearing repr."""
    try:
        error = getattr(exception, "orig", None)
        if not isinstance(error, BaseException):
            error = exception
        label = re.sub(r"[^A-Za-z0-9_]", "", type(error).__name__)[:80] or "Exception"
        if isinstance(error, subprocess.CalledProcessError):
            # str(error) includes the command; stdout/stderr can contain secrets.
            return f"{label}: external command exited with status {int(error.returncode)}; arguments/output omitted"
        if callable(getattr(error, "errors", None)):
            # Pydantic str(error) includes raw input and validator context.
            fields = []
            for item in error.errors(include_input=False, include_context=False, include_url=False):
                location = item.get("loc", ())
                field = location[0] if location else "configuration"
                if isinstance(field, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", field):
                    fields.append(field)
            message = "configuration validation failed; fields: " + ", ".join(sorted(set(fields)))
        else:
            diag = getattr(error, "diag", None)
            primary = getattr(diag, "message_primary", None)
            message = primary if isinstance(primary, str) and primary else (
                error.strerror if isinstance(error, OSError) and error.strerror else str(error))
            # Structured SQL identifiers aid diagnosis without printing DETAIL,
            # offending row values, query text or arbitrary quoted input.
            for field in ("schema_name", "table_name", "column_name", "constraint_name"):
                value = getattr(diag, field, None)
                if isinstance(value, str) and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,62}", value):
                    message += f"; {field}={value}"
        # Strip SQLAlchemy suffixes even for a StatementError without orig.
        message = message.split("[SQL:", 1)[0].split("[parameters:", 1)[0]
        state = getattr(error, "sqlstate", None)
        code = f" [SQLSTATE {state}]" if isinstance(state, str) and re.fullmatch(r"[A-Z0-9]{5}", state) else ""
        return f"{label}{code}: {_redact(message) or 'message withheld'}"
    except Exception:
        # Logging failures must never expose the original exception/traceback.
        return "Exception: diagnostic unavailable; message withheld"
