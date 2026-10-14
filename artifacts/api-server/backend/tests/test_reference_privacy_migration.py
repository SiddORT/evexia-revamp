"""Guarded populated conversion with real synthetic dump/restore evidence."""
import hashlib
import os
import subprocess
import uuid
from datetime import date
from types import SimpleNamespace
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from alembic import command
from app.core.config import get_settings
from app.db.models import User, MRProfile
from app.schemas.vendors import VendorFields
from app.services import reference_privacy_migration as privacy
from app.services.directory_crypto import DirectoryCrypto
from app.services.directory_inventory import FIELDS, VENDOR_FIELDS
from app.services.account_crypto import AccountCryptoError
from test_migration_0006 import migration_db
from test_vendors import FIELDS as VENDOR_VALUES


def source(engine, config):
    command.upgrade(config, privacy.PREVIOUS)
    actor, parent, child = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    hq, zone, category, location, designation, vendor, allergen = [uuid.uuid4() for _ in range(7)]
    with Session(engine) as db:
        db.add(User(id=actor, email="privacy@example.test", username="privacy.operator",
                    password_hash="inert-test-hash", system_role="mr"))
        db.flush()
        db.add(MRProfile(user_id=actor, is_active=True))
        for key in (parent, child):
            # These identity-only accounts commit before their directory rows.
            # NULL email is allowed only after a directory extension exists.
            user = User(email="privacy." + key.hex[:16] + "@example.test", username="privacy." + key.hex[:16],
                        password_hash="inert-test-hash", system_role="mr")
            db.add(user)
            db.flush()
            db.add(MRProfile(id=key, user_id=user.id, is_active=True))
        db.commit()
    with engine.begin() as db:
        for table, key, extra in (("headquarters", hq, ',state_code'),
                                  ("zones", zone, ''), ("product_categories", category, ',unit_price,description'),
                                  ("storage_locations", location, ',address'), ("designations", designation, ',"shortName"')):
            suffix = {"headquarters": ",'DL'", "product_categories": ",0,''",
                      "storage_locations": ",'Address'", "designations": ",'MR'"}.get(table, "")
            db.execute(sa.text(f"INSERT INTO {table}(id,name,status,created_by,updated_by{extra}) "
                               f"VALUES(:id,:name,'active',:actor,:actor{suffix})"),
                       dict(id=key, name="Baseline " + table, actor=actor))
        values = VendorFields(**VENDOR_VALUES).model_dump()
        table = sa.Table("vendors", sa.MetaData(), autoload_with=db, resolve_fks=False)
        db.execute(table.insert().values(id=vendor, **values, created_by=actor, updated_by=actor,
                                        deleted_at=sa.func.now(), deleted_by=actor))
        db.execute(sa.text("""INSERT INTO allergen_products
            (id,name,category_id,storage_location_id,gst,concentration,mix,status,created_by,updated_by,deleted_at,deleted_by)
            VALUES(:id,'Baseline allergen',:category,:location,0,'1:10',false,'active',:actor,:actor,now(),:actor)"""),
                   dict(id=allergen, category=category, location=location, actor=actor))
        crypto = DirectoryCrypto(get_settings())
        table = sa.Table("mr_directory", sa.MetaData(), autoload_with=db, resolve_fks=False)
        for key, name, manager in ((parent, "Baseline manager", None), (child, "Baseline child", parent)):
            fields = {field: "" for field in FIELDS["mr_directory"]}
            fields.update(name=name, dateOfJoining=date(2020, 1, 1), dialCountry="IN",
                          email="privacy." + key.hex[:16] + "@example.test")
            encrypted = {field + "_ciphertext": crypto.encrypt("mr_directory", key, field, value)
                         for field, value in fields.items()}
            db.execute(table.insert().values(id=key, contactRequirement="optional", hq=hq, zoneId=zone,
                employeeCode=key.hex, designation_id=designation, reportingManagerId=manager,
                paymentLimit=0, doctorDaysLimit=0, status="active", version=3,
                created_by=actor, updated_by=actor, **encrypted,
                name_index=crypto.mr_name_index(name.lower())))
        # Include a deleted/inactive directory extension with consistent
        # retained account/profile activation, not a fixture-only bypass.
        db.execute(sa.text('UPDATE mr_directory SET status=\'inactive\',deleted_at=now(),deleted_by=:actor WHERE id=:id'),
                   {"actor": actor, "id": child})
        db.execute(sa.text('UPDATE users SET is_active=false WHERE id=(SELECT user_id FROM mr_profiles WHERE id=:id)'),
                   {"id": child})
        db.execute(sa.text('UPDATE mr_profiles SET is_active=false WHERE id=:id'), {"id": child})
    return dict(actor=actor, parent=parent, child=child, vendor=vendor, allergen=allergen)


def evidence(engine, path):
    url = engine.url.set(drivername="postgresql")
    with engine.connect() as db:
        schema = db.scalar(sa.text("SELECT current_schema()"))
        name, system_id = db.execute(sa.text(
            "SELECT current_database(),system_identifier FROM pg_control_system()")).one()
    clone = "privacy_restore_test_" + uuid.uuid4().hex
    # A schema-only dump omits shared pg_trgm/operator-class dependencies.
    # Back up this entire disposable database, just as the runbook requires.
    subprocess.run(["pg_dump", "--dbname", url.render_as_string(hide_password=False),
                    "--format=custom", "--file", str(path)], check=True, capture_output=True)
    path.chmod(0o600)
    clone_url = url.set(database=clone)
    # The fixture's URL and all credentials are synthetic and socket-local.
    subprocess.run(["createdb", "--maintenance-db", url.render_as_string(hide_password=False), clone],
                   check=True, capture_output=True)
    try:
        result = subprocess.run(["pg_restore", "--dbname", clone_url.render_as_string(hide_password=False),
                                 "--exit-on-error", str(path)], capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        restored = sa.create_engine(clone_url.set(drivername="postgresql+psycopg"), hide_parameters=True)
        try:
            with engine.connect() as original, restored.connect() as copy:
                for table in ("vendors", "allergen_products", "mr_directory", "users", "account_identifier_reservations"):
                    left = original.execute(sa.text(f'SELECT row_to_json(t)::text FROM "{schema}".{table} t ORDER BY id'
                                                   if table != "account_identifier_reservations" else
                                                   f'SELECT row_to_json(t)::text FROM "{schema}".{table} t ORDER BY identifier_index')).all()
                    right = copy.execute(sa.text(f'SELECT row_to_json(t)::text FROM "{schema}".{table} t ORDER BY id'
                                                 if table != "account_identifier_reservations" else
                                                 f'SELECT row_to_json(t)::text FROM "{schema}".{table} t ORDER BY identifier_index')).all()
                    assert left == right
        finally:
            restored.dispose()
    finally:
        subprocess.run(["dropdb", "--maintenance-db", url.render_as_string(hide_password=False), clone],
                       check=True, capture_output=True)
    args = {key: "yes" for key in ("approved", "writers_stopped", "backup_durable",
                                  "restoration_rehearsal", "external_consumers_reviewed")}
    args.update(expected_database=name, expected_system_identifier=str(system_id), backup=str(path),
                backup_sha256=hashlib.sha256(path.read_bytes()).hexdigest())
    return {key: value for key, value in args.items()}


def approve(config, args):
    config.cmd_opts = SimpleNamespace(x=["reference_privacy_" + key + "=" + value for key, value in args.items()])


def test_populated_conversion_real_rehearsal_preserves_metadata_and_removes_plaintext(migration_db, tmp_path):
    engine, config = migration_db
    ids = source(engine, config)
    with engine.connect() as db:
        before = {table: db.execute(sa.text(f"SELECT id,version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by FROM {table} ORDER BY id")).all()
                  for table in ("vendors", "allergen_products", "mr_directory")}
    args = evidence(engine, tmp_path / "backup.dump")
    approve(config, args)
    command.upgrade(config, privacy.REVISION)
    crypto = DirectoryCrypto(get_settings())
    with engine.connect() as db:
        for table, expected in before.items():
            assert expected == db.execute(sa.text(f"SELECT id,version,created_at,updated_at,created_by,updated_by,deleted_at,deleted_by FROM {table} ORDER BY id")).all()
        columns = {column["name"] for column in sa.inspect(db).get_columns("vendors")}
        assert not set(VENDOR_FIELDS) & columns
        row = db.execute(sa.text("SELECT * FROM vendors")).mappings().one()
        values = VendorFields(**VENDOR_VALUES).model_dump()
        assert all(crypto.decrypt("vendors", row["id"], field, row[field + "_ciphertext"]) == values[field]
                   for field in VENDOR_FIELDS)
        saved = db.execute(sa.text("SELECT category_name,storage_location_name FROM allergen_products")).one()
        assert tuple(saved) == ("Baseline product_categories", "Baseline storage_locations")
        snapshots = db.execute(sa.text("SELECT id,hq_name,zone_name,reporting_manager_name_ciphertext FROM mr_directory")).all()
        for key, hq, zone, manager in snapshots:
            assert (hq, zone) == ("Baseline headquarters", "Baseline zones")
            assert crypto.decrypt("mr_directory", key, "reporting_manager_name", manager) == (
                "Baseline manager" if key == ids["child"] else None)
    with pytest.raises(RuntimeError, match="Populated privacy downgrade refused"):
        command.downgrade(config, privacy.PREVIOUS)


@pytest.mark.parametrize("failure", ["approval", "digest", "target", "restoration", "keys"])
def test_populated_refuses_missing_or_invalid_evidence_atomically(migration_db, tmp_path, monkeypatch, failure):
    engine, config = migration_db
    source(engine, config)
    args = evidence(engine, tmp_path / "backup.dump") if failure != "approval" else {}
    if failure == "digest":
        args["backup_sha256"] = "0" * 64
    elif failure == "target":
        args["expected_database"] = "wrong_database"
    elif failure == "restoration":
        args.pop("restoration_rehearsal")
    elif failure == "keys":
        from pydantic import SecretStr
        settings = get_settings().model_copy(update={"directory_index_key": SecretStr("invalid")})
        monkeypatch.setattr(privacy.directory_runtime, "get_settings", lambda: settings)
    approve(config, args)
    with pytest.raises(Exception):
        command.upgrade(config, privacy.REVISION)
    with engine.connect() as db:
        assert db.scalar(sa.text("SELECT version_num FROM alembic_version")) == privacy.PREVIOUS
        assert "registeredAddress" in {col["name"] for col in sa.inspect(db).get_columns("vendors")}
        assert "category_name" not in {col["name"] for col in sa.inspect(db).get_columns("allergen_products")}


def test_empty_upgrade_and_downgrade_keep_the_legacy_contract(migration_db):
    engine, config = migration_db
    command.upgrade(config, privacy.REVISION)
    command.downgrade(config, privacy.PREVIOUS)
    with engine.connect() as db:
        columns = {col["name"] for col in sa.inspect(db).get_columns("vendors")}
        assert set(VENDOR_FIELDS) <= columns
    command.upgrade(config, privacy.REVISION)


def test_unreviewed_sensitive_dependency_blocks_even_empty_conversion(migration_db):
    engine, config = migration_db
    command.upgrade(config, privacy.PREVIOUS)
    with engine.begin() as db:
        db.execute(sa.text('CREATE INDEX custom_vendor_email ON vendors("emailId")'))
    with pytest.raises(Exception):
        command.upgrade(config, privacy.REVISION)
    with engine.connect() as db:
        assert db.scalar(sa.text("SELECT version_num FROM alembic_version")) == privacy.PREVIOUS
