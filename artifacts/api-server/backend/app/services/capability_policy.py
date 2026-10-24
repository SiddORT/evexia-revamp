"""Shared, fail-closed policy for the explicitly approved workspace catalogue."""
from fastapi import HTTPException

from app.core.master_catalogue import RESOURCE_ACTIONS
from app.services.zone_policy import lock_policy


def is_super_admin(identity):
    return bool(identity.user.is_protected_system_admin and identity.role == "super_admin"
                and identity.user.is_active and "admin.access" in identity.permissions)


def allowed(identity, resource, action):
    if isinstance(action, tuple):
        return any(allowed(identity, resource, item) for item in action)
    if action not in RESOURCE_ACTIONS.get(resource, ()):
        return False
    return is_super_admin(identity) or bool(
        identity.staff is not None and f"{resource}.{action}" in identity.permissions)


def readable(identity, resource):
    """Legacy action grants retain minimum list/detail access, not auxiliary powers."""
    return any(allowed(identity, resource, action) for action in RESOURCE_ACTIONS.get(resource, ()))


def authorize(db, actor, resource, action=None, *, error=None):
    # Serialize revocation before identity, role and domain locks.
    from app.services.auth import revalidate_identity
    lock_policy(db)
    current = revalidate_identity(db, actor, lock=True)
    if not (readable(current, resource) if action is None else allowed(current, resource, action)):
        if error:
            raise error("Access denied", 403, "access_denied")
        raise HTTPException(403, "Access denied")
    return current
