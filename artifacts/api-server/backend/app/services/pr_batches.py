"""Durable, actor-bound allocation; no receipt/document numbering changes."""
import uuid
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from app.db.pr_batch_models import PRBatchSettings, PRBatchCounter, PRBatchAllocation
from app.db.purchase_order_models import PurchaseOrderLine
from app.schemas.pr_batches import PRBatchPolicy
from app.services.purchase_received import transaction
from app.services.purchase_received_crypto import PRError
from app.services import purchase_orders as orders

MAX_COUNTER = 9223372036854775807


def require_schema(db):
    tables = ("pr_batch_settings", "pr_batch_counters", "pr_batch_allocations")
    if not all(db.scalar(text("SELECT to_regclass(:table) IS NOT NULL"),
                         {"table": f"public.{table}"}) for table in tables):
        raise PRError(
            "Batch Number Settings schema is not activated. Ask the operator to activate the reviewed development revision; your draft is preserved.",
            503, "pr_batch_schema_unavailable")


def settings_row(db, lock=False):
    require_schema(db)
    statement = select(PRBatchSettings).where(PRBatchSettings.id == 1)
    row = db.scalar(statement.with_for_update() if lock else statement)
    if row is None:
        raise PRError("Batch Number Settings configuration is missing. Contact the operator; your draft is preserved.",
                      503, "pr_batch_configuration_unavailable")
    return row


def policy_data(row, crypto):
    try:
        if row.payload_ciphertext is None:
            if row.version != 1:
                raise ValueError()
            return dict(mode="manual", prefix="")
        return PRBatchPolicy.model_validate(crypto.open(1, "batch-settings", row.payload_ciphertext)).model_dump()
    except (ValueError, PRError):
        raise PRError("Saved batch settings are unreadable. Contact the operator; your draft is preserved.",
                      503, "pr_batch_configuration_unavailable") from None


def view(row, crypto, actor_id):
    policy = dict(**policy_data(row, crypto), version=row.version)
    return dict(**policy, policyToken=crypto.seal(actor_id, "batch-policy", policy))


def read_settings(db, actor):
    return transaction(db, actor, lambda current, c: view(settings_row(db), c, current.user.id))


def write_settings(db, actor, body):
    def work(current, crypto):
        row = settings_row(db, lock=True)
        if row.version != body.expected_version:
            raise PRError("Batch settings changed. Load and review the saved version before saving your kept draft.", 409, "pr_batch_stale")
        row.payload_ciphertext = crypto.seal(1, "batch-settings", dict(mode=body.mode, prefix=body.prefix))
        row.version += 1
        return view(row, crypto, current.user.id)
    return transaction(db, actor, work)


def allocate(db, actor, body):
    def work(current, crypto):
        # The lock serializes even first requests whose INSERT has not committed.
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": body.idempotencyKey.int % (2**63 - 1)})
        request = body.model_dump(mode="json")
        previous = db.get(PRBatchAllocation, body.idempotencyKey)
        if previous:
            if previous.actor_id != current.user.id:
                raise PRError("Batch retry identity belongs to another request.", 409, "pr_batch_retry")
            saved = crypto.open(previous.key, "batch-allocation", previous.payload_ciphertext)
            if saved["request"] != request:
                raise PRError("Retry the original batch request without changing its identity or source.", 409, "pr_batch_retry")
            return saved["result"]
        # Fail explicitly on an uninstalled/incomplete schema, even for Manual.
        settings_row(db)
        captured = crypto.open(current.user.id, "batch-policy", body.policyToken)
        try:
            policy = PRBatchPolicy.model_validate({k: captured[k] for k in ("mode", "prefix")})
        except (ValueError, KeyError, TypeError):
            raise PRError("The captured batch policy is unavailable. Your draft is preserved; contact the operator.") from None
        if policy.mode == "manual":
            raise PRError("Manual mode requires entered batch numbers.", 422, "pr_batch_manual")
        po = orders.find(db, body.poId)
        if po.status != "open":
            raise PRError("Choose an open purchase order for new batch allocations.", 409, "pr_batch_source")
        source = {str(line.id): line for line in db.scalars(select(PurchaseOrderLine).where(
            PurchaseOrderLine.order_id == po.id, PurchaseOrderLine.position >= 0, PurchaseOrderLine.id.in_(body.lineIds)))}
        if any(str(key) not in source for key in body.lineIds):
            raise PRError("A batch source line no longer belongs to this purchase order.", 409, "pr_batch_source")
        scopes = {str(key): ("system" if policy.mode == "system" else str(source[str(key)].product_id)) for key in body.lineIds}
        counters = {}
        # Deterministic scope order prevents crossed multi-product deadlocks.
        for scope in sorted(set(scopes.values())):
            db.execute(insert(PRBatchCounter).values(scope=scope, value=1).on_conflict_do_nothing(index_elements=["scope"]))
            counters[scope] = db.scalar(select(PRBatchCounter).where(PRBatchCounter.scope == scope).with_for_update())
        lines = []
        for line_id in body.lineIds:
            scope = scopes[str(line_id)]
            counter = counters[scope]
            # A newly inserted scope starts at 1; value is the next unused number.
            if counter.value >= MAX_COUNTER:
                raise PRError("This batch sequence is exhausted. Contact the operator.", 409, "pr_batch_exhausted")
            prefix = policy.prefix if policy.mode == "system" else f"P-{uuid.UUID(scope).hex.upper()}-"
            lines.append(dict(lineId=str(line_id), batchNo=f"{prefix}{counter.value:08d}"))
            counter.value += 1
        result = dict(idempotencyKey=str(body.idempotencyKey), lines=lines)
        db.add(PRBatchAllocation(key=body.idempotencyKey, actor_id=current.user.id,
            payload_ciphertext=crypto.seal(body.idempotencyKey, "batch-allocation", dict(request=request, result=result))))
        return result
    return transaction(db, actor, work)
