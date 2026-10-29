"""Exact shipment successor compatibility; disposable PostgreSQL only."""
import pytest
from fastapi import HTTPException
from sqlalchemy import text
from test_account_crypto import db
from app.api.v1.system import readiness
from app.services import account_crypto, directory_rotation
from app.services.directory_inventory import RUNTIME_FIELDS


def test_shipments_retains_encryption_inventory_and_readiness(db):
    assert db.scalar(text("SELECT version_num FROM alembic_version")) == "0075_shipments"
    assert account_crypto.ready(db).configuration() == account_crypto.crypto().configuration()
    assert directory_rotation._fields(db) is RUNTIME_FIELDS
    readiness(db)


def test_shipments_retains_rotation_lock_compatibility(db):
    directory_rotation._lock(db)
    assert directory_rotation._fields(db) is RUNTIME_FIELDS


@pytest.mark.parametrize("statement", [
    "ALTER TABLE allergen_products RENAME COLUMN code TO unavailable_code",
    "ALTER SEQUENCE staff_employee_number_seq RENAME TO unavailable_staff_sequence",
])
def test_shipments_rejects_missing_numbering_capabilities(db, statement):
    db.execute(text(statement))
    with pytest.raises(HTTPException) as error:
        readiness(db)
    assert error.value.status_code == 503


def test_shipments_does_not_accept_unknown_encryption_successors(db):
    db.execute(text("UPDATE alembic_version SET version_num='0076_unreviewed'"))
    with pytest.raises(account_crypto.AccountCryptoError):
        account_crypto.ready(db)
    with pytest.raises(directory_rotation.RotationError):
        directory_rotation._fields(db)
