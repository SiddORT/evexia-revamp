"""Authenticated randomized field encryption; no signing-key fallback."""
import base64
import hashlib
import hmac
import json
import re
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class StaffError(Exception):
    def __init__(self, message="Staff service unavailable", status=503, code="staff_unavailable"):
        self.message, self.status, self.code = message, status, code


class StaffCrypto:
    def __init__(self, settings):
        try:
            raw = json.loads(settings.staff_encryption_keys.get_secret_value())
            self.active = settings.staff_encryption_key_id
            if not isinstance(raw, dict) or not raw or any(not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", k) for k in raw):
                raise ValueError()
            self.keys = {k: base64.b64decode(v, validate=True) for k, v in raw.items()}
            self.index_key = base64.b64decode(settings.staff_email_index_key.get_secret_value(), validate=True)
            if self.active not in self.keys or any(len(v) != 32 for v in self.keys.values()) or len(self.index_key) != 32:
                raise ValueError()
            # Independent operator keys, including from the selected signing secret.
            if len(set(self.keys.values())) != len(self.keys) or self.index_key in self.keys.values():
                raise ValueError()
            signing = settings.signing_key.encode()
            if any(v == signing or base64.b64encode(v).decode() == settings.signing_key for v in [*self.keys.values(), self.index_key]):
                raise ValueError()
        except Exception:
            raise StaffError() from None

    @staticmethod
    def aad(record_id, field):
        return f"evexia:staff:v1:{record_id}:{field}".encode()

    def encrypt(self, record_id, field, value):
        try:
            nonce = secrets.token_bytes(12)
            ciphertext = AESGCM(self.keys[self.active]).encrypt(nonce, value.encode(), self.aad(record_id, field))
            return f"v1:{self.active}:{base64.b64encode(nonce + ciphertext).decode()}"
        except Exception:
            raise StaffError() from None

    def decrypt(self, record_id, field, value):
        try:
            version, key_id, encoded = value.split(":")
            if version != "v1":
                raise ValueError()
            raw = base64.b64decode(encoded, validate=True)
            return AESGCM(self.keys[key_id]).decrypt(raw[:12], raw[12:], self.aad(record_id, field)).decode()
        except Exception:
            raise StaffError() from None

    def email_index(self, value):
        return hmac.new(self.index_key, b"evexia:staff:email:v1:" + value.strip().lower().encode(), hashlib.sha256).hexdigest()
