#!/usr/bin/env python3
"""Explicit development receipt initialization; never migrates or runs at startup.

Target confirmation and recovery attestations are operator-supplied authorization,
not evidence generated from the database being modified. No API session is forged.
The OS operator and protected ownership anchor are recorded separately.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "artifacts/api-server/backend"))
from sqlalchemy import select, text
from sqlalchemy.engine import make_url
from app.core.config import get_settings
from app.core.security import utcnow
from app.db.session import session_factory
from app.db.models import User, AuditEvent
from app.db.purchase_received_models import PurchaseReceipt
from app.db.inventory_models import InventoryReceiptState
from app.services import inventory, account_crypto
from app.services.purchase_received_crypto import ReceiptCrypto, PRError

# Same reviewed receipt initialization operation, on the explicitly reviewed
# product successor. No future schema or copied-target identity is accepted.
REVISION = "0052_hq_mr_zones_merge"


def require(value, message):
    if not value:
        raise RuntimeError(message)


def json_file(path):
    require(path.stat().st_size <= 2 * 1024 * 1024, "Operator document exceeds the bound")
    return json.loads(path.read_text())


def target_matches(db, expected):
    settings = get_settings()
    require(settings.app_env == "development", "Only development initialization is supported")
    url = make_url(settings.database_url)
    require(set(expected) == {"workspace", "host", "port", "database", "cluster", "oid"},
            "Independent target confirmation must include exactly workspace/host/port/database/cluster/oid")
    require(bool(expected["workspace"]) and os.environ.get("REPL_ID") == expected["workspace"],
            "Confirmed workspace differs")
    require((url.host, url.port or 5432, url.database) ==
            (expected["host"], expected["port"], expected["database"]), "Confirmed network/database target differs")
    row = db.execute(text("""SELECT current_database(),
        (SELECT oid FROM pg_database WHERE datname=current_database()),
        (SELECT system_identifier::text FROM pg_control_system())""")).one()
    require((row[0], row[1], row[2]) == (expected["database"], expected["oid"], expected["cluster"]),
            "Confirmed database identity differs")
    require(list(db.scalars(text("SELECT version_num FROM alembic_version"))) == [REVISION],
            "Exact automatically synchronized inventory schema revision required")


def anchor(db):
    rows = list(db.scalars(select(User).where(User.is_protected_system_admin.is_(True)).with_for_update()))
    require(len(rows) == 1 and rows[0].is_active and rows[0].system_role == "super_admin",
            "Existing active protected singleton required; no account is created")
    account_crypto.ready(db)
    return SimpleNamespace(user=rows[0], session_id=None)


def write_private(path, data):
    # Reports contain keyed review material; never put them in public artifacts.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(data, stream, indent=2)
        stream.write("\n")


def source_review():
    review = json_file(ROOT / "scripts/development-schema-review.json")
    require(review["target"] == REVISION, "Inventory source review is still pending")
    for revision, checksum in review["revisions"].items():
        paths = list((ROOT / "artifacts/api-server/backend/alembic/versions").glob(f"{revision}.py"))
        # Some historical filenames differ from literal revision names.
        if not paths:
            continue
        require(hashlib.sha256(paths[0].read_bytes()).hexdigest() == checksum, "Reviewed migration changed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--report", action="store_true")
    mode.add_argument("--apply-reviewed", type=Path)
    parser.add_argument("--target-confirmation", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="New private report path outside the repository")
    parser.add_argument("--after", type=uuid.UUID, help="Report page cursor")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--approve-initialization", action="store_true")
    parser.add_argument("--attest-restored-private-backup", action="store_true")
    parser.add_argument("--attest-key-recovery", action="store_true")
    parser.add_argument("--writers-stopped", action="store_true")
    args = parser.parse_args()
    require(1 <= args.limit <= 100, "Report bound must be 1–100 receipts")
    output = args.output.resolve()
    require(not output.is_relative_to(ROOT), "Operator reports must remain outside the repository")
    target = json_file(args.target_confirmation)
    source_review()
    if args.apply_reviewed:
        require(args.approve_initialization and args.attest_restored_private_backup
                and args.attest_key_recovery and args.writers_stopped,
                "Exact operation approval, current independently restored/private backup, recoverable keys and stopped writers are required")
        review = json_file(args.apply_reviewed)
        require(review["schema"] == REVISION and review["target"] == target, "Reviewed target differs")
        require(0 < len(review["items"]) <= 100, "Reviewed batch must contain 1–100 receipts")
        require(all(r["state"] in ("eligible", "current") for r in review["items"]),
                "Unavailable receipt evidence blocks this batch")
        require(len({r["receiptId"] for r in review["items"]}) == len(review["items"]),
                "Duplicate review identities")
        results = []
        # Each receipt commits atomically. A failure stops the batch; prior
        # commits remain evidenced and the same reviewed file is resumable.
        with session_factory()() as db:
            for item in review["items"]:
                try:
                    db.info["request_id"] = str(uuid.uuid4())
                    target_matches(db, target)
                    actor = anchor(db)  # User before inventory lock, as normal writers.
                    inventory.lock(db)
                    db.execute(text("SET LOCAL lock_timeout='5s'"))
                    row = db.get(PurchaseReceipt, uuid.UUID(item["receiptId"]))
                    require(row is not None, "Reviewed receipt is unavailable")
                    crypto = inventory.InventoryCrypto(get_settings())
                    data = ReceiptCrypto(get_settings()).open(row.id, "receipt", row.payload_ciphertext)
                    inventory.validate_initialization(db, row, data)
                    require(item["reviewToken"] in crypto.digests(data).values(), "Reviewed receipt changed")
                    state = db.get(InventoryReceiptState, row.id)
                    current = state and state.version == row.version
                    if not current:
                        inventory.reconcile_receipt(db, actor, data, initializing=True)
                        db.add(AuditEvent(actor_id=actor.user.id, session_id=None,
                            action="inventory_initialized", resource_type="purchase_received",
                            resource_id=row.id, outcome="success", request_id=db.info["request_id"],
                            reason="operator_initialization", created_at=utcnow()))
                    evidence = inventory.receipt_evidence(db, row, data)
                    require(all(r["matches"] for r in evidence), "Receipt ledger reconciliation failed")
                    db.commit()
                    results.append(dict(receiptId=str(row.id), state="already_current" if current else "initialized",
                                        reconciliation=evidence))
                except Exception:
                    db.rollback()
                    write_private(output, dict(schema=REVISION, target=target, state="incomplete",
                                               committed=results, failedReceiptId=item["receiptId"]))
                    raise RuntimeError("Initialization stopped; private report records prior commits. No complete coverage is claimed.") from None
            context = inventory.coverage(db)
        write_private(output, dict(schema=REVISION, target=target, state="batch_committed",
                                   items=results, coverage=context))
    else:
        with session_factory()() as db:
            db.execute(text("SET TRANSACTION READ ONLY"))
            target_matches(db, target)
            crypto = inventory.InventoryCrypto(get_settings())
            statement = select(PurchaseReceipt).order_by(PurchaseReceipt.id).limit(args.limit)
            if args.after:
                statement = statement.where(PurchaseReceipt.id > args.after)
            rows = list(db.scalars(statement))
            items = []
            for row in rows:
                try:
                    data = ReceiptCrypto(get_settings()).open(row.id, "receipt", row.payload_ciphertext)
                    inventory.validate_initialization(db, row, data)
                    state = db.get(InventoryReceiptState, row.id)
                    items.append(dict(receiptId=str(row.id), state="current" if state and state.version == row.version else "eligible",
                                      reviewToken=crypto.digests(data)[crypto.active],
                                      reconciliation=inventory.receipt_evidence(db, row, data)))
                except Exception:
                    items.append(dict(receiptId=str(row.id), state="unavailable", reviewToken=None))
            write_private(output, dict(schema=REVISION, target=target, items=items,
                after=str(rows[-1].id) if rows else None, coverage=inventory.coverage(db)))
    print("Inventory operator report saved privately. This is not migration or live application alignment evidence.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # No URLs, authored receipt values, key material or exception bodies.
        print("INVENTORY_INITIALIZATION_BLOCKED: inspect the approved target, review and recovery prerequisites.", file=sys.stderr)
        sys.exit(1)
