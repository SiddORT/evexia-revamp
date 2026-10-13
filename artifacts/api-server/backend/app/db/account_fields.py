"""Plaintext Python properties with ciphertext-only mapped persistence."""
import uuid
from sqlalchemy import event
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.services import account_crypto as encrypted


def install(model):
    original_init = model.__init__

    def initialize(self, **values):
        original_init(self, id=values.pop("id", None) or uuid.uuid4(), **values)

    model.__init__ = initialize
    for field in ("email", "username"):
        def get(row, f=field):
            return encrypted.read(row.id, f, getattr(row, f + "_ciphertext"),
                                  getattr(row, f + "_index"))

        def put(row, value, f=field):
            if row.id is None:
                row.id = uuid.uuid4()
            # Avoid re-randomizing an unchanged immutable protected/staff field.
            if getattr(row, f + "_ciphertext") is not None and get_value(row, f) == value:
                return
            setattr(row, f + "_ciphertext", encrypted.crypto().encrypt(row.id, f, value))
            setattr(row, f + "_index", None if value is None
                    else encrypted.crypto().lookup_index(value.lower()))

        setattr(model, field, property(get, put))


def get_value(row, field):
    return encrypted.read(row.id, field, getattr(row, field + "_ciphertext"),
                          getattr(row, field + "_index"))


@event.listens_for(Session, "before_flush")
def validate_accounts(db, flush_context, instances):
    rows = [row for row in set(db.new) | set(db.dirty)
            if getattr(row, "__tablename__", "") == "users"]
    if not rows:
        return
    current = encrypted.ready(db)
    for row in rows:
        for field in ("email", "username"):
            value = get_value(row, field)
            normalized = None if value is None else db.scalar(select(func.lower(value)))
            if value is not None and normalized != value.lower():
                raise encrypted.AccountCryptoError()
            expected = None if value is None else current.lookup_index(normalized)
            if getattr(row, field + "_index") != expected:
                raise encrypted.AccountCryptoError()


@event.listens_for(Session, "do_orm_execute")
def reject_plaintext_bulk_identifiers(state):
    """ORM bulk inserts ignore Python properties: never silently lose them."""
    mapper = state.bind_mapper
    if mapper is None or getattr(mapper.class_, "__tablename__", "") != "users":
        return
    if not (state.is_insert or state.is_update):
        return
    parameters = state.parameters
    records = parameters if isinstance(parameters, list) else [parameters or {}]
    keys = set().union(*(set(row) for row in records))
    keys.update(getattr(key, "key", key) for key in (getattr(state.statement, "_values", None) or {}))
    if keys & {"email", "username"}:
        raise encrypted.AccountCryptoError("Bulk plaintext account identifiers are unsupported; use the User model.")
    if state.is_update and keys & {"email_ciphertext", "username_ciphertext", "email_index", "username_index"}:
        raise encrypted.AccountCryptoError("Bulk identifier changes are unsupported; use the User model.")
