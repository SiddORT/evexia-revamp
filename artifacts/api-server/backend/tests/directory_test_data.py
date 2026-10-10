"""Synthetic final-schema bulk fixtures; never apply to managed databases."""
import uuid
from sqlalchemy import select, func
from app.services.directory_runtime import crypto
from app.services.directory_inventory import FIELDS


def encrypted_values(db, table, values):
    record = dict(values)
    if table == "mr_directory":
        record.setdefault("dialCountry", "IN")
    record.setdefault("id", uuid.uuid4())
    if table == "mr_directory":
        record.setdefault("dialCountry", "IN")
    current = crypto()
    for field in FIELDS[table]:
        record[field + "_ciphertext"] = current.encrypt(table, record["id"], field, record.pop(field))
    if table == "doctor_directory":
        record["state_index"] = current.doctor_state_index(values["state"])
    elif table == "mr_directory":
        record["name_index"] = current.mr_name_index(db.scalar(select(func.lower(values["name"]))))
    else:
        record["duplicate_identity_index"] = current.patient_identity_index(
            db.scalar(select(func.lower(func.btrim(values["name"])))),
            values["dialCountry"], values["phone"], values["dateOfBirth"])
    return record


def initialize_empty_metadata_fixture(db):
    """A fresh create_all fixture, not a migration or managed rollout claim."""
    from sqlalchemy import text
    from app.services.directory_staging import _configuration_digest
    assert all(db.scalar(text(f"SELECT count(*) FROM {table}")) == 0 for table in FIELDS)
    db.execute(text("""CREATE TABLE directory_crypto_stage (
        id integer PRIMARY KEY, phase varchar(16) NOT NULL,
        index_key_check varchar(64) NOT NULL, configuration_digest varchar(64) NOT NULL)"""))
    current = crypto()
    db.execute(text("""INSERT INTO directory_crypto_stage VALUES
        (1,'encrypted',:index,:configuration)"""),
        {"index": current._index("configuration", ["index-key-check"]),
         "configuration": _configuration_digest(current)})


def approved_historical_upgrade(engine, config):
    """Exercise the actual gates with synthetic attestations in disposable PG."""
    from alembic import command
    from test_directory_staging import runtime
    from test_directory_retirement import stage
    command.upgrade(config, "0029_directory_crypto_additive")
    with runtime(engine) as (role, _):
        stage(engine, config, role)
        command.upgrade(config, "0030_directory_crypto_retirement")
        # Directory tests now cross the current organization-free release too;
        # keep actual retirement gates rather than stamping a synthetic head.
        from test_migration_0006 import upgrade_with_retirement_recovery
        upgrade_with_retirement_recovery(engine, config)
