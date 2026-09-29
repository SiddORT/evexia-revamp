from collections.abc import Callable

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.services.auth import AuthError, Identity, identity_from_token

bearer = HTTPBearer(auto_error=False)


def current_identity(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Identity:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Authentication required", headers={"WWW-Authenticate": "Bearer"})
    try:
        return identity_from_token(db, credentials.credentials, settings)
    except AuthError:
        raise HTTPException(status_code=401, detail="Authentication required", headers={"WWW-Authenticate": "Bearer"}) from None


def require_roles(*roles: str) -> Callable:
    def check(identity: Identity = Depends(current_identity)) -> Identity:
        if identity.membership.role not in roles:
            raise HTTPException(status_code=403, detail="Access denied")
        return identity
    return check


def require_cookie_origin(request: Request, settings: Settings = Depends(get_settings)) -> None:
    origin = request.headers.get("origin")
    own_origin = str(request.base_url).rstrip("/")
    if not origin or origin.rstrip("/") not in (own_origin, *settings.allowed_origins):
        raise HTTPException(status_code=403, detail="Origin not allowed")