"""Query contracts, including a deterministic concurrent append during a read."""
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from queue import Queue

from alembic import command
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.db.download_models import DownloadLog
from app.db.models import AuthSession, User
from app.repositories.downloads import listing
from test_downloads import BASE, initiation, setup
from test_migration_0006 import migration_db
from test_sessions import client


def test_tied_pages_utc_boundaries_and_safe_fallback_search(client):
    api, db, _ = client
    headers, user = setup(api, db)
    assert api.post(f"{BASE}/initiate", headers=headers, json=initiation()).status_code == 200
    session_id = db.scalar(select(DownloadLog.session_id))
    at = datetime(2030, 1, 1, tzinfo=timezone.utc)
    ids = [uuid.UUID(int=i + 1) for i in range(125)]
    db.add_all([DownloadLog(
        id=id, actor_id=user.id, session_id=session_id, initiation_id=uuid.uuid4(),
        source="patient", kind="export", format="CSV", provenance="browser_reported", created_at=at,
    ) for id in ids])
    # Legacy raw metadata is not exposed or searched. Both safe fallback labels
    # remain searchable even when only one of source/kind is recognized.
    db.add_all([DownloadLog(
        actor_id=user.id, session_id=session_id, initiation_id=uuid.uuid4(),
        source=source, kind="unsafe legacy!", format="PDF",
        provenance="server_prepared", created_at=at + timedelta(seconds=1),
    ) for source in ("unsafe legacy!", "patient")])
    db.commit()
    params = {"start": at.isoformat(), "end": (at + timedelta(seconds=1)).isoformat(), "limit": 20}
    received = []
    for offset in range(0, 125, 20):
        result = api.get(BASE, headers=headers, params={**params, "offset": offset}).json()
        assert result["total"] == 125
        assert result["has_more"] == (offset + len(result["items"]) < 125)
        received.extend(row["id"] for row in result["items"])
    assert received == [str(id) for id in reversed(ids)]
    empty = api.get(BASE, headers=headers, params={**params, "offset": 1000000}).json()
    assert empty["items"] == [] and empty["total"] == 125 and not empty["has_more"]
    # Equivalent +05:30 bounds must select the identical UTC half-open interval.
    shifted = {**params, "start": "2030-01-01T05:30:00+05:30", "end": "2030-01-01T05:30:01+05:30"}
    assert api.get(BASE, headers=headers, params=shifted).json() == api.get(BASE, headers=headers, params=params).json()
    for q, expected in (("Download", 2), ("System", 1), ("unsafe legacy!", 0),
                        ("%_", 0), ("/", 0), ("Patient Master", 127)):
        result = api.get(BASE, headers=headers, params={"q": q}).json()
        assert result["total"] == expected
        for row in result["items"]:
            assert set(row) == {"id", "created_at", "format", "provenance", "module", "label", "user"}
            assert "unsafe" not in row["module"] + row["label"]


def test_total_and_page_share_snapshot_even_when_append_commits_mid_statement(migration_db):
    engine, config = migration_db
    command.upgrade(config, "head")
    actor_id = uuid.uuid4()
    old_id, new_id = uuid.uuid4(), uuid.uuid4()
    at = datetime(2030, 1, 1, tzinfo=timezone.utc)
    session_id = "synthetic-download-snapshot"
    with Session(engine) as db:
        db.add(User(id=actor_id, email="synthetic@example.test", password_hash="not-a-credential"))
        db.flush()
        db.add(AuthSession(id=session_id, user_id=actor_id, status="EXPIRED",
                           created_at=at, expires_at=at + timedelta(days=1)))
        db.flush()
        db.add(DownloadLog(id=old_id, actor_id=actor_id, session_id=session_id,
                          initiation_id=uuid.uuid4(), source="patient", kind="export",
                          format="CSV", provenance="browser_reported", created_at=at))
        db.commit()

    key = int(uuid.uuid4().hex[:7], 16)
    pids = Queue()

    def read():
        with engine.connect() as conn:
            pids.put(conn.scalar(text("SELECT pg_backend_pid()")))

            class PausedDatabase:
                def execute(self, query):
                    gate = select(func.pg_advisory_xact_lock(key)).cte("snapshot_gate").prefix_with("MATERIALIZED")
                    # Wait inside the same statement, after its MVCC snapshot
                    # exists, without changing the production query itself.
                    return conn.execute(query.where(select(func.count()).select_from(gate).scalar_subquery() == 1))

            return listing(PausedDatabase(), 50, 0, None, None, None, "", None)

    with engine.connect() as writer, ThreadPoolExecutor(max_workers=1) as pool:
        writer.execute(text("SELECT pg_advisory_lock(:key)"), {"key": key})
        writer.commit()
        future = pool.submit(read)
        try:
            pid = pids.get(timeout=5)
            deadline = time.monotonic() + 10
            while not writer.scalar(text("""
                SELECT EXISTS(SELECT 1 FROM pg_locks
                              WHERE pid=:pid AND locktype='advisory' AND NOT granted)
            """), {"pid": pid}):
                assert time.monotonic() < deadline, "reader did not reach snapshot gate"
                time.sleep(0.01)
            writer.execute(DownloadLog.__table__.insert().values(
                id=new_id, actor_id=actor_id, session_id=session_id, initiation_id=uuid.uuid4(),
                source="patient", kind="export", format="CSV", provenance="browser_reported",
                created_at=at + timedelta(seconds=1),
            ))
            writer.commit()
        finally:
            writer.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": key})
            writer.commit()
        during = future.result(timeout=10)
    assert during["total"] == 1 and [row["id"] for row in during["items"]] == [old_id]
    with engine.connect() as conn:
        after = listing(conn, 50, 0, None, None, None, "", None)
    assert after["total"] == 2 and [row["id"] for row in after["items"]] == [new_id, old_id]


def test_reporting_index_migration_preserves_append_only_history(migration_db):
    from test_migration_0006 import upgrade_with_retirement_recovery
    engine, config = migration_db
    command.upgrade(config, "0013_download_logs")
    at = datetime(2030, 1, 1, tzinfo=timezone.utc)
    with Session(engine) as db:
        user = User(email="synthetic-index@example.test", password_hash="not-a-credential")
        db.add(user)
        db.flush()
        session = AuthSession(user_id=user.id, status="EXPIRED",
                              created_at=at, expires_at=at + timedelta(days=1))
        db.add(session)
        db.flush()
        row = DownloadLog(actor_id=user.id, session_id=session.id, initiation_id=uuid.uuid4(),
                          source="patient", kind="export", format="CSV", provenance="browser_reported")
        db.add(row)
        db.flush()
        id = row.id
        db.commit()
    upgrade_with_retirement_recovery(engine, config)
    for revision in ("head", "0013_download_logs", "head"):
        command.upgrade(config, revision) if revision == "head" else command.downgrade(config, revision)
        with engine.connect() as conn:
            assert conn.scalar(select(DownloadLog.id)) == id
            definition = conn.scalar(text("""
                SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema()
                AND indexname='ix_download_format_created_id'
            """))
            assert (definition is not None) == (revision == "head")
            if definition:
                assert "(format, created_at, id)" in definition
            assert conn.scalar(text("""
                SELECT count(*) FROM pg_trigger WHERE tgrelid='download_logs'::regclass
                AND tgname='download_append_only'
            """)) == 1
