"""Focused Opening Stock operations only, synthetic disposable PostgreSQL."""
import csv
import io
import uuid
from decimal import Decimal
from pathlib import Path
import hashlib
import json
import pytest
from sqlalchemy import select, func, text
from sqlalchemy.exc import DBAPIError
from app.db.opening_stock_models import OpeningStock, OpeningStockRequest
from app.db.inventory_models import InventoryLot, InventoryPosting, InventoryBalance
from app.db.product_models import ProductAssembly
from app.db.models import AuditEvent
from app.services import inventory
from app.services import opening_stock_transfer as transfer
from app.services.language_transfer import encode
from app.services.auth import identity_from_token
from test_sessions import client, create_user, login
from test_purchase_orders import fixture
from test_allergens import add
from test_products_crud import create as create_product
from test_inventory_crud import destination

BASE = "/api/v1/admin/opening-stock"
STOCK = "/api/v1/admin/inventory"


def draft(item, location=None, kind="allergen", quantity="2.125", rate="100.005", source=None, row=None):
    return dict(recordedDate="2026-10-19", mode="manual", rows=[dict(sourceId=source or str(uuid.uuid4()),
        rowId=row or str(uuid.uuid4()), itemKind=kind, itemId=item["id"], quantity=quantity,
        unitRate=rate, locationId=location)])


def reviewed(api, headers, body):
    response = api.post(BASE + "/preview", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return response.json()


def save(api, headers, body):
    review = reviewed(api, headers, body)
    command = dict(**body, reviewToken=review["reviewToken"], idempotencyKey=str(uuid.uuid4()))
    response = api.post(BASE, headers=headers, json=command)
    assert response.status_code == 201, response.text
    return response.json(), command


def stock(api, headers):
    response = api.get(STOCK + "/stock", headers=headers, params={"snapshot": True})
    assert response.status_code == 200, response.text
    return response.json()["snapshot"]


def uploaded(api, headers, rows, format="csv"):
    data = encode(rows, format)
    response = api.post(BASE + "/import/review", headers=headers,
        params={"filename": "openings." + format}, files={"file": ("openings." + format, data)})
    assert response.status_code == 200, response.text
    return response.json()


def confirm_import(api, headers, review):
    assert review["valid"], review
    command = dict(**review["command"], reviewToken=review["reviewToken"], idempotencyKey=str(uuid.uuid4()))
    response = api.post(BASE, headers=headers, json=command)
    assert response.status_code == 201, response.text
    return response.json(), command


def test_opening_unallocated_allocation_transfer_retained_provenance_and_retries(client):
    api, db, settings = client
    headers, actor, fields, item = fixture(api, db)
    result, command = save(api, headers, draft(item))
    record = result["records"][0]
    assert record["unitRate"] == "100.01" and record["openingValue"] == "212.52125"
    assert record["before"] == "0.000" and record["after"] == "2.125"
    assert record["location"]["id"] is None and record["location"]["name"] == "Unallocated"
    assert record["actorId"] == str(actor.id) and record["appendOnly"]
    assert api.post(BASE, headers=headers, json=command).json() == result
    assert api.get(BASE + "/requests/" + command["idempotencyKey"], headers=headers).json()["result"] == result
    current = next(r for r in stock(api, headers) if r["productId"] == item["id"])
    assert current["quantity"] == current["unallocatedQuantity"] == "2.125"
    assert current["lots"][0]["receiptId"] is None and current["lots"][0]["expiryDate"] is None
    assert current["lots"][0]["source"] == "opening"
    assert api.get(STOCK + "/references/lots", headers=headers,
        params={"source_id": fields["locationId"]}).json()["items"] == []
    available = api.get(STOCK + "/references/lots", headers=headers, params={"unallocated": True}).json()
    assert available["items"][0]["id"] == record["lotId"]
    move = dict(sourceId=None, destinationId=fields["locationId"], date="2026-10-19",
        deliveryMode="other", staffId=None, otherName="Synthetic carrier",
        lines=[dict(lotId=record["lotId"], quantity="1.125")])
    response = api.post(STOCK + "/movements/preview", headers=headers, json=move)
    assert response.status_code == 200, response.text
    movement_command = dict(**move, reviewToken=response.json()["reviewToken"], idempotencyKey=str(uuid.uuid4()))
    response = api.post(STOCK + "/movements", headers=headers, json=movement_command)
    assert response.status_code == 201, response.text
    movement = response.json()
    assert movement["source"]["id"] is None and movement["source"]["name"] == "Unallocated"
    line = movement["lines"][0]
    assert (line["sourceBefore"], line["sourceAfter"], line["destinationAfter"]) == ("2.125", "1.000", "1.125")
    assert line["openingId"] == record["id"] and line["unitRate"] == "100.01"
    assert line["openingLocation"]["id"] is None
    assert api.post(STOCK + "/movements", headers=headers, json=movement_command).json() == movement
    dst = destination(db, actor)
    move.update(sourceId=fields["locationId"], destinationId=str(dst.id), lines=[dict(lotId=record["lotId"], quantity="0.125")])
    review = api.post(STOCK + "/movements/preview", headers=headers, json=move)
    assert review.status_code == 200, review.text
    response = api.post(STOCK + "/movements", headers=headers, json={
        **move, "reviewToken": review.json()["reviewToken"], "idempotencyKey": str(uuid.uuid4())})
    assert response.status_code == 201, response.text
    assert response.json()["lines"][0]["openingId"] == record["id"]
    current = next(r for r in stock(api, headers) if r["productId"] == item["id"])
    assert current["quantity"] == "2.125" and current["unallocatedQuantity"] == "1.000"
    assert api.get(BASE + "/" + record["id"], headers=headers).json() == record
    assert api.get(BASE + "/" + record["id"] + "/activity", headers=headers).json()["filtered"] == 1
    analytics = api.get(BASE + "/" + record["id"] + "/analytics", headers=headers).json()
    assert analytics["breakdown"][0]["quantity"] == "2.125"
    assert analytics["breakdown"][0]["openingValue"] == "212.52125"
    history = api.get(STOCK + f"/stock/{item['id']}/history", headers=headers).json()
    assert history["filtered"] == 5 and any(r["locationId"] is None for r in history["items"])
    assert db.scalar(select(func.count()).select_from(OpeningStock)) == 1
    assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "inventory_allocated")) == 1
    assert api.get("/api/v1/health/readiness").status_code == 200


def test_opening_finished_product_never_assembles_or_debits_components(client):
    api, db, _ = client
    headers, actor, fields, item = fixture(api, db)
    second = add(api, headers, {"id": item["category_id"]}, {"id": fields["locationId"]}, name="Second opening component")
    product, _ = create_product(api, headers, dict(name="Existing finished product", mrp="100", sellingPrice="90", status="active",
        members=[dict(allergenId=p["id"], quantity="0.100") for p in (item, second)]))
    result, _ = save(api, headers, draft(product, fields["locationId"], "combo", "3", "0"))
    record = result["records"][0]
    assert record["unit"] == "whole combos" and record["openingValue"] == "0.00000"
    assert db.scalar(select(func.count()).select_from(ProductAssembly)) == 0
    assert db.scalar(select(func.count()).select_from(InventoryPosting)) == 1
    assert {r["quantity"] for r in stock(api, headers) if r["itemKind"] == "allergen"} == {"0.000"}
    assert api.post(BASE + "/preview", headers=headers, json=draft(product, kind="combo", quantity="1.001")).status_code == 422
    dst = destination(db, actor)
    move = dict(sourceId=fields["locationId"], destinationId=str(dst.id), date="2026-10-19",
        deliveryMode="other", staffId=None, otherName="Synthetic carrier", lines=[dict(lotId=record["lotId"], quantity="1")])
    review = api.post(STOCK + "/movements/preview", headers=headers, json=move)
    assert review.status_code == 200, review.text
    response = api.post(STOCK + "/movements", headers=headers, json={
        **move, "reviewToken": review.json()["reviewToken"], "idempotencyKey": str(uuid.uuid4())})
    assert response.status_code == 201, response.text
    assert response.json()["lines"][0]["assemblyId"] is None
    assert response.json()["lines"][0]["openingId"] == record["id"]


def test_catalogue_sample_filled_rows_atomic_import_export_and_duplicate_reupload(client):
    api, db, _ = client
    headers, actor, fields, item = fixture(api, db)
    second = add(api, headers, {"id": item["category_id"]}, {"id": fields["locationId"]}, name="Untouched catalogue item")
    response = api.get(BASE + "/sample", headers=headers, params={"format": "csv"})
    assert response.status_code == 200, response.text
    assert response.headers["X-Download-Log"]
    rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert rows[0] == transfer.HEADERS and len(rows) == 3
    assert all(r[6:11] == [""] * 5 for r in rows[1:])
    workbook_sample = api.get(BASE + "/sample", headers=headers, params={"format": "xlsx"})
    assert workbook_sample.status_code == 200, workbook_sample.text
    blank_review = api.post(BASE + "/import/review", headers=headers,
        params={"filename": "sample.xlsx"}, files={"file": ("sample.xlsx", workbook_sample.content)})
    assert blank_review.status_code == 200, blank_review.text
    assert blank_review.json()["skippedCount"] == 2 and blank_review.json()["command"] is None
    filled = next(r for r in rows[1:] if r[3] == item["id"])
    filled[6:8] = ["1.234", "999999999999.99"]
    untouched = next(r for r in rows[1:] if r[3] == second["id"])
    review = uploaded(api, headers, rows)
    assert review["validCount"] == 1 and review["skippedCount"] == 1
    result, command = confirm_import(api, headers, review)
    assert result["postedCount"] == 1
    assert result["records"][0]["openingValue"] == "1233999999999.98766"
    assert api.post(BASE, headers=headers, json=command).json() == result
    # Original filled file, exact XLSX text and portable backup all resolve to
    # the durable same source, without creating audit/stock duplicates.
    for format in ("csv", "xlsx"):
        again = uploaded(api, headers, rows, format)
        assert again["alreadyImportedCount"] == 1 and again["validCount"] == 0
        repeated, _ = confirm_import(api, headers, again)
        assert repeated["postedCount"] == 0 and repeated["alreadyImportedCount"] == 1
        backup = api.get(BASE + "/export", headers=headers, params={"format": format})
        assert backup.status_code == 200, backup.text
        response = api.post(BASE + "/import/review",
                headers={**headers, "Content-Type": "application/octet-stream"}, params={"filename": "backup." + format},
                content=backup.content)
        assert response.status_code == 200, response.text
        assert response.json()["alreadyImportedCount"] == 1
        confirm_import(api, headers, response.json())
    assert db.scalar(select(func.count()).select_from(OpeningStock)) == 1
    assert db.scalar(select(func.count()).select_from(InventoryPosting)) == 1
    assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "opening_stock_imported")) == 1
    summary = api.get(BASE, headers=headers, params={"limit": 1}).json()["summary"]
    assert summary["imports"] == 1 and summary["records"] == 1
    # Explicit zero is not a stock posting; the other blank catalogue row skips.
    filled[1], filled[6], filled[7] = str(uuid.uuid4()), "0", ""
    zero = uploaded(api, headers, rows)
    assert zero["valid"] and zero["skippedCount"] == 2
    result, _ = confirm_import(api, headers, zero)
    assert result["postedCount"] == 0
    assert db.scalar(select(func.count()).select_from(InventoryPosting)) == 1


def test_repeated_rows_precision_stale_references_and_atomic_failure(client, monkeypatch):
    api, db, _ = client
    headers, actor, fields, item = fixture(api, db)
    body = draft(item)
    for patch in ({"quantity": "1.0001"}, {"quantity": 1.2}, {"quantity": "1000001"},
                  {"unitRate": "-1"}, {"unitRate": "1e3"}, {"unitRate": "0.0000001"},
                  {"unitRate": "999999999999.995"}, {"itemKind": "combo"}):
        invalid = {**body, "rows": [{**body["rows"][0], **patch}]}
        assert api.post(BASE + "/preview", headers=headers, json=invalid).status_code in (409, 422)
    assert api.post(BASE + "/preview", headers=headers, json={**body, "rows": body["rows"] * 2}).status_code == 422
    # Distinct intentional lines at the same location/name/rate are not deduped.
    body["rows"].append({**body["rows"][0], "rowId": str(uuid.uuid4())})
    review = reviewed(api, headers, body)
    calls, real_post = [], inventory.post
    def fail(*args, **kwargs):
        outcome = real_post(*args, **kwargs)
        calls.append(outcome)
        raise inventory.PRError("Synthetic unavailable response", 503, "synthetic")
    key = str(uuid.uuid4())
    with monkeypatch.context() as patch:
        patch.setattr(inventory, "post", fail)
        response = api.post(BASE, headers=headers, json={
            **body, "reviewToken": review["reviewToken"], "idempotencyKey": key})
        assert response.status_code == 503, response.text
    assert calls and db.scalar(select(func.count()).select_from(OpeningStock)) == 0
    assert db.scalar(select(func.count()).select_from(InventoryPosting)) == 0
    assert db.scalar(select(func.count()).select_from(AuditEvent).where(AuditEvent.resource_type == "opening_stock")) == 0
    assert db.get(OpeningStockRequest, uuid.UUID(key)) is None
    # Active-reference review is invalidated, never silently refreshed on commit.
    from app.db.allergen_models import AllergenProduct
    current = db.get(AllergenProduct, uuid.UUID(item["id"]))
    current.version += 1
    db.commit()
    assert api.post(BASE, headers=headers, json={
        **body, "reviewToken": review["reviewToken"], "idempotencyKey": str(uuid.uuid4())}).status_code == 409
    result, _ = save(api, headers, body)
    assert result["postedCount"] == 2
    assert api.get(BASE, headers=headers, params={"limit": 1}).json()["summary"]["records"] == 2
    with pytest.raises(DBAPIError):
        with db.begin_nested():
            db.execute(text("UPDATE opening_stock SET row_id=gen_random_uuid()"))
    with pytest.raises(DBAPIError):
        with db.begin_nested():
            db.execute(text("UPDATE inventory_lots SET accepted=1 WHERE opening_id IS NOT NULL"))
    assert api.delete(BASE + "/" + result["records"][0]["id"], headers=headers).status_code == 405


def test_denied_closed_requests_and_import_errors_do_not_write_stock(client):
    api, db, _ = client
    headers, actor, fields, item = fixture(api, db)
    body = draft(item)
    review = reviewed(api, headers, body)
    key = str(uuid.uuid4())
    assert api.get(BASE + "/requests/" + key, headers=headers).json()["state"] == "not_committed"
    assert api.post(BASE, headers=headers, json={
        **body, "reviewToken": review["reviewToken"], "idempotencyKey": key}).status_code == 409
    assert api.get(BASE).status_code == 401
    other = create_user(db, "opening-mr@example.com")
    denied = {"Authorization": "Bearer " + login(api, other.email).json()["access_token"]}
    assert api.get(BASE, headers=denied).status_code == 403
    assert api.post(BASE + "/preview", headers=denied, json=body).status_code == 403
    assert api.get(BASE + "/sample", headers=denied).status_code == 403
    sample = api.get(BASE + "/sample", headers=headers)
    assert sample.status_code == 200, sample.text
    rows = list(csv.reader(io.StringIO(sample.content.decode("utf-8-sig"))))
    for quantity, rate, location, name in (("1", "", "", ""), ("0.0001", "2", "", ""),
                                         ("1", "2", "", "Unknown location"),
                                         ("1", "2", str(uuid.uuid4()), "")):
        rows[1][6:10] = [quantity, rate, location, name]
        result = uploaded(api, headers, rows)
        assert not result["valid"] and result["invalidCount"] == 1 and result["reviewToken"] is None
    rows[1][6:10] = ["1", "2", "", ""]
    duplicate = uploaded(api, headers, rows + [rows[1]])
    assert not duplicate["valid"] and any("Repeated" in e for r in duplicate["rows"] for e in r["errors"])
    assert db.scalar(select(func.count()).select_from(OpeningStock)) == 0
    result, _ = save(api, headers, body)
    # Same source identity cannot be silently repurposed, even with a new request.
    changed = {**body, "rows": [{**body["rows"][0], "quantity": "3"}]}
    assert api.post(BASE + "/preview", headers=headers, json=changed).status_code == 409
    # Distinct newly reviewed intentional opening remains possible.
    save(api, headers, draft(item, quantity="2.125"))
    assert db.scalar(select(func.count()).select_from(OpeningStock)) == 2


def test_large_opening_uploads(client):
    """The advertised file limit applies at ingress, not merely in the parser."""
    api, db, _ = client
    headers, _, _, _ = fixture(api, db)
    response = api.get(BASE + "/sample", headers=headers, params={"format": "csv"})
    template = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig"))))[1]
    rows = [list(template) for _ in range(220)]
    rows[0][6:8] = ["1.000", "0.00"]
    for row in rows:
        row[1] = str(uuid.uuid4())
        row[11] = ""

    def sized(size):
        working = [list(row) for row in rows]
        def encode():
            output = io.StringIO(newline="")
            csv.writer(output, lineterminator="\n").writerows([transfer.HEADERS, *working])
            return output.getvalue().encode()
        left = size - len(encode())
        for row in working:
            amount = min(left, 10000)
            row[11] = "x" * amount
            left -= amount
        assert left == 0
        data = encode()
        assert len(data) == size
        return data

    for size in (1_100_000, 2 * 1024 * 1024):
        data = sized(size)
        for multipart in (False, True):
            arguments = {"files": {"file": ("filled.csv", data)}} if multipart else {
                "content": data, "headers": {**headers, "Content-Type": "application/octet-stream"}}
            if multipart:
                arguments["headers"] = headers
            reviewed_file = api.post(BASE + "/import/review", params={"filename": "filled.csv"}, **arguments)
            assert reviewed_file.status_code == 200, reviewed_file.text
            assert reviewed_file.json()["validCount"] == 1
            assert reviewed_file.json()["skippedCount"] == 219
    too_large = sized(2 * 1024 * 1024) + b"\n"
    for multipart in (False, True):
        arguments = {"files": {"file": ("filled.csv", too_large)}} if multipart else {
            "content": too_large, "headers": {**headers, "Content-Type": "application/octet-stream"}}
        if multipart:
            arguments["headers"] = headers
        denied = api.post(BASE + "/import/review", params={"filename": "filled.csv"}, **arguments)
        assert denied.status_code == 413, denied.text
    assert api.get(BASE, headers=headers).json()["total"] == 0


def test_opening_schema_catalog_observation(client):
    """Generate real catalog metadata only from the already isolated cluster."""
    api, db, _ = client
    from app.services.fresh_catalog import digest, projection
    root = Path(__file__).resolve().parents[4]
    directory = root / "generated-artifacts" / "opening-stock"
    directory.mkdir(parents=True, exist_ok=True)
    connection = db.connection()
    tables = list(db.scalars(text("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")))
    observation = dict(revision=db.scalar(text("SELECT version_num FROM alembic_version")),
        postgresql=db.scalar(text("SHOW server_version")), catalog_sha256=digest(connection),
        observed_at=db.scalar(text("SELECT now()")).isoformat(), tables=tables,
        system_identifier=db.scalar(text("SELECT system_identifier::text FROM pg_control_system()")))
    assert observation["revision"] == "0050_opening_stock"
    (directory / "catalog-observation.json").write_text(json.dumps(observation, indent=2) + "\n")
    (directory / "catalog-projection.json").write_text(json.dumps(projection(connection), default=str, indent=2) + "\n")
