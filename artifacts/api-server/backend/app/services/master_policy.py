"""Explicit assignable master actions; labels never confer authority."""
from app.services.zone_policy import lock_policy

from app.core.master_catalogue import MASTERS, ACTIONS, MASTER_ACTIONS


def master_allowed(identity, resource, action=None, protected=False):
    if resource not in MASTERS or (action is not None and action not in ACTIONS):
        return False
    if (identity.user.is_protected_system_admin and identity.role == "super_admin"
            and "admin.access" in identity.permissions):
        return True
    if protected or identity.staff is None:
        return False
    return (f"{resource}.{action}" in identity.permissions if action else
            any(f"{resource}.{item}" in identity.permissions for item in ACTIONS))


def authorize_master(db, actor, resource, action=None, *, protected=False, lock=True, error=None):
    # Policy -> actor -> session -> staff -> role -> domain graph -> record.
    # Keep the existing lock key so old/new workers serialize during rollout.
    from app.services.auth import revalidate_identity
    from fastapi import HTTPException
    lock_policy(db)
    current = revalidate_identity(db, actor, lock=lock)
    if not master_allowed(current, resource, action, protected):
        if error:
            raise error("Access denied", 403, "access_denied")
        raise HTTPException(403, "Master access denied")
    return current
