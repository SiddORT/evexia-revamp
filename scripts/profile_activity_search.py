"""Reproducible synthetic plans, including the pre-optimization query as oracle."""
import argparse
import hashlib
import json
import os
import statistics
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.repositories import reporting


class Capture:
    def execute(self, query):
        self.query = query
        return self

    def mappings(self):
        return self

    def all(self):
        return []


def query(q, limit, offset, user_id=None, start=None, end=None, baseline=False):
    capture = Capture()
    reporting.events(capture, limit, offset, user_id, start, end, "" if baseline else q)
    statement = capture.query
    if baseline and q:
        statement = statement.where(reporting.event_search(q))
    return statement


def seed(conn, rows):
    conn.execute(text("""
        INSERT INTO users(id, email, username, password_hash, is_active,
                          token_version, identity_version, is_protected_system_admin)
        SELECT md5('user' || g)::uuid, 'synthetic-' || g || '@example.test',
               CASE WHEN g = 7 THEN 'Rare Actor Needle' ELSE 'synthetic-' || g END,
               'not-a-credential', true, 0, 1, false
        FROM generate_series(1, 1000) g
    """))
    conn.execute(text("""
        INSERT INTO audit_events(id, actor_id, action, outcome, reason, resource_type,
                                 resource_id, request_id, created_at)
        SELECT md5('event' || g)::uuid,
               CASE WHEN g % 20 = 0 THEN NULL
                    WHEN g % 20 = 1 THEN md5('deleted')::uuid
                    ELSE md5('user' || (g % 1000 + 1))::uuid END,
               CASE WHEN g % 100 = 0 THEN 'browser_created'
                    WHEN g % 500 = 3 THEN 'browser_exported' ELSE 'login_success' END,
               CASE WHEN g % 100 = 0 THEN 'reported' ELSE 'success' END,
               CASE WHEN g % 100 = 0 THEN 'browser_reported' END,
               CASE WHEN g % 100 = 0 THEN 'zone' ELSE 'auth' END,
               md5('resource' || g)::uuid,
               CASE WHEN g % 25000 = 0 THEN 'Rare.Request.Needle'
                    WHEN g % 1000 = 5 THEN 'unsafe marker!'
                    ELSE 'Request.' || g END,
               timestamp with time zone '2030-01-01' + (g / 2) * interval '1 second'
        FROM generate_series(1, :rows) g
    """), {"rows": rows})
    conn.execute(text("ANALYZE users"))
    conn.execute(text("ANALYZE audit_events"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=500000)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    url = make_url(os.environ["DATABASE_URL"])
    assert os.environ["APP_ENV"] == "test"
    assert url.database == "evexia_reporting_test"
    assert url.query["host"].startswith("/tmp/evexia-report-profile.")
    engine = create_engine(url)
    start = datetime(2030, 1, 1, tzinfo=timezone.utc)
    cases = [
        ("rare_request", "Rare.Request.Needle", 50, 0, None, None, None),
        ("actor", "Rare Actor Needle", 50, 0, None, None, None),
        ("friendly_action", "Export generated", 50, 0, None, None, None),
        ("friendly_resource", "Zone Master", 50, 0, None, None, None),
        ("missing_actors", "Unknown/System", 50, 0, None, None, None),
        ("provenance", "Server-recorded", 50, 0, None, None, None),
        ("no_match", "Absent literal needle", 50, 0, None, None, None),
        ("literal_percent", "%", 50, 0, None, None, None),
        ("short", "a", 50, 0, None, None, None),
        ("deep_page", "success", 50, 10000, None, None, None),
        ("filtered", "success", 50, 0, UUID(hashlib.md5(b"user7").hexdigest()),
         start + timedelta(seconds=1000), start + timedelta(seconds=100000)),
        ("export", "Rare.Request.Needle", 5000, 0, None, None, None),
        ("export_ceiling", "success", 5000, 0, None, None, None),
    ]
    result = {"rows": args.rows, "cases": {}}
    began = time.perf_counter()
    with engine.begin() as conn:
        seed(conn, args.rows)
        result["indexes"] = [
            dict(row) for row in conn.execute(text("""
                SELECT indexrelname AS name, pg_relation_size(indexrelid) AS bytes
                FROM pg_stat_user_indexes WHERE relname = 'audit_events'
                ORDER BY indexrelname
            """)).mappings()
        ]
    result["seed_and_analyze_seconds"] = time.perf_counter() - began
    with engine.connect() as conn:
        result["postgresql"] = conn.scalar(text("SELECT version()"))
        for name, *selection in cases:
            result["cases"][name] = {}
            ids = []
            for baseline in (True, False):
                statement = query(*selection, baseline=baseline)
                sql = str(statement.compile(engine, compile_kwargs={"literal_binds": True}))
                plans = [conn.execute(text("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql)).scalar()[0]
                         for _ in range(3)]
                timings = [p["Execution Time"] for p in plans]
                mode = "baseline" if baseline else "optimized"
                result["cases"][name][mode] = {
                    "median_ms": statistics.median(timings), "runs_ms": timings,
                    "plan": plans[-1], "sql": sql,
                }
                ids.append([r["id"] for r in conn.execute(statement).mappings()])
            assert ids[0] == ids[1], f"Search/order mismatch: {name}"
            values = result["cases"][name]
            print(f"{name}: baseline={values['baseline']['median_ms']:.1f}ms "
                  f"optimized={values['optimized']['median_ms']:.1f}ms", flush=True)
    Path(args.output).write_text(json.dumps(result, indent=2))
    engine.dispose()


if __name__ == "__main__":
    main()
