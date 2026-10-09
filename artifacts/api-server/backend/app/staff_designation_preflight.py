"""Operator-only read-only preflight; never run against managed data without approval."""
import argparse
import json

from sqlalchemy import create_engine, text

from app.core.config import get_settings
from app.services.staff_designation_mapping import MappingError, load_overrides, reconcile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mapping-file")
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--candidate-offset", type=int, default=0)
    args = parser.parse_args()
    if args.offset < 0 or args.candidate_offset < 0 or not 1 <= args.limit <= 100:
        parser.error("offsets must be non-negative and limit 1–100")
    try:
        overrides = load_overrides(args.mapping_file)
        with create_engine(get_settings().database_url).connect() as db, db.begin():
            db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
            resolved, unresolved = reconcile(db, overrides)
        page = []
        for group in unresolved[args.offset:args.offset + args.limit]:
            candidates = group["candidates"]
            page.append({**group, "candidate_count": len(candidates),
                         "candidates": candidates[args.candidate_offset:args.candidate_offset + 100],
                         "has_more_candidates": args.candidate_offset + 100 < len(candidates)})
        print(json.dumps(dict(resolved_values=len(resolved), unresolved_values=len(unresolved),
                              affected=sum(row["affected"] for row in unresolved),
                              items=page,
                              has_more=args.offset + args.limit < len(unresolved)), ensure_ascii=True))
        return 1 if unresolved else 0
    except MappingError as error:
        print(json.dumps({"error": str(error)}))
        return 2
    except Exception:
        # Do not print driver exceptions, connection strings or mapping contents.
        print(json.dumps({"error": "Preflight unavailable. Check historical schema and operator configuration."}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
