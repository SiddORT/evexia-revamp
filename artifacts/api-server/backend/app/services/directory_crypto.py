"""Directory-specific AAD and typed payloads; Staff format/AAD remain unchanged."""
import base64
from datetime import date, datetime
import hashlib
import hmac
import json
from types import SimpleNamespace
import uuid

from app.services.directory_inventory import DATE_FIELDS, FIELDS, NULLABLE_FIELDS, DirectoryCryptoError
from app.services.staff_crypto import StaffCrypto


def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class DirectoryCrypto(StaffCrypto):
    def __init__(self, settings):
        try:
            # Reuse the established encryption/key validation without changing
            # Staff's interface, ciphertext bytes, AAD or rotation tooling.
            super().__init__(SimpleNamespace(
                staff_encryption_keys=settings.directory_encryption_keys,
                staff_encryption_key_id=settings.directory_encryption_key_id,
                staff_email_index_key=settings.directory_index_key,
                signing_key=settings.signing_key,
            ))
            # Directory and Staff custodians may retain independent keyrings.
            # If configured, none of Staff's keys may be reused in this scope.
            other = []
            if settings.staff_encryption_keys is not None:
                raw = json.loads(settings.staff_encryption_keys.get_secret_value())
                if not isinstance(raw, dict):
                    raise ValueError()
                other.extend(base64.b64decode(v, validate=True) for v in raw.values())
            if settings.staff_email_index_key is not None:
                other.append(base64.b64decode(settings.staff_email_index_key.get_secret_value(), validate=True))
            if any(key in other for key in [*self.keys.values(), self.index_key]):
                raise ValueError()
        except Exception:
            raise DirectoryCryptoError() from None

    @staticmethod
    def aad(record_id, field):
        # The table is part of the validated internal record_id, unlike Staff.
        return f"evexia:directory:v1:{record_id}:{field}".encode()

    @staticmethod
    def identity(table, record_id, field):
        if table not in FIELDS or field not in FIELDS[table]:
            raise ValueError()
        return f"{table}:{uuid.UUID(str(record_id))}"

    @staticmethod
    def payload(table, field, value):
        if value is None:
            if (table, field) not in NULLABLE_FIELDS:
                raise ValueError()
            return None
        if (table, field) in DATE_FIELDS:
            if not isinstance(value, date) or isinstance(value, datetime):
                raise ValueError()
            return ["date", value.isoformat()]
        if not isinstance(value, str):
            raise ValueError()
        return ["text", value]

    def encrypt(self, table, record_id, field, value):
        try:
            identity = self.identity(table, record_id, field)
            payload = self.payload(table, field, value)
            if payload is None:
                return None
            return super().encrypt(identity, field, canonical(payload).decode())
        except Exception:
            raise DirectoryCryptoError() from None

    def decrypt(self, table, record_id, field, ciphertext):
        try:
            identity = self.identity(table, record_id, field)
            if ciphertext is None:
                if (table, field) not in NULLABLE_FIELDS:
                    raise ValueError()
                return None
            raw = super().decrypt(identity, field, ciphertext)
            payload = json.loads(raw)
            if not isinstance(payload, list) or len(payload) != 2 or not isinstance(payload[1], str):
                raise ValueError()
            if (table, field) in DATE_FIELDS:
                if payload[0] != "date":
                    raise ValueError()
                value = date.fromisoformat(payload[1])
            else:
                if payload[0] != "text":
                    raise ValueError()
                value = payload[1]
            if canonical(self.payload(table, field, value)).decode() != raw:
                raise ValueError()
            return value
        except Exception:
            raise DirectoryCryptoError() from None

    def _index(self, domain, parts):
        return hmac.new(self.index_key, b"evexia:directory:index:v1:" + domain.encode() +
                        b"\0" + canonical(parts), hashlib.sha256).hexdigest()

    def mr_name_index(self, normalized_name):
        """Caller supplies authoritative PostgreSQL lower(name), not casefold."""
        return self._index("mr_directory:name", ["name", normalized_name])

    def doctor_state_index(self, state):
        """Preserve existing exact case-sensitive equality, including empty text."""
        return self._index("doctor_directory:state", ["state", state])

    def patient_identity_index(self, normalized_name, dial_country, phone, dob):
        """Caller supplies PostgreSQL lower(btrim(name)); no delimiter ambiguity."""
        if not isinstance(dob, date) or isinstance(dob, datetime):
            raise DirectoryCryptoError()
        return self._index("patient_directory:duplicate", [
            "patient-identity", normalized_name, dial_country, phone, dob.isoformat(),
        ])
