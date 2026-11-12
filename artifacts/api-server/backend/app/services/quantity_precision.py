"""Read-only access to the explicit, immutable quantity precision boundary."""
import hashlib
from decimal import Decimal
from sqlalchemy import text, bindparam
from app.services.purchase_received_crypto import PRError

POLICY = "business_quantity_hundredths_half_up_v1"


def source_digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def ciphertext(db, purpose, identity, original, decoder=None):
    row = db.execute(text("""
        SELECT original_digest,original_ciphertext,normalized_ciphertext FROM quantity_precision_snapshots
        WHERE purpose=:purpose AND record_id=:identity
    """), {"purpose": purpose, "identity": identity}).mappings().one_or_none()
    # Later deliberate writes cease matching their original boundary snapshot.
    # The original archive stays immutable, never updated during reads.
    same_source = row and (row["original_digest"] == source_digest(original)
                          or decoder is not None and decoder(row["original_ciphertext"]) == decoder(original))
    return row["normalized_ciphertext"] if same_source else original


def ready(db):
    policy = db.execute(text("SELECT policy FROM quantity_precision_boundary WHERE id=1")).scalar_one_or_none()
    if policy != POLICY:
        raise PRError("The coordinated quantity precision transition is unavailable. Your draft is preserved.",
                      503, "quantity_precision_unavailable")


def checkpoints(db, kind, identities):
    if not identities:
        return []
    return db.execute(text("""
        SELECT p.*,b.created_at FROM quantity_precision_locations p
        CROSS JOIN quantity_precision_boundary b
        WHERE b.id=1 AND p.kind=:kind AND p.owner_id IN :identities
        ORDER BY p.owner_id,p.location_key
    """).bindparams(bindparam("identities", expanding=True)),
        {"kind": kind, "identities": list(identities)}).mappings().all()


def reserve_baseline(db, identity):
    rows = checkpoints(db, "reserve", [identity])
    return {r["location_key"]: Decimal(r["normalized"]) for r in rows} if rows else None


def source_residual(db, identity):
    value = db.scalar(text("SELECT residual FROM quantity_precision_locations WHERE kind='source' AND owner_id=:id"), {"id": identity})
    return Decimal(value) if value is not None else Decimal(0)


def verify_chain(postings, balances, boundaries):
    """Verify old exact chains, cross each checkpoint once, verify successors."""
    from collections import defaultdict
    from app.schemas.quantities import rounded_quantity
    chain = defaultdict(lambda: Decimal(0))
    boundary = {(r["owner_id"], r["location_key"] or None): r for r in boundaries}
    crossed = set()
    seen = set()
    for row in postings:
        key = (row.lot_id, str(row.location_id) if row.location_id else None)
        if row.id in seen:
            raise PRError("Duplicate posting identity.", 409, "inventory_history_gap")
        seen.add(row.id)
        if row.precision_epoch == 2:
            if key not in crossed:
                checkpoint = boundary.get(key)
                if checkpoint:
                    if chain[key] != checkpoint["original"]:
                        raise PRError("Precision checkpoint differs from retained stock history.", 409, "inventory_history_gap")
                    chain[key] = checkpoint["normalized"]
                elif chain[key]:
                    raise PRError("Legacy stock is missing its precision checkpoint.", 409, "inventory_history_gap")
                crossed.add(key)
            if any(v != rounded_quantity(v) for v in (row.before, row.delta, row.after)):
                raise PRError("A new posting is not canonical hundredths.", 409, "inventory_history_gap")
        elif row.precision_epoch != 1 or key in crossed:
            raise PRError("Posting precision epochs are inconsistent.", 409, "inventory_history_gap")
        if row.before != chain[key] or row.after != row.before + row.delta:
            raise PRError("Recorded lot/location posting chain is inconsistent.", 409, "inventory_history_gap")
        chain[key] = row.after
    for key, checkpoint in boundary.items():
        if key not in crossed:
            if chain[key] != checkpoint["original"]:
                raise PRError("Precision checkpoint differs from retained history.", 409, "inventory_history_gap")
            chain[key] = checkpoint["normalized"]
    actual = {(b.lot_id, str(b.location_id) if b.location_id else None): b.quantity for b in balances}
    if any(chain[k] != actual.get(k, Decimal(0)) for k in chain.keys() | actual.keys()):
        raise PRError("Precision-aware history does not reconcile to current stock.", 409, "inventory_history_gap")
    return chain
