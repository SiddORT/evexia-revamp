"""Compatibility Zone policy; shared lock also orders all supported master operations."""
from sqlalchemy import text

ZONE_ACTIONS = frozenset({"zone.add", "zone.edit", "zone.delete", "zone.export", "zone.import"})


def zone_allowed(identity, action=None, protected=False):
    if (identity.user.is_protected_system_admin and identity.role == "super_admin"
            and "admin.access" in identity.permissions):
        return True
    grants = identity.permissions & ZONE_ACTIONS
    return (not protected and identity.staff is not None
            and (action in grants if action else bool(grants)))


def lock_policy(db):
    # A single transaction-scoped lock orders administrative revocation against
    # sensitive master operations. Acquire before User/Profile/Role/domain row locks.
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended('evexia:zone-policy:v1', 0))"))
