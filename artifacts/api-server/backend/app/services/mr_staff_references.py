"""Minimal Staff names under consuming MR permissions, never Staff management."""
import time
from sqlalchemy import select
from app.db.staff_models import StaffProfile
from app.services.staff_crypto import StaffCrypto
from app.core.config import get_settings
from app.services.directory_runtime import SCAN_LIMIT


def name_crypto():
    return StaffCrypto(get_settings())


def choices(db, query, limit, cursor=None, include_saved=None):
    crypto = name_crypto()
    statement = select(StaffProfile.id, StaffProfile.name_ciphertext, StaffProfile.status,
                       StaffProfile.deleted_at).where(
        StaffProfile.deleted_at.is_(None), StaffProfile.status == "active").order_by(
        StaffProfile.id).limit(SCAN_LIMIT + 1)
    if cursor:
        statement = statement.where(StaffProfile.id > cursor)
    rows = list(db.execute(statement))
    items, examined, last = [], 0, None
    started = time.monotonic()
    for row in rows[:SCAN_LIMIT]:
        if time.monotonic() - started > 5:
            from app.services.mrs import MRError
            raise MRError("Staff name search exceeded its bounded section. Retry.", 503)
        name = crypto.decrypt(row.id, "name", row.name_ciphertext)
        examined += 1
        last = row.id
        if query.strip().casefold() in name.casefold():
            items.append(dict(id=row.id, name=name, status=row.status, deleted=False))
        if len(items) == limit:
            break
    if include_saved and all(item["id"] != include_saved for item in items):
        saved = db.execute(select(StaffProfile.id, StaffProfile.name_ciphertext, StaffProfile.status,
                                  StaffProfile.deleted_at).where(StaffProfile.id == include_saved)).first()
        if saved:
            items.append(dict(id=saved.id, name=crypto.decrypt(saved.id, "name", saved.name_ciphertext),
                              status=saved.status, deleted=bool(saved.deleted_at)))
    return dict(items=items, total=None, offset=0, limit=limit, partial=True, scanned=examined,
                nextCursor=str(last) if examined < len(rows) and last else None)
