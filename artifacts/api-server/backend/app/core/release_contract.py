"""One packaged schema/contract declaration, shared by source and images."""
import json
from pathlib import Path


def release_root():
    for parent in Path(__file__).resolve().parents:
        if (parent / "development-contract.json").is_file():
            return parent
    raise RuntimeError("Packaged release contract is missing")


ROOT = release_root()
CONTRACT_PATH = ROOT / "development-contract.json"


def contract():
    value = json.loads(CONTRACT_PATH.read_bytes())
    if (set(value) != {"format", "contract", "schema"} or value["format"] != 1
            or not all(isinstance(value[k], str) and value[k] for k in ("contract", "schema"))):
        raise RuntimeError("Invalid release declaration")
    return value
