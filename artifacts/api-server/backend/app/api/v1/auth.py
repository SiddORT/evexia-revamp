from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.deps import current_identity, require_cookie_origin
from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.schemas.auth import ChangePasswordRequest, CurrentUser, LoginRequest, TokenResponse, SessionResponse, SessionListResponse
from app.repositories import sessions as repository
from app.services import auth as service
from app.services.auth import Identity

router = APIRouter(prefix="/auth", tags=["authentication"])


def set_refresh_cookie(response: Response, token: str, settings: Settings,
                       persistent: bool, expires_at: datetime | None = None) -> None:
    production = settings.app_env == "production"
    response.set_cookie(
        "__Host-evexia_refresh" if production else "evexia_refresh",
        token, httponly=True, secure=production, samesite="strict",
        path="/" if production else "/api/v1/auth",
        **({"max_age": max(1, int((expires_at - service.utcnow()).total_seconds()))}
           if persistent and expires_at else {}),
    )
    response.headers["Cache-Control"] = "no-store"


def clear_refresh_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        "__Host-evexia_refresh" if settings.app_env == "production" else "evexia_refresh",
        path="/" if settings.app_env == "production" else "/api/v1/auth",
        secure=settings.app_env == "production", httponly=True, samesite="strict",
    )


def refresh_cookie(request: Request, settings: Settings) -> str | None:
    return request.cookies.get("__Host-evexia_refresh" if settings.app_env == "production" else "evexia_refresh")


@router.post("/register", status_code=403, dependencies=[Depends(require_cookie_origin)])
def register():
    # Privileged system identities are provisioned only through protected operator flows.
    raise HTTPException(status_code=403, detail="Registration is unavailable")


@router.post("/login", response_model=TokenResponse, dependencies=[Depends(require_cookie_origin)])
def login(body: LoginRequest, request: Request, response: Response,
          db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    try:
        identity, refresh = service.login(
            db, body.identifier, body.password, settings,
            body.remember_me,
            request.state.request_id, request.client.host if request.client else "unknown",
        )
    except service.TooManyAttempts:
        raise HTTPException(status_code=429, detail="Too many attempts. Try again later.") from None
    except service.AuthError:
        raise HTTPException(status_code=401, detail="Invalid credentials") from None
    session = service.refresh_session(db, refresh)
    set_refresh_cookie(response, refresh, settings, body.remember_me, session.family_expires_at)
    return service.token_response(identity, settings)


@router.post("/refresh", response_model=TokenResponse, dependencies=[Depends(require_cookie_origin)])
def refresh(request: Request, response: Response,
            db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    value = refresh_cookie(request, settings)
    if not value:
        repository.event(db, "refresh_rejected", "failure", request.state.request_id, reason="missing_cookie")
        db.commit()
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        identity, new_value = service.rotate_refresh(db, value, settings, request.state.request_id)
    except service.AuthError as exc:
        expired = JSONResponse({"error": {
            "code": "authentication_required", "message": "Authentication required",
            "request_id": request.state.request_id, "fields": [],
        }}, status_code=401, headers={
            "Cache-Control": "no-store",
            **({"X-Session-Reason": "replaced"} if isinstance(exc, service.SessionReplaced) else {}),
        })
        clear_refresh_cookie(expired, settings)
        return expired
    session = service.refresh_session(db, new_value)
    set_refresh_cookie(response, new_value, settings, session.persistent, session.family_expires_at)
    return service.token_response(identity, settings)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_cookie_origin)])
def logout(request: Request, response: Response,
           db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    service.logout(db, refresh_cookie(request, settings), request.state.request_id)
    clear_refresh_cookie(response, settings)
    response.headers["Cache-Control"] = "no-store"


@router.get("/me", response_model=CurrentUser)
def me(identity: Identity = Depends(current_identity)):
    return identity.public()


def session_public(row) -> SessionResponse:
    return SessionResponse(
        id=row.id, status=("EXPIRED" if row.status == "ACTIVE" and row.expires_at <= service.utcnow()
                           else row.status),
        created_at=row.created_at, last_refreshed_at=row.last_refreshed_at,
        expires_at=row.expires_at, persistent=row.persistent,
    )


@router.get("/session", response_model=SessionResponse)
def current_session(identity: Identity = Depends(current_identity), db: Session = Depends(get_db)):
    row = repository.get_session(db, identity.session_id)
    if row is None or row.user_id != identity.user.id:
        raise HTTPException(status_code=401, detail="Authentication required")
    return session_public(row)


@router.get("/sessions", response_model=SessionListResponse)
def own_sessions(limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0, le=10000),
                 identity: Identity = Depends(current_identity), db: Session = Depends(get_db)):
    rows = repository.sessions_for_user(db, identity.user.id, limit, offset)
    return SessionListResponse(items=[session_public(row) for row in rows], limit=limit, offset=offset)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(body: ChangePasswordRequest, request: Request, response: Response,
                    identity: Identity = Depends(current_identity), db: Session = Depends(get_db)):
    try:
        service.change_password(db, identity, body.current_password, body.new_password, request.state.request_id)
    except service.AuthError:
        raise HTTPException(status_code=400, detail="Password could not be changed") from None
    clear_refresh_cookie(response, get_settings())
    response.headers["Cache-Control"] = "no-store"

