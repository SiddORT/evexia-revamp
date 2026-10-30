"""Directory-key encrypted settlement documents with a separate AAD namespace."""
import base64
import json
import secrets
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.services.directory_inventory import DirectoryCryptoError
from app.services.immunotherapy import encode


def seal(keys, table, identity, value):
    nonce = secrets.token_bytes(12)
    aad = f"evexia:settlements:v1:{table}:{identity}".encode()
    data = AESGCM(keys.keys[keys.active]).encrypt(nonce, encode(value).encode(), aad)
    return f"v1:{keys.active}:{base64.b64encode(nonce + data).decode()}"


def unseal(keys, table, identity, value):
    try:
        version, key, raw = value.split(":")
        if version != "v1":
            raise ValueError()
        data = base64.b64decode(raw, validate=True)
        return json.loads(AESGCM(keys.keys[key]).decrypt(
            data[:12], data[12:], f"evexia:settlements:v1:{table}:{identity}".encode()))
    except Exception:
        raise DirectoryCryptoError() from None
