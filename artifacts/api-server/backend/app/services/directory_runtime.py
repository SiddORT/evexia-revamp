"""Authorized-request crypto and bounded plaintext work; no persistent results."""
import hmac
import time
import uuid
import logging

from sqlalchemy import func, select, text
from app.core.config import get_settings
from app.services.directory_crypto import DirectoryCrypto
from app.services.directory_inventory import FIELDS, NULLABLE_FIELDS, DirectoryCryptoError
from app.services.directory_staging import _configuration_digest

SCAN_LIMIT = 500
EXPORT_SCAN_LIMIT = 10000


def crypto():
    return DirectoryCrypto(get_settings())


def ready(db):
    """Call only AFTER the existing consuming permission/session check."""
    engine = db.get_bind().engine
    logger = getattr(engine, "logger", None)
    if (engine.echo or logging.getLogger("sqlalchemy.engine.Engine").isEnabledFor(logging.INFO)
            or logging.getLogger("sqlalchemy.engine").isEnabledFor(logging.INFO)
            or (logger is not None and logger.isEnabledFor(logging.INFO))):
        raise DirectoryCryptoError()
    current = crypto()
    db.execute(text("SET LOCAL statement_timeout='5000ms'"))
    state = db.execute(text("SELECT phase,index_key_check,configuration_digest FROM directory_crypto_stage WHERE id=1")).one()
    if (not state.configuration_digest
            or not hmac.compare_digest(state.configuration_digest, _configuration_digest(current))
            or state.phase != "encrypted" or not state.index_key_check or not hmac.compare_digest(
            state.index_key_check, current._index("configuration", ["index-key-check"]))):
        raise DirectoryCryptoError()
    return current


def read_name(row, table, record_id=None):
    """Scalar label rows carry name_ciphertext and their AAD owner UUID."""
    return crypto().decrypt(table, record_id or row.id, "name", row.name_ciphertext)


def match(term, *values):
    term = term.strip().lower()
    return any(term in str(value or "").lower() for value in values)


def scan(db, model, clauses, matcher, *, limit=100, cursor=None, prepare=None):
    """UUID keyset: finite candidates/results; no complete match count."""
    start = time.monotonic()
    query = select(model).where(*clauses).order_by(model.id).limit(SCAN_LIMIT + 1)
    if cursor:
        query = query.where(model.id > uuid.UUID(str(cursor)))
    rows = list(db.scalars(query))
    if prepare:
        matcher = prepare(rows[:SCAN_LIMIT])
    items, last, examined = [], None, 0
    # Matcher may be a batch-prepared callable; it must not query per candidate.
    for row in rows[:SCAN_LIMIT]:
        if time.monotonic() - start > 5:
            raise DirectoryCryptoError()
        # Authenticate every classified value, even in a nonmatching row.
        for field in FIELDS.get(model.__tablename__, ()):
            getattr(row, field)
        examined += 1
        last = row.id
        if matcher(row):
            items.append(row)
        if len(items) == limit:
            break
    more = examined < len(rows)
    return items, dict(partial=True, scanned=examined,
                       nextCursor=str(last) if more and last else None)


class ExportLimitError(DirectoryCryptoError):
    def __init__(self):
        self.message = "Complete export exceeds the secure scan or file limit. Narrow the filters; nothing downloaded."
        self.status, self.code = 409, "directory_export_limit"


def complete(db, model, clauses, matcher, *, result_limit=5000, prepare=None):
    """Every matching record or explicit rejection; never a partial export."""
    start = time.monotonic()
    rows = list(db.scalars(select(model).where(*clauses).order_by(model.id).limit(EXPORT_SCAN_LIMIT + 1)))
    if len(rows) > EXPORT_SCAN_LIMIT:
        raise ExportLimitError()
    if prepare:
        matcher = prepare(rows)
    selected = []
    for row in rows:
        if time.monotonic() - start > 30:
            raise ExportLimitError()
        for field in FIELDS.get(model.__tablename__, ()):
            getattr(row, field)
        if matcher(row):
            selected.append(row)
            if len(selected) > result_limit:
                raise ExportLimitError()
    return selected


def exact_identity(db, body):
    normalized = db.scalar(select(func.lower(func.btrim(body.name))))
    return crypto().patient_identity_index(normalized, body.dialCountry, body.phone, body.dateOfBirth)
