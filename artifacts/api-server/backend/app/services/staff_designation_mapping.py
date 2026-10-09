"""Historical SQL only: read-only reconciliation shared by operator and migration.

No ORM staff projection, decryption, credentials or catalogue mutation is used.
"""
import json
import uuid
from pathlib import Path

from sqlalchemy import text


class MappingError(ValueError):
    pass


def load_overrides(path):
    if not path:
        return {}
    source = Path(path)
    if source.stat().st_size > 2 * 1024 * 1024:
        raise MappingError("Mapping file exceeds 2 MiB.")
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise MappingError("Duplicate mapping keys are not allowed.")
            result[key] = value
        return result
    try:
        value = json.loads(source.read_text(encoding="utf-8"), object_pairs_hook=pairs)
        if not isinstance(value, dict) or any(not isinstance(target, str) for target in value.values()):
            raise ValueError()
        return {key: str(uuid.UUID(target)) for key, target in value.items()}
    except (ValueError, TypeError, UnicodeError):
        raise MappingError("Mapping must be a JSON object of exact legacy labels to existing UUIDs.") from None


def reconcile(db, overrides=None):
    overrides = overrides or {}
    norm = lambda col: f"lower(btrim(regexp_replace({col}, '\\s+', ' ', 'g')))"
    rows = db.execute(text(f"""
        WITH labels AS (
            SELECT designation, count(*) AS affected FROM staff_profiles GROUP BY designation
        )
        SELECT l.designation, l.affected, d.id, d.name, d.status, d.deleted_at
        FROM labels l LEFT JOIN designations d ON {norm('l.designation')} = {norm('d.name')}
        ORDER BY l.designation NULLS FIRST, d.id
    """)).mappings()
    groups = {}
    for row in rows:
        label = row["designation"]
        group = groups.setdefault(label, dict(legacy_value=label, affected=row["affected"], candidates=[]))
        if row["id"] is not None:
            group["candidates"].append(dict(id=str(row["id"]), name=row["name"], status=row["status"],
                                            deleted=row["deleted_at"] is not None))
    # Validate ALL overrides, including redundant ones; never ignore typos.
    targets = set(str(value) for value in db.scalars(text("SELECT id FROM designations")))
    for label, target in overrides.items():
        if label not in groups or not isinstance(target, str) or target not in targets:
            raise MappingError("Invalid override: every exact label must exist in staff and every target UUID must exist in the catalogue.")
    resolved, unresolved = {}, []
    for label, group in groups.items():
        if label is None or not label.strip():
            group["reason"] = "missing_value"
        elif label in overrides:
            resolved[label] = overrides[label]
            continue
        elif len(group["candidates"]) == 1:
            resolved[label] = group["candidates"][0]["id"]
            continue
        else:
            group["reason"] = "unmatched" if not group["candidates"] else "ambiguous"
        unresolved.append(group)
    return resolved, unresolved
