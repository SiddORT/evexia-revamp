"""Independent versioned AES-GCM keys; never reuse transport or signing secrets."""
import base64
import json
import re
import secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class CommunicationError(Exception):
    def __init__(self, message="Encrypted Communication storage is unavailable. Contact the operator.", status=503, code="communication_unavailable"):
        self.message, self.status, self.code = message, status, code


class CommunicationCrypto:
    def __init__(self, settings):
        try:
            raw = json.loads(settings.communication_encryption_keys.get_secret_value())
            self.active = settings.communication_encryption_key_id
            if not isinstance(raw, dict) or not raw or any(not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", k) for k in raw):
                raise ValueError()
            self.keys = {k: base64.b64decode(v, validate=True) for k, v in raw.items()}
            if self.active not in self.keys or any(len(v) != 32 for v in self.keys.values()) or len(set(self.keys.values())) != len(self.keys):
                raise ValueError()
            for key in self.keys.values():
                if key == settings.signing_key.encode() or base64.b64encode(key).decode() == settings.signing_key:
                    raise ValueError()
            # A dedicated key name alone is not independence: refuse known
            # staff/directory key material reused in this keyring.
            for name in ("staff_encryption_keys", "directory_encryption_keys"):
                configured = getattr(settings, name, None)
                if configured:
                    other = json.loads(configured.get_secret_value())
                    if isinstance(other, dict) and any(base64.b64decode(v, validate=True) in self.keys.values() for v in other.values()):
                        raise ValueError()
        except Exception:
            raise CommunicationError() from None

    @staticmethod
    def aad(row, field):
        return f"evexia:communication:v1:{row.id}:{row.channel}:{row.type}:{field}".encode()

    def encrypt(self, row, field, value):
        try:
            nonce = secrets.token_bytes(12)
            data = AESGCM(self.keys[self.active]).encrypt(nonce, value.encode(), self.aad(row, field))
            return f"v1:{self.active}:{base64.b64encode(nonce + data).decode()}"
        except Exception:
            raise CommunicationError() from None

    def decrypt(self, row, field, value):
        try:
            version, key, encoded = value.split(":")
            if version != "v1":
                raise ValueError()
            data = base64.b64decode(encoded, validate=True)
            return AESGCM(self.keys[key]).decrypt(data[:12], data[12:], self.aad(row, field)).decode()
        except Exception:
            raise CommunicationError() from None
