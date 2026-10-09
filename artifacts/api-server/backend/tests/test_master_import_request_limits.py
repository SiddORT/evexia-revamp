"""Authenticated request/file boundaries with disposable synthetic fixtures."""
import csv
import io

import pytest
from sqlalchemy import func, select

from app.core.request_limits import body_limit
from app.db.opening_balance_models import OpeningBalance
from app.db.vendor_models import Vendor
from app.schemas.vendors import BUSINESS_FIELDS
from app.services.opening_balance_transfer import HEADERS as BALANCE_HEADERS
from app.services.vendor_transfer import HEADERS as VENDOR_HEADERS
from test_opening_balances import setup_balance
from test_reporting import admin_headers
from test_sessions import client
from test_vendors import FIELDS

MIB = 1024 * 1024


def sized_csv(headers, rows, size):
    """Pad only ignored historical attribution cells, within per-cell bounds."""
    def encode():
        stream = io.StringIO()
        writer = csv.writer(stream)
        writer.writerow(headers)
        writer.writerows(rows)
        return stream.getvalue().encode("utf-8")

    remaining = size - len(encode())
    assert remaining > 0
    for row in rows:
        for index in range(len(headers) - 4, len(headers)):
            length = min(remaining, 9000)
            row[index] = "x" * length
            remaining -= length
    assert remaining == 0
    data = encode()
    assert len(data) == size
    return data


@pytest.mark.parametrize("resource", ["opening-balances", "vendors"])
@pytest.mark.parametrize("multipart", [False, True], ids=["raw", "multipart"])
@pytest.mark.parametrize("size", [MIB + 2048, 2 * MIB], ids=["above-one-mib", "exact-two-mib"])
def test_valid_large_review_commit_and_file_overflow(client, resource, multipart, size):
    api, db, _ = client
    count = (size + 35999) // 36000
    if resource == "opening-balances":
        headers, _, doctor = setup_balance(api, db)
        columns = BALANCE_HEADERS
        rows = [[1900 + index, 1901 + index, doctor["registrationNumber"],
                 "-1.25", "active", "", "", "", ""] for index in range(count)]
        model = OpeningBalance
    else:
        headers, _ = admin_headers(api, db)
        columns = VENDOR_HEADERS
        rows = []
        for index in range(count):
            fields = {**FIELDS, "vendorName": f"Boundary Supply {index}",
                      "gstNo": f"27ABCDE{1000 + index:04d}F1Z5"}
            rows.append([fields[key] for key in BUSINESS_FIELDS] + ["", "", "", ""])
        model = Vendor
    data = sized_csv(columns, rows, size)
    base = f"/api/v1/admin/{resource}/import"

    def send(action, payload, digest=None):
        params = {"filename": "boundary.csv"}
        if digest:
            params.update(digest=digest, confirm="true")
        if multipart:
            return api.post(f"{base}/{action}", headers=headers, params=params,
                            files={"file": ("boundary.csv", payload, "text/csv")})
        return api.post(f"{base}/{action}", params=params, content=payload,
                        headers={**headers, "Content-Type": "application/octet-stream"})

    reviewed = send("review", data)
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["valid"] is True, reviewed.text
    assert db.scalar(select(func.count()).select_from(model)) == 0
    digest = reviewed.json()["digest"]
    committed = send("commit", data, digest)
    assert committed.status_code == 200, committed.text
    assert committed.json()["imported"] == count
    assert db.scalar(select(func.count()).select_from(model)) == count
    # Multipart envelope overhead is allowed; the FILE boundary remains 2 MiB.
    overflow = data + b"x" * (2 * MIB + 1 - len(data))
    assert len(overflow) == 2 * MIB + 1
    assert send("review", overflow).status_code == 413
    assert send("commit", overflow, digest).status_code == 413
    assert db.scalar(select(func.count()).select_from(model)) == count


def test_import_allowance_does_not_expand_ordinary_json_requests():
    for resource in ("opening-balances", "vendors"):
        base = f"/api/v1/admin/{resource}"
        for action in ("review", "commit"):
            path = f"{base}/import/{action}"
            assert body_limit("POST", path, 20 * MIB) == 2 * MIB + 64 * 1024
            assert body_limit("GET", path, 20 * MIB) == MIB
            assert body_limit("POST", path + "-other", 20 * MIB) == MIB
        assert body_limit("POST", base, 20 * MIB) == MIB
