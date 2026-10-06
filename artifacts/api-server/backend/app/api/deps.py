from collections.abc import Callable

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.repositories.sessions import event
from app.services.auth import AuthError, Identity, SessionReplaced, identity_from_token

bearer = HTTPBearer(auto_error=False)

# Permission names are the policy surface; role names are only principals mapped
# into permissions. File-specific object checks belong to the file service.
PERMISSION_ROLES = {
    "admin.access": frozenset({"super_admin"}),
    "staff.manage": frozenset({"super_admin"}),
    "domain.provision": frozenset({"super_admin"}),
    "domain.assign_patient": frozenset({"super_admin"}),
}


def current_identity(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Identity:
    if not credentials or credentials.scheme.lower() != "bearer":
        event(db, "authentication_rejection", "failure", db.info.get("request_id"), reason="missing_bearer")
        db.commit()
        raise HTTPException(status_code=401, detail="Authentication required", headers={"WWW-Authenticate": "Bearer"})
    try:
        return identity_from_token(db, credentials.credentials, settings)
    except AuthError as exc:
        headers = {"WWW-Authenticate": "Bearer", "Cache-Control": "no-store"}
        if isinstance(exc, SessionReplaced):
            headers["X-Session-Reason"] = "replaced"
        raise HTTPException(status_code=401, detail="Authentication required", headers=headers) from None


def require_roles(*roles: str) -> Callable:
    def check(identity: Identity = Depends(current_identity)) -> Identity:
        if identity.role not in roles:
            raise HTTPException(status_code=403, detail="Access denied")
        return identity
    return check


def require_permissions(*permissions: str) -> Callable:
    allowed_roles = set.intersection(
        *(set(PERMISSION_ROLES.get(permission, ())) for permission in permissions)
    ) if permissions else set()

    def check(identity: Identity = Depends(current_identity)) -> Identity:
        if not permissions or any(permission not in PERMISSION_ROLES for permission in permissions):
            raise HTTPException(status_code=403, detail="Access denied")
        if identity.role not in allowed_roles or any(
            permission not in identity.permissions for permission in permissions
        ):
            raise HTTPException(status_code=403, detail="Access denied")
        return identity

    return check


def require_cookie_origin(request: Request, settings: Settings = Depends(get_settings)) -> None:
    origin = request.headers.get("origin")
    own_origin = str(request.base_url).rstrip("/")
    if not origin or origin.rstrip("/") not in (own_origin, *settings.allowed_origins):
        raise HTTPException(status_code=403, detail="Origin not allowed")