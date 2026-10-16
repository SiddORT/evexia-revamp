"""Read-only, private full fresh-predecessor recovery evidence. No approval output.

CHECK deparsing differences are reported for human review, never converted into
authorization or used to relax the install/retirement catalog checks.
"""
import argparse
import hashlib
import json
import os
import stat
import sys

from sqlalchemy import create_engine, inspect, text

from app import fresh_install as fresh
from app.core.config import get_settings
from app.services.fresh_catalog import projection
from app.services.organization_retirement import connection_url, restricted_path


def snapshot(db):
    fresh.dedicated_database(db)
    if list(db.scalars(text("SELECT version_num FROM alembic_version"))) != [fresh.PREPARE_TARGET]:
        raise ValueError()
    tables = sorted(inspect(db).get_table_names(schema="public"))
    quote = db.dialect.identifier_preparer.quote
    rows = {}
    for table in tables:
        # Evidence is fresh-only and bounded, never an arbitrary populated export.
        if table not in {"alembic_version", "directory_crypto_stage"}:
            if db.scalar(text(f"SELECT EXISTS(SELECT 1 FROM public.{quote(table)})")):
                raise ValueError()
        rows[table] = sorted(json.dumps(dict(row), sort_keys=True, default=str)
            for row in db.execute(text(f"SELECT * FROM public.{quote(table)} LIMIT 10")).mappings())
        if len(rows[table]) >= 10:
            raise ValueError()
    return {"catalog": projection(db), "rows": rows}


def compare(original, restored):
    if original["rows"] != restored["rows"]:
        raise ValueError()
    before, after = original["catalog"], restored["catalog"]
    for category in before:
        if category != "constraints" and before[category] != after[category]:
            raise ValueError()
    # Keep ALL differing definitions in the private report. A data match is
    # deliberately NOT a claim of exact CHECK catalog equivalence.
    a, b = before["constraints"], after["constraints"]
    if ([(r[0], r[1], r[3]) for r in a] != [(r[0], r[1], r[3]) for r in b]
            or [r for r in a if not r[2].startswith("CHECK")] !=
               [r for r in b if not r[2].startswith("CHECK")]):
        raise ValueError()
    return {"source_checks": [r for r in a if r not in b],
            "restored_checks": [r for r in b if r not in a]}


def write_private(path, content):
    target = restricted_path(path)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    directory = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("export", "verify"))
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--sha256")
    parser.add_argument("--catalog-report")
    parser.add_argument("--expected-database", required=True)
    parser.add_argument("--expected-system-identifier", required=True, type=int)
    parser.add_argument("--approve-release", required=True)
    args = parser.parse_args()
    try:
        fresh.verify_supervisor()
        fresh.reviewed_graph()
        fresh.approve_release(args.approve_release)
        settings = get_settings()
        fresh.configuration(settings)
        engine = create_engine(connection_url(settings.database_url), hide_parameters=True)
        try:
            with engine.connect() as db:
                db.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
                fresh.verify_database_target(db, args.expected_database, args.expected_system_identifier)
                observed = snapshot(db)
        finally:
            engine.dispose()
        if args.mode == "export":
            if args.sha256 or args.catalog_report:
                raise ValueError()
            payload = dict(observed, source_cluster=args.expected_system_identifier,
                           source_database=args.expected_database, format=1)
            content = json.dumps(payload, sort_keys=True).encode()
            write_private(args.evidence, content)
            print("FULL_RECOVERY_EVIDENCE_SHA256=" + hashlib.sha256(content).hexdigest())
        else:
            path = restricted_path(args.evidence)
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, "rb") as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                    raise ValueError()
                content = stream.read(8 * 1024 * 1024 + 1)
            if len(content) > 8 * 1024 * 1024 or hashlib.sha256(content).hexdigest() != args.sha256:
                raise ValueError()
            original = json.loads(content)
            if (original["format"] != 1 or original["source_cluster"] == args.expected_system_identifier
                    or original["source_database"] != args.expected_database):
                raise ValueError()
            report = compare(original, observed)
            write_private(args.catalog_report, json.dumps(report, sort_keys=True).encode())
            print("FULL_RECOVERY_DATA_MATCHES: non-CHECK catalog matches; review private CHECK report. "
                  "No restoration attestation or execution approval inferred.")
        return 0
    except Exception:
        print("FULL_RECOVERY_CHECK_BLOCKED: retain maintenance and private evidence; no approval inferred.",
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
