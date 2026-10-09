"""Operator-approved read-only inventory. Never changes roles, users or audits."""
import argparse
import json

from sqlalchemy import create_engine, text

from app.core.config import get_settings
from app.services.role_attribution import AttributionError, coverage, load_mapping, reconcile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mapping-file")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--assignment-offset", type=int, default=0)
    args = parser.parse_args()
    if args.offset < 0 or args.assignment_offset < 0 or not 1 <= args.limit <= 100:
        parser.error("offsets must be nonnegative and limit 1–100")
    try:
        mapping = load_mapping(args.mapping_file)
        url = get_settings().database_url
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        with create_engine(url).connect() as db, db.begin():
            db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
            report = reconcile(db, mapping)
        items = []
        for role in report[args.offset:args.offset + args.limit]:
            items.append({**role, "assignments": role["assignments"][args.assignment_offset:args.assignment_offset + 100],
                          "has_more_assignments": args.assignment_offset + 100 < role["assignment_count"]})
        totals = coverage(report)
        print(json.dumps(dict(coverage=totals, items=items, has_more=args.offset + args.limit < len(report))))
        return 1 if totals["unresolved_fields"] else 0
    except AttributionError as error:
        print(json.dumps({"error": str(error)}))
        return 2
    except Exception:
        print(json.dumps({"error": "Preflight unavailable; existing-data coverage is unverified. Check historical schema and approved operator configuration."}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
