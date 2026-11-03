"""Server-owned placement labels, independent of IT/SUB/inventory identities."""
from sqlalchemy import text


def issue(db, data, previous, *, order_date):
    # Edits retain the exact envelope, including placement dosage, even when the
    # current dosage changes. Legacy edits never issue or backfill a batch.
    if previous is not None:
        if previous.get("orderBatch") is not None:
            data["orderBatch"] = previous["orderBatch"]
        return
    # PostgreSQL locks the conflicting month row through the enclosing commit.
    # Unlike nextval, the increment rolls back with failed placement/savepoints.
    # Unconstrained NUMERIC has no four-digit or machine-integer rollover.
    ordinal = int(db.scalar(text("""
        INSERT INTO immunotherapy_batch_counters (month, last_ordinal)
        VALUES (:month, 1)
        ON CONFLICT (month) DO UPDATE
        SET last_ordinal = immunotherapy_batch_counters.last_ordinal + 1
        RETURNING last_ordinal
    """), {"month": order_date.replace(day=1)}))
    dosage = data["dosage"]
    data["orderBatch"] = {
        "number": f"E | {dosage} | {order_date.month:02d} | {ordinal:04d}",
        "year": order_date.year, "month": order_date.month,
        "ordinal": str(ordinal), "dosage": dosage,
    }
