from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from fastapi import Request

from app.core.config import get_settings


@lru_cache
def session_factory() -> sessionmaker[Session]:
    url = get_settings().database_url
    if not url.startswith(("postgresql://", "postgresql+psycopg://")):
        raise ValueError("DATABASE_URL must be PostgreSQL")
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    engine = create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5,
                           hide_parameters=True)
    return sessionmaker(engine, expire_on_commit=False)


def get_db(request: Request):
    with session_factory()() as db:
        db.info["request_id"] = getattr(request.state, "request_id", None)
        yield db