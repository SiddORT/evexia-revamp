"""Cross-process bounded slots and per-object operation leases, no row locks."""
from contextlib import contextmanager

from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from app.services.file_policy import FileError


@contextmanager
def operation(db: Session, settings, file_id):
    bind = db.get_bind()
    engine = bind.engine if isinstance(bind, Connection) else bind
    # Separate held connection: business commits must not release session locks
    # back to the pool while an object operation is still in progress.
    with engine.connect() as conn:
        held = []
        try:
            file_key = f"evexia-file:{file_id}"
            def claim(key):
                ok = conn.scalar(text("SELECT pg_try_advisory_lock(hashtextextended(:key, 0))"), {"key": key})
                conn.commit()
                if ok:
                    held.append(key)
                return ok
            if not claim(file_key):
                raise FileError(409, "operation_busy", "File operation already in progress")
            for slot in range(settings.file_concurrency_limit):
                if claim(f"evexia-file-slot:{slot}"):
                    break
            else:
                raise FileError(429, "file_capacity", "File capacity exceeded; retry later")
            yield
        finally:
            for key in reversed(held):
                conn.execute(text("SELECT pg_advisory_unlock(hashtextextended(:key, 0))"), {"key": key})
            conn.commit()