"""Frozen legacy evidence rules shared by the read-only preflight and migration.

No identity inference from labels, assignments or timestamp proximity. Audit
timestamps lack mutation versions; edited roles require a complete chronological
chain AND exact final persisted timestamp evidence, otherwise manual review.
"""
import json
import uuid
from pathlib import Path

from sqlalchemy import text


class AttributionError(ValueError):
    pass


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise AttributionError("Duplicate mapping key; review the mapping file.")
        result[key] = value
    return result


def load_mapping(path):
    if not path:
        return {}
    try:
        data = json.loads(Path(path).read_text(), object_pairs_hook=_object)
        if not isinstance(data, dict):
            raise ValueError()
        result = {}
        for key, fields in data.items():
            role_id = uuid.UUID(key)
            if role_id in result or not isinstance(fields, dict) or not fields or set(fields) - {"created_by", "updated_by"}:
                raise ValueError()
            result[role_id] = {field: uuid.UUID(value) for field, value in fields.items()}
        return result
    except AttributionError:
        raise
    except Exception:
        raise AttributionError("Invalid mapping file. Use role UUID keys and only created_by/updated_by existing-user UUID fields.") from None


def reconcile(db, mapping=None):
    mapping = mapping or {}
    rows = list(db.execute(text(
        "SELECT id, version, created_at, updated_at FROM custom_roles ORDER BY id")).mappings())
    users = set(db.scalars(text("SELECT id FROM users")))
    role_ids = {row["id"] for row in rows}
    for role_id, fields in mapping.items():
        if role_id not in role_ids:
            raise AttributionError(f"Mapping references nonexistent role {role_id}.")
        if not fields or set(fields) - {"created_by", "updated_by"}:
            raise AttributionError(f"Invalid mapping fields for role {role_id}.")
        for field, actor in fields.items():
            if actor not in users:
                raise AttributionError(f"Role {role_id} {field}: mapped user {actor} does not exist.")
    events = {}
    for event in db.execute(text(
        "SELECT resource_id, actor_id, action, created_at FROM audit_events "
        "WHERE resource_type='custom_role' AND outcome='success' "
        "AND action IN ('role_create','role_update','role_permissions','role_delete') "
        "ORDER BY created_at")).mappings():
        events.setdefault(event["resource_id"], []).append(event)
    assignments = {}
    for staff in db.execute(text(
        "SELECT id, custom_role_id, status, workspace_login_enabled, deleted_at "
        "FROM staff_profiles WHERE custom_role_id IS NOT NULL ORDER BY id")).mappings():
        assignments.setdefault(staff["custom_role_id"], []).append(dict(
            staff_id=str(staff["id"]), status=staff["status"],
            login_enabled=staff["workspace_login_enabled"], deleted=staff["deleted_at"] is not None))
    report = []
    for row in rows:
        history = events.get(row["id"], [])
        creates = [e for e in history if e["action"] == "role_create"]
        safe_create = (len(creates) == 1 and creates[0]["created_at"] == row["created_at"]
                       and creates[0]["actor_id"] in users
                       and not any(e["action"] == "role_delete" or e["created_at"] < row["created_at"] for e in history))
        creator = creates[0]["actor_id"] if safe_create else None
        creator_reason = "verified_creation" if creator else "missing_conflicting_creation_or_nonexistent_actor"
        times = [e["created_at"] for e in history]
        complete = (safe_create and len(history) == row["version"]
                    and history[0]["action"] == "role_create"
                    and all(e["action"] in ("role_update", "role_permissions") for e in history[1:])
                    and all(e["actor_id"] in users for e in history)
                    and all(a < b for a, b in zip(times, times[1:])))
        updater = None
        if complete and row["version"] == 1 and row["updated_at"] == row["created_at"]:
            updater = creator
        elif complete and history[-1]["created_at"] == row["updated_at"]:
            updater = history[-1]["actor_id"]
        fields = {}
        for field, actor, reason in (
            ("created_by", creator, creator_reason),
            ("updated_by", updater, "verified_complete_mutation_chain" if updater else
             "incomplete_version_history_ambiguous_chronology_or_unproven_final_mutation"),
        ):
            if field in mapping.get(row["id"], {}):
                fields[field] = dict(user_id=str(mapping[row["id"]][field]), source="reviewed_mapping", reason="operator_reviewed")
            else:
                fields[field] = dict(user_id=str(actor) if actor else None,
                                     source="audit" if actor else "unresolved", reason=reason)
        report.append(dict(role_id=str(row["id"]), version=row["version"], fields=fields,
                           assignment_count=len(assignments.get(row["id"], [])),
                           assignments=assignments.get(row["id"], [])))
    return report


def coverage(report):
    fields = [field for role in report for field in role["fields"].values()]
    return dict(roles=len(report), automatic_fields=sum(f["source"] == "audit" for f in fields),
                reviewed_fields=sum(f["source"] == "reviewed_mapping" for f in fields),
                unresolved_fields=sum(f["source"] == "unresolved" for f in fields),
                assignment_blockers=sum(r["assignment_count"] for r in report))
