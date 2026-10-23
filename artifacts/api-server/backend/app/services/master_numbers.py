"""Server-owned, non-transactional allocations; rollback may leave safe gaps.

Every caller holds the MR directory graph lock. Authored Patient imports advance
the same sequence before any generated rows in that batch are inserted.
"""
import re
from sqlalchemy import text

SEQUENCES = {
    "patient": ("patient_number_seq", "PAT"),
    "doctor": ("doctor_number_seq", "DR"),
    "mr": ("mr_login_number_seq", "MR"),
}


def allocate(db, kind):
    sequence, prefix = SEQUENCES[kind]
    value = db.scalar(text(f"SELECT nextval('{sequence}')"))
    return f"{prefix}-{value:03d}"


def reserve_patient_import(db, code):
    reserve_authored(db, "patient", code)


def reserve_authored(db, kind, code):
    sequence, prefix = SEQUENCES[kind]
    if code and re.fullmatch(prefix + r"-[0-9]+", code, re.IGNORECASE):
        value = int(code[len(prefix) + 1:])
        if value > 9223372036854775807:
            from app.services.mrs import MRError
            raise MRError("Numeric master identifier exceeds the supported sequence range.", 422, "master_number_range")
        # All generated and imported directory writes share the graph lock.
        # setval is deliberately not rolled back: failed imports cannot recycle.
        db.execute(text(
            f"SELECT setval('{sequence}', GREATEST(last_value, :value), "
            f"is_called OR :value >= last_value) FROM {sequence}"
        ), {"value": max(1, value)})
