"""Synthetic download plans, timings and full-result comparison to the original query."""
import argparse
import hashlib
import json
import os
import statistics
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

from sqlalchemy import case, create_engine, func, literal, or_, select, text
from sqlalchemy.engine import make_url

from app.db.download_models import DownloadLog as D
from app.db.models import User
from app.repositories import downloads
from app.repositories.reporting import user_columns
from app.services.downloads import BROWSER, MODULES, SERVER, label


class Capture:
    def execute(self, query):
        self.query = query
        return self

    def mappings(self):
        return self

    def all(self):
        return [{"total": 0, "id": None}]


def baseline(limit, offset, user_id, start, end, q, format):
    """Pre-optimization wide, multiply referenced CTE; retained as correctness oracle."""
    labels = {f"{s}/{k}": label(s, k) for catalog in (BROWSER, SERVER)
              for s, kinds in catalog.items() for k in kinds}
    report_label = case(labels, value=D.source + literal("/") + D.kind, else_="Download")
    module = case(MODULES, value=D.source, else_="System")
    query = select(D.id, D.created_at, D.format, D.provenance,
                   report_label.label("download_label"), module.label("module"),
                   *user_columns()).select_from(D).outerjoin(User, User.id == D.actor_id)
    for value, predicate in ((user_id, D.actor_id == user_id), (start, D.created_at >= start if start else literal(True)),
                             (end, D.created_at < end if end else literal(True)), (format, D.format == format)):
        if value:
            query = query.where(predicate)
    if q:
        query = query.where(or_(*(field.icontains(q, autoescape=True) for field in (
            report_label, module, D.format, func.coalesce(User.username, User.email),
            case({"server_prepared": "Server-prepared", "browser_reported": "Browser-reported"},
                 value=D.provenance)))))
    filtered = query.cte("filtered_downloads")
    count = select(func.count()).select_from(filtered).scalar_subquery()
    page = select(filtered).order_by(filtered.c.created_at.desc(), filtered.c.id.desc()).limit(limit).offset(offset).subquery()
    return select(count.label("total"), page).select_from(select(literal(1)).subquery()).outerjoin(
        page, literal(True)).order_by(page.c.created_at.desc(), page.c.id.desc())


def statement(selection, original=False):
    if original:
        return baseline(*selection)
    capture = Capture()
    downloads.listing(capture, *selection)
    return capture.query


def seed(conn, rows):
    conn.execute(text("""
        INSERT INTO users(id, email, username, password_hash, is_active,
                          token_version, identity_version, is_protected_system_admin)
        SELECT md5('user' || g)::uuid, 'synthetic-' || g || '@example.test',
               CASE WHEN g = 7 THEN 'Rare Actor Needle'
                    WHEN g = 8 THEN 'Literal %_ actor'
                    WHEN g % 10 = 0 THEN NULL ELSE 'synthetic-' || g END,
               'not-a-credential', true, 0, 1, false
        FROM generate_series(1, 1000) g
    """))
    conn.execute(text("""
        INSERT INTO auth_sessions(id, user_id, family_id, status, token_version,
                                  identity_version, created_at, expires_at, persistent)
        SELECT 'synthetic-session-' || g, md5('user' || g)::uuid, md5('family' || g)::uuid,
               'EXPIRED', 0, 1, '2029-01-01', '2029-01-02', false
        FROM generate_series(1, 1000) g
    """))
    combinations = [(s, k, f, p) for catalog, p in ((BROWSER, "browser_reported"), (SERVER, "server_prepared"))
                    for s, kinds in catalog.items() for k, formats in kinds.items() for f in sorted(formats)]
    conn.execute(text("CREATE TEMP TABLE combinations(n int, source text, kind text, format text, provenance text)"))
    conn.execute(text("INSERT INTO combinations VALUES (:n, :s, :k, :f, :p)"),
                 [dict(n=n, s=s, k=k, f=f, p=p) for n, (s, k, f, p) in enumerate(combinations)])
    conn.execute(text("""
        INSERT INTO download_logs(id, actor_id, session_id, initiation_id,
                                  source, kind, format, provenance, created_at)
        SELECT md5('download' || g)::uuid, md5('user' || (g % 1000 + 1))::uuid,
               'synthetic-session-' || (g % 1000 + 1), md5('initiation' || g)::uuid,
               CASE WHEN g % 25000 = 0 THEN 'unsafe legacy!' ELSE c.source END,
               CASE WHEN g % 25000 = 0 THEN 'unsafe legacy!' ELSE c.kind END,
               c.format, c.provenance,
               timestamp with time zone '2030-01-01' + (g / 4) * interval '1 second'
        FROM generate_series(1, :rows) g JOIN combinations c ON c.n = g % :combinations
    """), dict(rows=rows, combinations=len(combinations)))
    for table in ("users", "auth_sessions", "download_logs"):
        conn.execute(text(f"ANALYZE {table}"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=500000)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--trial-format-index", action="store_true")
    parser.add_argument("--without-format-index", action="store_true",
                        help="drop the new index only inside this disposable cluster for an A/B trial")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    assert args.rows >= 100000 and args.runs >= 1
    if args.trial_format_index and not args.without_format_index:
        parser.error("--trial-format-index requires --without-format-index")
    url = make_url(os.environ["DATABASE_URL"])
    assert os.environ["APP_ENV"] == "test"
    assert url.database == "evexia_download_profile"
    assert url.query["host"].startswith("/tmp/evexia-download-profile.")
    assert not url.host and not url.password
    engine = create_engine(url)
    start = datetime(2030, 1, 1, tzinfo=timezone.utc)
    actor = UUID(hashlib.md5(b"user7").hexdigest())
    cases = [
        ("unfiltered", "", 0, None, None, None, None),
        ("deep_unfiltered", "", args.rows - 75, None, None, None, None),
        ("past_end", "", args.rows + 100, None, None, None, None),
        ("broad_label", "Master", 0, None, None, None, None),
        ("deep_broad", "Master", 100000, None, None, None, None),
        ("rare_label", "issuance", 0, None, None, None, None),
        ("rare_actor", "Rare Actor Needle", 0, None, None, None, None),
        ("broad_actor", "synthetic", 0, None, None, None, None),
        ("email_fallback", "synthetic-10@", 0, None, None, None, None),
        ("no_match", "Absent literal needle", 0, None, None, None, None),
        ("literal_percent_underscore", "%_", 0, None, None, None, None),
        ("literal_slash", "/", 0, None, None, None, None),
        ("unicode", "İ", 0, None, None, None, None),
        ("short_search", "a", 0, None, None, None, None),
        ("fallback_label", "Download", 0, None, None, None, None),
        ("unsafe_metadata", "unsafe legacy!", 0, None, None, None, None),
        ("format_pdf", "", 0, None, None, None, "PDF"),
        ("deep_csv", "", 100000, None, None, None, "CSV"),
        ("format_xlsx", "", 0, None, None, None, "XLSX"),
        ("user_filter", "", 100, actor, None, None, None),
        ("utc_window", "", 0, None, start + timedelta(seconds=1000), start + timedelta(seconds=2000), None),
        ("combined_filters", "Master", 0, actor, start, start + timedelta(seconds=100000), "CSV"),
        ("provenance", "Server-prepared", 0, None, None, None, None),
    ]
    result = {"rows": args.rows, "runs": args.runs, "cases": {}}
    expected_outputs = {}
    began = time.perf_counter()
    with engine.begin() as conn:
        if args.without_format_index:
            conn.execute(text("DROP INDEX IF EXISTS ix_download_format_created_id"))
        seed(conn, args.rows)
        result["indexes"] = [dict(row) for row in conn.execute(text("""
            SELECT indexrelname AS name, pg_relation_size(indexrelid) AS bytes
            FROM pg_stat_user_indexes WHERE relname = 'download_logs' ORDER BY indexrelname
        """)).mappings()]
    result["seed_and_analyze_seconds"] = time.perf_counter() - began
    with engine.connect() as conn:
        result["postgresql"] = conn.scalar(text("SELECT version()"))
        result["settings"] = {k: conn.scalar(text(f"SHOW {k}"))
                              for k in ("work_mem", "shared_buffers", "max_parallel_workers_per_gather")}
        for name, q, offset, user, since, until, format in cases:
            selection = (50, offset, user, since, until, q, format)
            result["cases"][name] = {}
            outputs = []
            for original in (True, False):
                query = statement(selection, original)
                sql = str(query.compile(engine, compile_kwargs={"literal_binds": True}))
                plans = [conn.execute(text("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql)).scalar()[0]
                         for _ in range(args.runs)]
                timings = [p["Execution Time"] for p in plans]
                mode = "baseline" if original else "optimized"
                result["cases"][name][mode] = {
                    "median_ms": statistics.median(timings), "runs_ms": timings,
                    "plan": plans[-1], "sql": sql,
                }
                # The sentinel outer-join row is not a public item. Only its
                # total matters; post-page display expressions may be non-null.
                outputs.append([dict(row) if row["id"] is not None else {"total": row["total"]}
                                for row in conn.execute(query).mappings()])
            assert outputs[0] == outputs[1], f"Full projection/total/order mismatch: {name}"
            expected_outputs[name] = outputs[1]
            values = result["cases"][name]
            values["total"] = outputs[0][0]["total"]
            values["returned"] = sum(row.get("id") is not None for row in outputs[0])
            print(f"{name}: baseline={values['baseline']['median_ms']:.1f}ms "
                  f"optimized={values['optimized']['median_ms']:.1f}ms total={values['total']}", flush=True)
        if args.trial_format_index:
            conn.execute(text("CREATE INDEX ix_download_format_created_id ON download_logs(format, created_at, id)"))
            conn.execute(text("ANALYZE download_logs"))
            for name, q, offset, user, since, until, format in cases:
                query = statement((50, offset, user, since, until, q, format))
                sql = str(query.compile(engine, compile_kwargs={"literal_binds": True}))
                plans = [conn.execute(text("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql)).scalar()[0]
                         for _ in range(args.runs)]
                timings = [p["Execution Time"] for p in plans]
                result["cases"][name]["trial_format_index"] = {
                    "median_ms": statistics.median(timings), "runs_ms": timings, "plan": plans[-1], "sql": sql,
                }
                actual = [dict(row) if row["id"] is not None else {"total": row["total"]}
                          for row in conn.execute(query).mappings()]
                assert actual == expected_outputs[name], f"Index trial changed results: {name}"
                print(f"{name}: trial_format_index={statistics.median(timings):.1f}ms", flush=True)
            result["trial_index_bytes"] = conn.scalar(text("SELECT pg_relation_size('ix_download_format_created_id')"))
    Path(args.output).write_text(json.dumps(result, indent=2, default=str))
    engine.dispose()


if __name__ == "__main__":
    main()
