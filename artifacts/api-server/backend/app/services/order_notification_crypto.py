"""Directory-key custody with a notification-specific immutable AAD namespace."""
import base64
import json
import secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.services.directory_inventory import DirectoryCryptoError


def seal(keys, identity, payload):
    nonce = secrets.token_bytes(12)
    aad = f"evexia:order-notification:v1:{identity}".encode()
    data = AESGCM(keys.keys[keys.active]).encrypt(
        nonce, json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode(), aad)
    return f"v1:{keys.active}:{base64.b64encode(nonce + data).decode()}"


def unseal(keys, identity, value):
    try:
        version, key, raw = value.split(":")
        if version != "v1":
            raise ValueError()
        data = base64.b64decode(raw, validate=True)
        return json.loads(AESGCM(keys.keys[key]).decrypt(
            data[:12], data[12:], f"evexia:order-notification:v1:{identity}".encode()))
    except Exception:
        raise DirectoryCryptoError() from None
