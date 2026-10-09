"""Populated historical upgrade and generated exact amounts; disposable schemas."""
import uuid
from decimal import Decimal

import pytest
from alembic import command
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.api.v1.system import readiness
from app.db.designation_models import Designation
from app.db.sales_target_models import SalesTarget
from app.db.mr_models import MRDirectory
from test_migration_0006 import migration_db
from test_migration_zones import prepare
from test_migration_sales_targets import seed

RETIRED = {"level", "basicDa", "hra", "medicalAllowance", "travellingAllowance",
           "specialAllowance", "professionalTax"}


def test_populated_previous_schema_preservation_generated_values_and_safe_refusal(migration_db):
    engine, config, actor_id, _ = prepare(migration_db)
    command.downgrade(config, "0025_vendor_phone")
    ids = [uuid.uuid4() for _ in range(3)]
    with Session(engine) as db:
        mr = seed(db, actor_id)
        for index, record_id in enumerate(ids):
            # Historical SQL contract, not today's ORM: include retired NOT NULL fields.
            db.execute(text(
                'INSERT INTO designations (id,name,"shortName",level,status,"basicDa",hra,'
                '"medicalAllowance","travellingAllowance","specialAllowance","professionalTax",'
                'version,created_by,updated_by,deleted_at,deleted_by) '
                "VALUES (:id,:name,'OLD',7,:status,123.45,12.34,1,2,3,4,3,:actor,:actor,"
                "CASE WHEN :deleted THEN now() ELSE NULL END,"
                "CASE WHEN :deleted THEN :actor ELSE NULL END)"),
                dict(id=record_id, name=f"Historical {index}", status="active" if index == 0 else "inactive",
                     actor=actor_id, deleted=index == 2))
            db.execute(text(
                'INSERT INTO sales_targets (id,"mrId","startYear","endYear",q1,q2,q3,q4,'
                'status,version,created_by,updated_by,deleted_at,deleted_by) '
                "VALUES (:id,:mr,:year,:end,0.10,0.20,0,0.01,:status,3,:actor,:actor,"
                "CASE WHEN :deleted THEN now() ELSE NULL END,"
                "CASE WHEN :deleted THEN :actor ELSE NULL END)"),
                dict(id=record_id, mr=mr["id"], year=2030 + index, end=2031 + index,
                     status="active" if index == 0 else "inactive", actor=actor_id, deleted=index == 2))
        db.commit()
        old_designations = db.execute(text(
            'SELECT id,name,"shortName",status,version,created_by,updated_by,created_at,updated_at,deleted_at,deleted_by '
            'FROM designations ORDER BY id')).all()
        old_targets = db.execute(text("SELECT * FROM sales_targets ORDER BY id")).mappings().all()
    command.upgrade(config, "head")
    with Session(engine) as db:
        assert db.execute(text(
            'SELECT id,name,"shortName",status,version,created_by,updated_by,created_at,updated_at,deleted_at,deleted_by '
            'FROM designations ORDER BY id')).all() == old_designations
        targets = db.execute(text("SELECT * FROM sales_targets ORDER BY id")).mappings().all()
        assert [{k: v for k, v in row.items() if k != "annual_target"} for row in targets] == [dict(r) for r in old_targets]
        assert all(row["annual_target"] == Decimal("0.31") for row in targets)
        assert db.get(MRDirectory, uuid.UUID(mr["id"])).designation == "MR"
        assert readiness(db) == {"status": "ready"}
    for model in (Designation, SalesTarget):
        columns = inspect(engine).get_columns(model.__tablename__)
        assert {c["name"] for c in columns} == set(model.__table__.columns.keys())
    assert RETIRED.isdisjoint(c["name"] for c in inspect(engine).get_columns("designations"))
    generated = next(c for c in inspect(engine).get_columns("sales_targets") if c["name"] == "annual_target")
    assert generated["computed"]["persisted"] and not generated["nullable"]
    for amount, expected in (("0", "0"), ("0.01", "0.04"), ("999999999999.99", "3999999999999.96")):
        with engine.begin() as connection:
            connection.execute(text("UPDATE sales_targets SET q1=:q,q2=:q,q3=:q,q4=:q"), {"q": Decimal(amount)})
            assert set(connection.scalars(text("SELECT annual_target FROM sales_targets"))) == {Decimal(expected)}
    for sql in ("UPDATE sales_targets SET annual_target=1",
                'INSERT INTO sales_targets SELECT * FROM sales_targets LIMIT 1'):
        with pytest.raises(DBAPIError) as failure:
            with engine.begin() as connection:
                connection.execute(text(sql))
        assert failure.value.orig.sqlstate == "428C9"  # GENERATED ALWAYS rejects explicit assignment.
    # Failure occurs before any DDL, including for tombstones; nothing is falsified.
    with pytest.raises(RuntimeError, match="cannot restore discarded values"):
        command.downgrade(config, "0025_vendor_phone")
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0026_designation_target"
        assert connection.scalar(text("SELECT count(*) FROM sales_targets")) == 3
    # Readiness must fail if a required new column is absent.
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE sales_targets RENAME COLUMN annual_target TO temporarily_missing"))
    from fastapi import HTTPException
    with Session(engine) as db, pytest.raises(HTTPException) as failure:
        readiness(db)
    assert failure.value.status_code == 503


def test_empty_downgrade_restores_contract_without_fabricating_history(migration_db):
    engine, config, _, _ = prepare(migration_db)
    command.downgrade(config, "0025_vendor_phone")
    assert RETIRED.issubset(c["name"] for c in inspect(engine).get_columns("designations"))
    command.upgrade(config, "head")
    with Session(engine) as db:
        assert list(db.scalars(select(Designation))) == []
