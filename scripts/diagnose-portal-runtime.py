"""Read-only portal diagnostics. Run inside the existing API runtime, not a candidate image.

Uses existing app settings/session driver; never prints credentials, row data,
SQL parameters or underlying exception text. No migrations or writes.
"""
import hashlib
import json
import re
import signal
import sys


class DiagnosticTimeout(BaseException):
    pass


def deadline(_signum, _frame):
    raise DiagnosticTimeout()


def failure_category(exc):
    code = getattr(getattr(exc, "orig", None), "sqlstate", None)
    if code in ("42P01", "42703"):
        return "missing_relation_or_column"
    if code == "42501":
        return "insufficient_privilege"
    if code and code.startswith("28"):
        return "database_authentication"
    if code and code.startswith("08"):
        return "database_connection"
    if code in ("57014", "55P03"):
        return "timeout_or_lock"
    return "database_or_runtime_failure"


def fingerprint(value):
    return hashlib.sha256(str(value).encode()).hexdigest()[:16]


def diagnose(hostname):
    from sqlalchemy import select, text
    from app.db.session import session_factory
    from app.db.role_url_models import RoleHostname
    from app.schemas.role_urls import canonical_hostname
    from app.core.schema import SCHEMA_REVISION

    host = canonical_hostname(hostname)
    report = {"expected_revision": SCHEMA_REVISION, "checks": {}}
    queries = {
        "identity": """
            SELECT current_database() AS database_name, current_user AS database_user,
                   current_schema() AS active_schema, current_setting('search_path') AS search_path,
                   inet_server_addr()::text AS server_address, inet_server_port() AS server_port
        """,
        "revisions": "SELECT version_num FROM alembic_version",
        "columns": """
            SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
                   a.attnotnull AS not_null
            FROM pg_attribute a WHERE a.attrelid = to_regclass('role_hostnames')
            AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum
        """,
        "constraints": """
            SELECT conname AS name, contype AS type, convalidated AS validated,
                   pg_get_constraintdef(oid) AS definition
            FROM pg_constraint WHERE conrelid = to_regclass('role_hostnames') ORDER BY conname
        """,
        "visibility": """
            SELECT to_regclass('role_hostnames') IS NOT NULL AS relation_visible,
                   has_table_privilege(current_user, to_regclass('role_hostnames'), 'SELECT') AS can_select
        """,
    }
    factory = session_factory()
    for label, query in queries.items():
        try:
            with factory() as db:
                db.execute(text("SET TRANSACTION READ ONLY"))
                db.execute(text("SET LOCAL statement_timeout = '5s'"))
                db.execute(text("SET LOCAL lock_timeout = '1s'"))
                rows = [dict(row) for row in db.execute(text(query)).mappings()]
                # Target identifiers stay private. Operators compare these fingerprints
                # to a separately obtained expected target, without sharing raw names.
                if label == "identity":
                    rows = [{key + "_fingerprint": fingerprint(value) for key, value in rows[0].items()}]
                report["checks"][label] = {"ok": True, "metadata": rows}
        except Exception as exc:
            report["checks"][label] = {"ok": False, "category": failure_category(exc)}
    try:
        with factory() as db:
            db.execute(text("SET TRANSACTION READ ONLY"))
            db.execute(text("SET LOCAL statement_timeout = '5s'"))
            db.execute(text("SET LOCAL lock_timeout = '1s'"))
            role = db.scalar(select(RoleHostname.role).where(
                RoleHostname.hostname == host, RoleHostname.enabled.is_(True)))
            # Do not print the hostname, mapping record or configured role.
            report["checks"]["dns_lookup"] = {"ok": True, "valid_role": role in (None, "admin", "mr", "doctor")}
    except Exception as exc:
        report["checks"]["dns_lookup"] = {"ok": False, "category": failure_category(exc)}
    return report


if __name__ == "__main__":
    try:
        signal.signal(signal.SIGALRM, deadline)
        signal.alarm(45)
        if len(sys.argv) != 2 or not re.fullmatch(r"[a-zA-Z0-9.-]{1,253}", sys.argv[1]):
            raise ValueError()
        result = diagnose(sys.argv[1])
        print(json.dumps(result))
        sys.exit(0 if all(item["ok"] for item in result["checks"].values()) else 1)
    except (Exception, DiagnosticTimeout) as exc:
        print(json.dumps({"ok": False, "category": failure_category(exc)}))
        sys.exit(1)
