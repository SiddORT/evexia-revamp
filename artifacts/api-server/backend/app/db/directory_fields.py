"""Ciphertext-only ORM persistence; plaintext exists only in request memory."""
import uuid
from sqlalchemy import String, Text, event, func, select
from sqlalchemy.orm import mapped_column, Session
from app.services.directory_inventory import FIELDS, INDEX_COLUMNS, NULLABLE_FIELDS
from app.services.directory_runtime import crypto


def install(model):
    # Mapped defaults run too late for AAD, and caller keyword order must not
    # change the record ID after a personal setter has encrypted a value.
    original_init = model.__init__
    def initialize(self, **values):
        record_id = values.pop("id", None) or uuid.uuid4()
        if model.__tablename__ == "mr_directory":
            values.setdefault("dialCountry", "IN")
        original_init(self, id=record_id, **values)
    model.__init__ = initialize
    table = model.__tablename__
    for field in FIELDS[table]:
        setattr(model, field + "_ciphertext", mapped_column(
            Text, nullable=(table, field) in NULLABLE_FIELDS))
        def get(row, f=field, t=table):
            return crypto().decrypt(t, row.id, f, getattr(row, f + "_ciphertext"))
        def put(row, value, f=field, t=table):
            if row.id is None:
                row.id = uuid.uuid4()
            setattr(row, f + "_ciphertext", crypto().encrypt(t, row.id, f, value))
        setattr(model, field, property(get, put))
    for field in INDEX_COLUMNS[table]:
        setattr(model, field, mapped_column(String(64), nullable=False,
                                           unique=field == "duplicate_identity_index",
                                           index=field != "duplicate_identity_index"))


@event.listens_for(Session, "before_flush")
def indexes(db, flush_context, instances):
    # Preserve race-safe DB uniqueness, and verify keys before any flush.
    # No per-row graph/reference reads. Only authoritative PostgreSQL name
    # normalization is evaluated for changed PII rows.
    for row in set(db.new) | set(db.dirty):
        table = getattr(row, "__tablename__", "")
        if table not in FIELDS:
            continue
        from app.services.directory_runtime import ready
        current = ready(db)
        # Validate every field, not ciphertext length, before persistence.
        values = {f: getattr(row, f) for f in FIELDS[table]}
        if table == "doctor_directory":
            from app.schemas.doctors import DoctorFields
            try:
                DoctorFields(**{f: getattr(row, f) for f in DoctorFields.model_fields})
            except ValueError:
                from app.services.directory_inventory import DirectoryCryptoError
                raise DirectoryCryptoError() from None
            row.state_index = current.doctor_state_index(values["state"])
        elif table == "mr_directory":
            from app.db.models import MRProfile, User
            profile = db.get(MRProfile, row.id)
            account = db.get(User, profile.user_id) if profile else None
            if account is None or (account.email or "") != values["email"]:
                raise DirectoryCryptoError()
            if row.contactRequirement == "required" and (not values["phone"] or not values["email"]):
                raise ValueError("Required directory contact unavailable")
            row.name_index = current.mr_name_index(db.scalar(select(func.lower(values["name"]))))
        else:
            row.duplicate_identity_index = current.patient_identity_index(
                db.scalar(select(func.lower(func.btrim(values["name"])))),
                values["dialCountry"], values["phone"], values["dateOfBirth"])
