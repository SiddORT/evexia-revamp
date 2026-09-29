from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db

router = APIRouter(tags=["system"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/version")
def version():
    return {"api": "v1"}


@router.get("/health/readiness")
def readiness(db: Session = Depends(get_db)):
    try:
        # Deployment health must verify the identity schema, not just a live socket.
        db.execute(text("SELECT username FROM users LIMIT 0"))
        for table in ("organizations", "memberships", "refresh_sessions", "login_attempts", "audit_events"):
            db.execute(text(f"SELECT 1 FROM {table} LIMIT 0"))
    except Exception:
        raise HTTPException(status_code=503, detail="Service unavailable") from None
    return {"status": "ready"}