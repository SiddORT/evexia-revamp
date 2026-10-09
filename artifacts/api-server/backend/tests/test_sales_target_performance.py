"""Cold-session synthetic scale checks. Run only via test-api-foundation.sh."""
import csv
import io
import time
import uuid
from contextlib import contextmanager
from datetime import date, timedelta
from decimal import Decimal

import pytest
from openpyxl import load_workbook
from sqlalchemy import event, insert, select

from app.core.security import utcnow
from app.db.models import User, MRProfile, AuthSession
from app.db.download_models import DownloadLog
from app.db.mr_models import MRDirectory
from app.db.zone_models import Zone
from app.db.headquarter_models import Headquarter
from app.db.sales_target_models import SalesTarget
from app.services.auth import identity_from_token, AuthError
from app.services import sales_targets, sales_target_transfer as transfer
from test_sessions import client
from test_reporting import admin_headers
from test_mrs import fields as mr_fields, seed_designation

SIZE = 5000


@pytest.fixture
def directory(client):
    api, db, settings = client
    # Refuse accidental use of the application's configured or published database.
    assert settings.app_env == "test"
    assert db.bind.engine.url.database == "evexia_api_test"
    assert db.bind.engine.url.query.get("host", "").startswith("/tmp/evexia-api-test.")
    headers, admin = admin_headers(api, db)
    admin_id = admin.id
    seed_designation(db, admin_id)
    now = utcnow()
    users = [uuid.uuid4() for _ in range(SIZE)]
    mrs = [uuid.uuid4() for _ in range(SIZE)]
    zones = [uuid.uuid4() for _ in range(SIZE)]
    hqs = [uuid.uuid4() for _ in range(SIZE)]
    ids = [uuid.UUID(int=i + 1) for i in range(SIZE)]
    db.execute(insert(User), [dict(id=u, username=f"scale-user-{i}", password_hash="synthetic-unusable",
                                   system_role="mr") for i, u in enumerate(users)])
    db.execute(insert(MRProfile), [dict(id=m, user_id=u, is_active=True) for m, u in zip(mrs, users)])
    history = dict(deleted_at=now, deleted_by=admin_id)
    for model, refs in ((Zone, zones), (Headquarter, hqs)):
        db.execute(insert(model), [
            dict(id=ref, name=f"Scale {model.__name__} {i}", status="active",
                 created_by=admin_id, updated_by=admin_id,
                 **({"state_code": "DL"} if model is Headquarter else {}),
                 **(history if i == 0 else {})) for i, ref in enumerate(refs)])
    db.execute(insert(MRDirectory), [
        {**{k: v for k, v in mr_fields(hqs[i], zones[i], name=f"Scale MR {i:04}",
                                      code=f"SCALE-{i:04}").items() if k != "userId"},
         "id": m, "dateOfJoining": date(2020, 1, 1), "paymentLimit": Decimal("0.00"),
         "doctorDaysLimit": 0, "created_by": admin_id, "updated_by": admin_id,
         **(history if i == 0 else {})} for i, m in enumerate(mrs)])
    records = [
        dict(id=ids[i], mrId=m, startYear=2025 if i % 2 == 0 else 2026,
             endYear=2026 if i % 2 == 0 else 2027,
             q1=Decimal("999999999999.99"), q2=Decimal("0.01"),
             q3=Decimal("123.45"), q4=Decimal("0.00"),
             status="inactive" if i % 3 == 0 else "active",
             created_by=u, updated_by=users[(i + 1) % SIZE],
             created_at=now + timedelta(seconds=i // 2), updated_at=now)
        for i, (m, u) in enumerate(zip(mrs, users))]
    # Both label variants and a soft-deleted reference in the maximum-sized export.
    records[0]["created_by"] = admin_id
    db.execute(insert(SalesTarget), records)
    db.commit()
    db.expunge_all()
    actor = identity_from_token(db, headers["Authorization"][7:], settings)
    return api, db, headers, actor, records, zones


@contextmanager
def measure(db, name):
    # Count SELECTs, not transaction/savepoint implementation details.
    db.expunge_all()
    count = [0]
    def statement(conn, cursor, sql, params, context, many):
        if sql.lstrip().upper().startswith("SELECT"):
            count[0] += 1
    connection = db.connection()
    event.listen(connection, "before_cursor_execute", statement)
    start = time.perf_counter()
    try:
        yield count
    finally:
        elapsed = time.perf_counter() - start
        event.remove(connection, "before_cursor_execute", statement)
        print(f"sales-target-scale {name}: selects={count[0]} seconds={elapsed:.3f}")
        # Broad ceiling tolerates shared-runner contention; query counts are the
        # deterministic performance gate. Includes encoding, excludes fixture setup.
        assert elapsed < 15, f"{name} exceeded the 15-second synthetic budget"


def test_scale_summaries_and_exports(directory):
    api, db, headers, actor, records, zones = directory
    scenarios = [
        ("all", {}),
        ("broad-name", {"query": "Scale MR"}),
        ("year-status", {"query": "Scale", "startYear": 2025, "endYear": 2026, "status": "inactive"}),
        ("combined-zone", {"query": "Scale", "startYear": 2025, "endYear": 2026,
                           "status": "inactive", "zoneId": zones[0]}),
        ("empty", {"query": "missing"}),
    ]
    for name, filters in scenarios:
        expected = [r for i, r in enumerate(records)
                    if name not in ("empty",)
                    and (name not in ("year-status", "combined-zone") or (i % 2 == 0 and i % 3 == 0))
                    and (name != "combined-zone" or i == 0)]
        expected.sort(key=lambda r: (r["created_at"], r["id"]), reverse=True)
        with measure(db, name + "-summary") as queries:
            page = sales_targets.listing(db, actor, filters, 100, 0)
        assert queries[0] <= 6
        assert page["filtered"] == len(expected) and page["total"] == SIZE
        assert [r["id"] for r in page["items"]] == [r["id"] for r in expected[:100]]
        for quarter in ("q1", "q2", "q3", "q4"):
            assert page["totals"][quarter] == format(sum((r[quarter] for r in expected), Decimal(0)), ".2f")
        assert page["totals"]["total"] == format(sum((sum(r[q] for q in transfer.QUARTERS)
                                                       for r in expected), Decimal(0)), ".2f")
        for kind in ("csv", "xlsx"):
            with measure(db, name + "-" + kind) as queries:
                data = transfer.export(db, actor, filters, kind)
            assert queries[0] <= 3
            if kind == "csv":
                rows = list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))
            else:
                book = load_workbook(io.BytesIO(data), read_only=True)
                cells = list(book.active.rows)
                assert all(c.data_type == "s" for row in cells for c in row)
                rows = [[c.value for c in row] for row in cells]
                book.close()
            expected_rows = [transfer.HEADERS] + [
                [f"SCALE-{r['id'].int - 1:04}", str(r["startYear"]), str(r["endYear"]),
                 *(format(r[q], ".2f") for q in transfer.QUARTERS), r["status"],
                 "Super Admin" if r["id"] == records[0]["id"] else "Backend user",
                 r["created_at"].isoformat(), "Backend user", r["updated_at"].isoformat()]
                for r in expected]
            assert [list(r) for r in rows] == expected_rows
            if kind == "csv":
                assert data == transfer.encode(expected_rows, "csv")
                if name == "all":
                    all_csv = data

    with measure(db, "late-page-summary") as queries:
        page = sales_targets.listing(db, actor, {"query": "Scale MR"}, 100, 4900)
    assert queries[0] <= 6
    assert page["filtered"] == SIZE and page["totals"]["q1"] == "4999999999999950.00"
    assert [r["id"] for r in page["items"]] == [r["id"] for r in reversed(records[:100])]
    historical = page["items"][-1]
    assert historical["mrName"] == "Scale MR 0000"
    assert historical["zoneName"] == "Scale Zone 0"
    assert historical["headquarterName"] == "Scale Headquarter 0"
    assert historical["createdBy"] == "Super Admin"

    # Maximum-size actual HTTP bytes still require durable download acceptance.
    initiation = str(uuid.uuid4())
    download_headers = {**headers, "X-Download-Initiation": initiation}
    response = api.get("/api/v1/admin/sales-targets/export", headers=download_headers)
    assert response.status_code == 200 and response.content == all_csv
    log_id = uuid.UUID(response.headers["X-Download-Log"])
    evidence = db.get(DownloadLog, log_id)
    assert evidence.source == "sales_target" and evidence.kind == "export"
    assert evidence.actor_id == actor.user.id and evidence.session_id == actor.session_id
    repeated = api.get("/api/v1/admin/sales-targets/export", headers=download_headers)
    assert repeated.status_code == 200 and repeated.content == all_csv
    assert repeated.headers["X-Download-Log"] == str(log_id)

    # 5,001 *matching* targets fail before the acceptance ledger is written;
    # narrowed exports and all-match summaries still work.
    extra = {**records[-1], "id": uuid.uuid4(), "startYear": 2030, "endYear": 2031}
    db.execute(insert(SalesTarget), [extra])
    db.commit()
    denied_initiation = str(uuid.uuid4())
    failed = api.get("/api/v1/admin/sales-targets/export",
                     headers={**headers, "X-Download-Initiation": denied_initiation})
    assert failed.status_code == 422 and failed.json()["error"]["code"] == "sales_target_export_limit"
    assert db.scalar(select(DownloadLog.id).where(
        DownloadLog.initiation_id == uuid.UUID(denied_initiation))) is None
    with measure(db, "over-cap-summary") as queries:
        page = sales_targets.listing(db, actor, {}, 1, 0)
    assert queries[0] <= 6 and page["filtered"] == SIZE + 1
    assert page["totals"]["q1"] == format(Decimal("999999999999.99") * (SIZE + 1), ".2f")
    with measure(db, "narrowed-over-cap") as queries:
        data = transfer.export(db, actor, {"startYear": 2030}, "csv")
    assert queries[0] <= 3 and len(list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))) == 2

    # Bulk reads must not bypass the service's fresh protected-session check.
    session = db.get(AuthSession, actor.session_id)
    session.status, session.revoked_at = "REVOKED", utcnow()
    db.commit()
    for read in (lambda: sales_targets.listing(db, actor, {}, 100, 0),
                 lambda: transfer.export(db, actor, {}, "csv")):
        with pytest.raises(AuthError):
            read()
