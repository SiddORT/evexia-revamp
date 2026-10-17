"""Independent PR AES-GCM payloads; keys are validated per authorized operation."""
import base64
import hashlib
import hmac
import json
import re
import secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class PRError(Exception):
    def __init__(self, message="Encrypted Purchase Received storage is unavailable. Contact the operator; your draft is preserved.", status=503, code="pr_unavailable"):
        self.message, self.status, self.code = message, status, code


class ReceiptCrypto:
    def __init__(self, settings):
        try:
            raw = json.loads(settings.pr_encryption_keys.get_secret_value())
            self.active = settings.pr_encryption_key_id
            if not isinstance(raw, dict) or not raw or any(not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", k) for k in raw):
                raise ValueError()
            self.keys = {k: base64.b64decode(v, validate=True) for k, v in raw.items()}
            if self.active not in self.keys or any(len(v) != 32 for v in self.keys.values()) or len(set(self.keys.values())) != len(self.keys):
                raise ValueError()
            for name in ("staff_encryption_keys", "directory_encryption_keys", "communication_encryption_keys"):
                other = getattr(settings, name, None)
                if other and any(base64.b64decode(v, validate=True) in self.keys.values() for v in json.loads(other.get_secret_value()).values()):
                    raise ValueError()
            if any(k == settings.signing_key.encode() or base64.b64encode(k).decode() == settings.signing_key for k in self.keys.values()):
                raise ValueError()
            for name in ("staff_email_index_key", "directory_index_key"):
                other = getattr(settings, name, None)
                if other and base64.b64decode(other.get_secret_value(), validate=True) in self.keys.values():
                    raise ValueError()
        except Exception:
            raise PRError() from None

    def seal(self, record_id, field, data):
        nonce = secrets.token_bytes(12)
        encoded = json.dumps(data, sort_keys=True, default=str).encode()
        encrypted = AESGCM(self.keys[self.active]).encrypt(nonce, encoded, f"evexia:pr:v1:{record_id}:{field}".encode())
        return f"v1:{self.active}:{base64.b64encode(nonce + encrypted).decode()}"

    def open(self, record_id, field, value):
        try:
            version, key, encoded = value.split(":")
            if version != "v1":
                raise ValueError()
            raw = base64.b64decode(encoded, validate=True)
            plain = AESGCM(self.keys[key]).decrypt(raw[:12], raw[12:], f"evexia:pr:v1:{record_id}:{field}".encode())
            return json.loads(plain)
        except Exception:
            raise PRError() from None

    def digests(self, data):
        raw = json.dumps(data, sort_keys=True, separators=(",", ":"), default=str).encode()
        return {key: hmac.new(value, b"evexia:pr:digest:v1:" + raw, hashlib.sha256).hexdigest() for key, value in self.keys.items()}
