"""Non-secret identity of candidate source versus the already loaded process."""
import hashlib
import json
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
ROOT = APP.parents[3]
MANIFEST = ROOT / "development-contract.json"


def candidate_identity():
    raw = MANIFEST.read_bytes()
    contract = json.loads(raw)
    if (set(contract) != {"format", "contract", "schema"}
            or contract["format"] != 1
            or not all(isinstance(contract[k], str) and contract[k] for k in ("contract", "schema"))):
        raise ValueError()
    digest = hashlib.sha256(raw)
    for path in sorted(APP.rglob("*.py")):
        digest.update(path.relative_to(APP).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
    return {**contract, "source": digest.hexdigest()}


# Captured once, not a working-tree identifier read on each /version request.
LOADED_IDENTITY = candidate_identity()
