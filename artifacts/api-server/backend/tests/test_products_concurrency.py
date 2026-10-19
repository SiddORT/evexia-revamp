"""Committed separate connections, run LAST in a disposable database only."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.core.config import get_settings
from app.db.session import get_db, session_factory
from app.main import app
from app.db.inventory_models import InventoryBalance, InventoryPosting
from app.db.product_models import ProductAssembly
from app.db.purchase_received_models import PurchaseReceipt
from app.schemas.products import AssemblyCreate
from app.schemas.inventory import MoveCreate
from app.schemas.purchase_received import PREdit
from app.services import products, inventory, purchase_received
from app.services.auth import identity_from_token
from app.services.purchase_received_crypto import PRError
from test_products_crud import setup, create, draft, review
from test_inventory_crud import destination, move_draft


def test_concurrent_assembly_transfer_and_receipt_correction_do_not_overdraw():
    settings = get_settings()
    assert settings.app_env == "test"
    engine = session_factory().kw["bind"]

    def override(request: Request):
        with Session(engine) as db:
            db.info["request_id"] = request.state.request_id
            yield db

    app.dependency_overrides[get_db] = override
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        with TestClient(app, base_url="http://testserver") as api, Session(engine) as db:
            headers, user, fields, lots, receipt, receipt_draft = setup(api, db)
            product, _ = create(api, headers, fields)
            values = draft(product, lots, receipt, 40)
            token = review(api, headers, values)["reviewToken"]
            assembly_body = AssemblyCreate(**values, reviewToken=token, idempotencyKey=uuid.uuid4())
            dst = destination(db, user)
            # Every contender affects the component needed in quantity 10.
            second_id = fields["members"][1]["allergenId"]
            lot = next(l for l in lots if l["productId"] == second_id)
            move_values = move_draft(receipt, lot["id"], dst)
            move_values["lines"][0]["quantity"] = "7"
            response = api.post("/api/v1/admin/inventory/movements/preview", headers=headers, json=move_values)
            assert response.status_code == 200, response.text
            move_body = MoveCreate(**move_values, reviewToken=response.json()["reviewToken"], idempotencyKey=uuid.uuid4())
            changed = {**receipt_draft, "lines": [
                {**l, "acceptedQty": "5"} if l["lineId"] == next(x["lineId"] for x in receipt["lines"] if x["productId"] == second_id) else l
                for l in receipt_draft["lines"]]}
            response = api.post("/api/v1/admin/purchase-received/" + receipt["id"] + "/preview", headers=headers, json=changed)
            assert response.status_code == 200, response.text
            receipt_body = PREdit(**changed, expected_version=receipt["version"],
                reviewToken=response.json()["reviewToken"], idempotencyKey=uuid.uuid4())
            db.commit()
            barrier = Barrier(4)
            access = headers["Authorization"].removeprefix("Bearer ")

            def contender(kind):
                barrier.wait(timeout=15)
                with Session(engine) as worker:
                    actor = identity_from_token(worker, access, settings)
                    try:
                        if kind == "assembly":
                            products.assemble(worker, actor, assembly_body)
                        elif kind == "transfer":
                            inventory.create(worker, actor, move_body)
                        else:
                            purchase_received.mutation(worker, actor, receipt_body, uuid.UUID(receipt["id"]), "updated")
                        return kind, "committed"
                    except PRError as exc:
                        return kind, exc.status

            with ThreadPoolExecutor(max_workers=4) as pool:
                futures = [pool.submit(contender, kind) for kind in ("assembly", "assembly", "transfer", "receipt")]
                results = [f.result(timeout=30) for f in futures]
            assert any(state == "committed" for _, state in results), results
            assert all(state in ("committed", 409) for _, state in results), results
            assert db.scalar(select(func.count()).select_from(ProductAssembly)) <= 1
            balances = list(db.scalars(select(InventoryBalance)))
            assert all(b.quantity >= 0 for b in balances)
            for balance in balances:
                posted = db.scalar(select(func.sum(InventoryPosting.delta)).where(
                    InventoryPosting.lot_id == balance.lot_id, InventoryPosting.location_id == balance.location_id))
                assert posted == balance.quantity
    finally:
        app.dependency_overrides.clear()
