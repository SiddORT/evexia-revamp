"""Pure synthetic-key crypto regressions; no configured database or secrets."""
import base64
from datetime import date, datetime
import json
import uuid

import pytest
from pydantic import SecretStr
from app.core.config import Settings
from app.services.directory_crypto import DirectoryCrypto
from app.services.directory_inventory import FIELDS, DATE_FIELDS, NULLABLE_FIELDS, DirectoryCryptoError
from app.services.staff_crypto import StaffCrypto, StaffError


def b64(value):
    return base64.b64encode(value).decode()


def settings(**updates):
    values = dict(database_url="postgresql+psycopg://synthetic@/isolated_test",
                  jwt_secret=SecretStr("synthetic-tests-only-signing-secret-not-a-live-key"),
                  directory_encryption_keys=SecretStr(json.dumps({"primary": b64(b"C" * 32),
                                                                 "historical": b64(b"D" * 32)})),
                  directory_index_key=SecretStr(b64(b"E" * 32)),
                  staff_encryption_keys=SecretStr(json.dumps({"primary": b64(b"A" * 32)})),
                  staff_email_index_key=SecretStr(b64(b"B" * 32)))
    values.update(updates)
    return Settings(**values)


@pytest.mark.parametrize("table,field", [(table, field) for table, fields in FIELDS.items() for field in fields])
def test_every_classified_field_randomized_roundtrip(table, field):
    crypto, record = DirectoryCrypto(settings()), uuid.uuid4()
    value = date(2000, 2, 29) if (table, field) in DATE_FIELDS else "Synthetic \u00e9 text:|[]"
    first = crypto.encrypt(table, record, field, value)
    second = crypto.encrypt(table, record, field, value)
    assert first != second
    assert value.isoformat() not in first if isinstance(value, date) else value not in first
    assert crypto.decrypt(table, record, field, first) == value
    assert crypto.decrypt(table, record, field, second) == value


def test_empty_and_null_are_distinct_and_dates_are_date_only():
    crypto, record = DirectoryCrypto(settings()), uuid.uuid4()
    empty = crypto.encrypt("doctor_directory", record, "phone", "")
    assert empty and crypto.decrypt("doctor_directory", record, "phone", empty) == ""
    assert crypto.encrypt("doctor_directory", record, "dateOfJoining", None) is None
    assert crypto.decrypt("doctor_directory", record, "dateOfJoining", None) is None
    for value in ("2000-01-01", datetime(2000, 1, 1)):
        with pytest.raises(DirectoryCryptoError):
            crypto.encrypt("patient_directory", record, "dateOfBirth", value)
    with pytest.raises(DirectoryCryptoError):
        crypto.encrypt("patient_directory", record, "name", None)
    with pytest.raises(DirectoryCryptoError):
        crypto.decrypt("patient_directory", record, "name", None)


def test_aad_rejects_cross_field_record_table_and_staff_substitution():
    config, record = settings(), uuid.uuid4()
    crypto, staff = DirectoryCrypto(config), StaffCrypto(config)
    ciphertext = crypto.encrypt("doctor_directory", record, "name", "Synthetic")
    for table, target, field in (("mr_directory", record, "name"),
                                  ("doctor_directory", uuid.uuid4(), "name"),
                                  ("doctor_directory", record, "email")):
        with pytest.raises(DirectoryCryptoError):
            crypto.decrypt(table, target, field, ciphertext)
    with pytest.raises(StaffError):
        staff.decrypt(record, "name", ciphertext)
    with pytest.raises(DirectoryCryptoError):
        crypto.decrypt("doctor_directory", record, "name", staff.encrypt(record, "name", "Synthetic"))
    # Staff's existing format/AAD is unmodified and still interoperates.
    assert staff.aad(record, "name") == f"evexia:staff:v1:{record}:name".encode()
    assert StaffCrypto(config).decrypt(record, "name", staff.encrypt(record, "name", "Synthetic")) == "Synthetic"


@pytest.mark.parametrize("value", ["v2:primary:AA==", "v1:unknown:AA==", "not ciphertext", "", "v1:primary:AAAA"])
def test_invalid_ciphertext_safe_error(value):
    with pytest.raises(DirectoryCryptoError) as failure:
        DirectoryCrypto(settings()).decrypt("doctor_directory", uuid.uuid4(), "name", value)
    assert str(failure.value) == DirectoryCryptoError.message
    assert failure.value.__cause__ is None


def test_historical_keys_and_bit_tamper():
    config, record = settings(), uuid.uuid4()
    old = DirectoryCrypto(config.model_copy(update={"directory_encryption_key_id": "historical"}))
    encrypted = old.encrypt("doctor_directory", record, "name", "Synthetic")
    assert DirectoryCrypto(config).decrypt("doctor_directory", record, "name", encrypted) == "Synthetic"
    retired = config.model_copy(update={"directory_encryption_keys": SecretStr(json.dumps({"primary": b64(b"C" * 32)}))})
    with pytest.raises(DirectoryCryptoError):
        DirectoryCrypto(retired).decrypt("doctor_directory", record, "name", encrypted)
    version, key, payload = encrypted.split(":")
    raw = bytearray(base64.b64decode(payload))
    raw[-1] ^= 1
    with pytest.raises(DirectoryCryptoError):
        old.decrypt("doctor_directory", record, "name", f"{version}:{key}:{b64(raw)}")


@pytest.mark.parametrize("changes", [
    {"directory_encryption_keys": None},
    {"directory_index_key": None},
    {"directory_encryption_key_id": "missing"},
    {"directory_encryption_keys": SecretStr("{}")},
    {"directory_encryption_keys": SecretStr('{"bad:id":"AAAA"}')},
    {"directory_encryption_keys": SecretStr(json.dumps({"primary": b64(b"C" * 32), "other": b64(b"C" * 32)}))},
    {"directory_encryption_keys": SecretStr(json.dumps({"primary": b64(b"A" * 32)}))},
    {"directory_index_key": SecretStr(b64(b"B" * 32))},
    {"directory_index_key": SecretStr(b64(b"C" * 32))},
    {"directory_index_key": SecretStr("invalid")},
    {"directory_index_key": SecretStr(b64(b"E" * 31))},
    {"jwt_secret": SecretStr(b64(b"C" * 32))},
])
def test_key_configuration_fails_closed(changes):
    with pytest.raises(DirectoryCryptoError) as failure:
        DirectoryCrypto(settings(**changes))
    assert str(failure.value) == DirectoryCryptoError.message


def test_composite_serialization_and_index_domain_separation():
    crypto = DirectoryCrypto(settings())
    dob = date(2000, 1, 1)
    first = crypto.patient_identity_index("a|b", "IN", "123", dob)
    assert first == crypto.patient_identity_index("a|b", "IN", "123", dob)
    assert first != crypto.patient_identity_index("a", "b|IN", "123", dob)
    assert first != crypto.patient_identity_index("a|b", "US", "123", dob)
    assert first != crypto.patient_identity_index("a|b", "IN", "0123", dob)
    assert first != crypto.patient_identity_index("a|b", "IN", "123", date(2000, 1, 2))
    assert crypto.mr_name_index("name") != crypto.doctor_state_index("name")
    assert crypto.doctor_state_index("Delhi") != crypto.doctor_state_index("delhi")
    rekey = DirectoryCrypto(settings(directory_index_key=SecretStr(b64(b"F" * 32))))
    assert first != rekey.patient_identity_index("a|b", "IN", "123", dob)
