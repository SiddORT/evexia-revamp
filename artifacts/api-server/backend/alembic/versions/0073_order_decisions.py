"""Unify approved lifecycle and permit explicit SPT decisions.

Authored only; requires a separately authorized migration run. No synthetic
decision evidence or attribution is created. Terminal states are untouched.
"""
from alembic import op
from sqlalchemy import text, String

revision = "0073_order_decisions"
down_revision = "0072_imm_approved_status"
branch_labels = depends_on = None


def upgrade():
    op.drop_constraint("ck_lupin_status", "lupin_orders", type_="check")
    op.create_check_constraint("ck_lupin_status", "lupin_orders",
        "status IN ('Confirmed','Approved','In process','Shipped','Delivered','Rejected','Returned')")
    op.alter_column("spt_orders", "status", type_=String(16),
        existing_type=String(8), existing_nullable=False)
    op.drop_constraint("ck_spt_status", "spt_orders", type_="check")
    op.create_check_constraint("ck_spt_status", "spt_orders",
        "status IN ('Draft','Saved','In process','Rejected')")
    connection = op.get_bind()
    # Exact stored Approved states have no terminal/fulfilled ambiguity. Keep the
    # original encrypted history and audit fields; projections use the row status.
    for table in ("immunotherapy_orders", "lupin_orders"):
        connection.execute(text(f"UPDATE {table} SET status='In process', version=version+1 WHERE status='Approved'"))
    # Earlier Kits/SPT approval recorded evidence without advancing status. Only
    # real saved evidence can advance those pending states. Do not use status
    # alone to infer approval, and do not rewrite fulfilled/closed records.
    from app.services.directory_crypto import DirectoryCrypto
    from app.core.config import get_settings
    from app.services import kits, spt
    keys = DirectoryCrypto(get_settings())
    for service, table, pending in ((kits, "kits_orders", "Confirmed"), (spt, "spt_orders", "Saved")):
        connection.execute(text(f"LOCK TABLE {table} IN SHARE ROW EXCLUSIVE MODE"))
        rows = connection.execute(text(
            f"SELECT id,snapshot_ciphertext FROM {table} WHERE status=:pending FOR UPDATE"),
            {"pending": pending})
        for row in rows:
            snapshot = service.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
            evidence = snapshot.get("approval")
            if not (isinstance(evidence, dict) and evidence.get("approvedBy") and evidence.get("approvedAt")):
                continue
            snapshot["status"] = "In process"
            connection.execute(text(
                f"UPDATE {table} SET status='In process',snapshot_ciphertext=:snapshot,version=version+1 WHERE id=:id"),
                {"id": row.id, "snapshot": service.seal(keys, "orders", row.id, snapshot)})


def downgrade():
    raise RuntimeError("Order decision history cannot be narrowed without discarding saved lifecycle states")
