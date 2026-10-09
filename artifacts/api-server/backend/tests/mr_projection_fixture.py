"""Synthetic bulk fixtures and connection-local query instrumentation."""
import time
import uuid
from contextlib import contextmanager
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import event, insert, text
from app.core.security import utcnow
from app.db.models import User, MRProfile
from app.db.mr_models import MRDirectory
from app.db.headquarter_models import Headquarter
from app.db.zone_models import Zone
from app.db.designation_models import Designation


def seed_directory(db, actor_id, size):
    """Bypass hashing only for inert fixture accounts; never provision/login."""
    now = utcnow()
    refs = min(size, 110)
    hqs, zones, designations = ([uuid.uuid4() for _ in range(refs)] for _ in range(3))
    for model, keys in ((Headquarter, hqs), (Zone, zones), (Designation, designations)):
        values = [dict(id=key, name=f"Fixture {model.__tablename__} {i}",
                       status="inactive" if i % 3 else "active", version=1,
                       created_by=actor_id, updated_by=actor_id, created_at=now, updated_at=now,
                       deleted_at=now if i % 3 == 2 else None,
                       deleted_by=actor_id if i % 3 == 2 else None)
                  for i, key in enumerate(keys)]
        if model is Headquarter:
            for value in values:
                value["state_code"] = "DL"
        if model is Designation:
            for value in values:
                value["shortName"] = "MR"
        db.execute(insert(model), values)
    ids, users = [uuid.uuid4() for _ in range(size + 1)], [uuid.uuid4() for _ in range(size + 1)]
    db.execute(insert(User), [dict(id=key, username=f"fixture.mr.{i}", email=None,
                                  password_hash="inert-fixture-not-a-password-hash", system_role="mr",
                                  is_active=i % 2 == 0 and i < size, identity_version=1, token_version=0)
                             for i, key in enumerate(users)])
    db.execute(insert(MRProfile), [dict(id=key, user_id=users[i], is_active=i % 2 == 0 and i < size)
                                  for i, key in enumerate(ids)])
    records = []
    for i, key in enumerate(ids):
        records.append(dict(
            id=key, name=f"Bulk MR {i:05}" if i < size else "Deleted manager",
            employeeCode=f"FIX-{i:05}", phone="", email="", contactRequirement="optional",
            hq=hqs[i % refs], zoneId=zones[i % refs], dateOfJoining=date(2020, 1, 1),
            designation_id=designations[i % refs], reportingManagerId=None,
            paymentLimit=Decimal("123456789.12"), doctorDaysLimit=3650,
            status="active" if i % 2 == 0 and i < size else "inactive",
            pincode="110001", addressLine1="Synthetic address", addressLine2="",
            landmark="Synthetic landmark", city="Delhi", state="Delhi", country="India",
            version=i + 1, created_by=actor_id, updated_by=users[i],
            created_at=now + timedelta(microseconds=i), updated_at=now,
            deleted_at=now if i == size else None, deleted_by=actor_id if i == size else None))
    db.execute(insert(MRDirectory), records)
    # First row retains a deleted manager; all others form an acyclic chain.
    # Saved references are intentionally inactive/deleted, not new assignments.
    for start in range(0, size, 500):
        db.execute(text('UPDATE mr_directory SET "reportingManagerId"=:manager WHERE id=:id'),
                   [dict(id=ids[i], manager=ids[i - 1] if i else ids[-1])
                    for i in range(start, min(size, start + 500))])
    db.commit()
    return ids[:size]


@contextmanager
def measured_queries(connection):
    statements = []
    bind_counts = []
    def before(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
        if " IN (" in statement:
            bind_counts.append(len(parameters))
    event.listen(connection, "before_cursor_execute", before)
    start = time.monotonic()
    result = {"statements": statements, "bind_counts": bind_counts}
    try:
        yield result
    finally:
        result["seconds"] = time.monotonic() - start
        event.remove(connection, "before_cursor_execute", before)
