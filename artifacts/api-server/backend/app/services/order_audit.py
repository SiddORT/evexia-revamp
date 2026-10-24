"""Server-owned order attribution, resolved in bounded encrypted-account batches."""
import uuid
from sqlalchemy import select
from app.db.models import User
from app.services.account_crypto import read, ready


def metadata(row):
    def stamp(value):
        return value.isoformat() if value else None
    return {
        "createdBy": str(row.created_by) if row.created_by else None,
        "createdAt": stamp(row.created_at),
        "updatedBy": str(row.updated_by) if row.updated_by else None,
        "updatedAt": stamp(row.updated_at),
    }


def present(db, actor, value):
    """Only called on already authorized projections, never untrusted imports."""
    audits = []
    def collect(node):
        if isinstance(node, list):
            for child in node:
                collect(child)
        elif isinstance(node, dict):
            if "audit" in node:
                audits.append(node)
            for key, child in node.items():
                if key != "audit":
                    collect(child)
    collect(value)
    if not audits:
        return value
    if actor.mr is not None:
        for node in audits:
            node.pop("audit", None)
            if isinstance(node.get("approval"), dict):
                node["approval"] = {**node["approval"], "approvedBy": "Admin"}
        return value
    ids = sorted({uuid.UUID(audit[key]) for node in audits
                  if isinstance((audit := node.get("audit")), dict)
                  for key in ("createdBy", "updatedBy") if audit.get(key)})
    ids = sorted(set(ids) | {uuid.UUID(node["approval"]["approvedBy"]) for node in audits
        if isinstance(node.get("approval"), dict) and node["approval"].get("approvedBy")})
    labels = {}
    if ids:
        ready(db)
    for start in range(0, len(ids), 200):
        # Do not load credentials, private contact addresses or whole directories.
        rows = db.execute(select(User.id, User.username_ciphertext, User.username_index).where(
            User.id.in_(ids[start:start + 200])))
        for row in rows:
            labels[str(row.id)] = read(row.id, "username", row.username_ciphertext, row.username_index)
    for node in audits:
        if isinstance(node.get("approval"), dict):
            node["approval"] = {**node["approval"], "approvedBy": labels.get(node["approval"].get("approvedBy"))}
        audit = node.get("audit")
        if isinstance(audit, dict):
            node["audit"] = {**audit, **{key: labels.get(audit.get(key)) for key in ("createdBy", "updatedBy")}}
    return value
