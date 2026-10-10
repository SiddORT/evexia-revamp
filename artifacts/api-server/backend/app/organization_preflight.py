"""Approved read-only operator preflight; never migrates a database."""
import argparse
import json

from sqlalchemy import create_engine, text

from app.core.config import get_settings
from app.services.organization_retirement import connection_url, preflight, save_backup


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--backup", help="Separately approved private external recovery file (never repository storage).")
    args = parser.parse_args()
    if not 1 <= args.limit <= 100 or args.offset < 0:
        parser.error("limit must be 1–100 and offset nonnegative")
    try:
        with create_engine(connection_url(get_settings().database_url), hide_parameters=True).connect() as db, db.begin():
            db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
            db.execute(text("SET LOCAL statement_timeout='30s'"))
            report = preflight(db, args.limit, args.offset)
            if args.backup:
                if report["unexpected_dependency_count"]:
                    raise RuntimeError("Unknown dependencies block recovery approval.")
                report["backup_sha256"] = save_backup(db, args.backup)
                report["restoration_verified"] = False
        print(json.dumps(report, default=str))
        return 1 if report["unexpected_dependency_count"] else 0
    except Exception:
        # SQL/driver exceptions can include URLs, SQL parameters or source data.
        print(json.dumps({"status": "blocked", "error": "Preflight unavailable; configured data/recovery is unverified. Check approved operator access, schema and restricted recovery path."}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
