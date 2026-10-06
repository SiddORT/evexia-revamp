"""Single-query, all-or-nothing exports of explicit safe reporting columns."""
from datetime import timezone

from fastapi import HTTPException

from app.repositories import reporting

EXPORT_LIMIT = 5000
SESSION_COLUMNS = [
    "User", "Role", "Account state", "State", "Created / login (UTC)",
    "Last refreshed (UTC)", "Expires (UTC)", "Revoked (UTC)",
    "Persistent", "Current session", "Provenance",
]
EVENT_COLUMNS = [
    "Occurred (UTC)", "User", "Role", "Account state", "Action", "Outcome",
    "Reason", "Resource type", "Provenance",
]


def timestamp(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if value is not None else ""


def export_report(db, resource, now, current_id, selection, q="", state=None):
    # One SELECT (limit+1), never stitch shifting offset pages together.
    result = (reporting.sessions(db, now, current_id, EXPORT_LIMIT, 0, *selection, q, state)
              if resource == "sessions"
              else reporting.events(db, EXPORT_LIMIT, 0, *selection))
    if result["has_more"]:
        raise HTTPException(409, "Too many rows to export. Narrow the user or UTC date filters.")
    rows = []
    for item in result["items"]:
        user = item["user"] or {}
        actor = [user.get("label") or "Unknown/System",
                 user.get("role") or "", user.get("account_state") or ""]
        if resource == "sessions":
            rows.append([
                *actor, item["state"],
                *[timestamp(item[key]) for key in (
                    "created_at", "last_refreshed_at", "expires_at", "revoked_at")],
                "Yes" if item["persistent"] else "No",
                "Yes" if item["is_current"] else "No", "Server-recorded",
            ])
        else:
            rows.append([
                timestamp(item["created_at"]), *actor,
                item["action"], item["outcome"], item["reason"] or "",
                item["resource_type"] or "",
                "Browser-reported" if item["reason"] == "browser_reported" else "Server-recorded",
            ])
    return {
        "columns": SESSION_COLUMNS if resource == "sessions" else EVENT_COLUMNS,
        "rows": rows, "row_count": len(rows), "limit": EXPORT_LIMIT,
    }
