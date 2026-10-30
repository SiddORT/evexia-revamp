"""Focused filter checks; synthetic snapshots only, no database or login."""
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch
import pytest
from app.services import in_house_stock as service
from app.services.purchase_received_crypto import PRError

A = "00000000-0000-0000-0000-000000000001"
B = "00000000-0000-0000-0000-000000000002"


def snapshot(identity, allergen, created, expiry):
    return dict(id=identity, allergenId=allergen, allergenName="Saved allergen",
                categoryName="Category", concentration="0.2", unit="", quantity="2.000",
                locationName="Shelf", batch="Batch", actor="Admin", expiryDate=expiry,
                createdAt=created)


DATA = [
    snapshot("one", A, "2026-10-01T00:00:00+00:00", "2027-01-01"),
    snapshot("two", A, "2026-10-31T23:59:59+00:00", "2027-02-01"),
    snapshot("three", B, "2026-11-01T00:00:00+00:00", "2027-03-01"),
]


def listing(**kwargs):
    rows = [SimpleNamespace(id=r["id"], payload_ciphertext=r) for r in DATA]
    crypto = SimpleNamespace(open=lambda _id, _kind, value: value)
    with patch.object(service, "transaction", side_effect=lambda db, actor, work: work(None, crypto)), \
         patch.object(service, "bounded", return_value=rows):
        return service.listing(None, None, **kwargs)


def test_allergen_and_pagination_preserve_filtered_total():
    result = listing(allergen_id=A, offset=1, limit=1)
    assert [r["id"] for r in result["items"]] == ["two"]
    assert (result["total"], result["filtered"]) == (3, 2)


def test_recorded_range_includes_both_boundary_days():
    assert [r["id"] for r in listing(from_date=date(2026, 10, 1), to_date=date(2026, 10, 31))["items"]] == ["one", "two"]


def test_expiry_range_combines_with_allergen():
    result = listing(allergen_id=A, date_field="expiry", from_date=date(2027, 2, 1), to_date=date(2027, 3, 1))
    assert [r["id"] for r in result["items"]] == ["two"]


def test_open_ended_and_search_filters():
    assert listing(query="missing")["filtered"] == 0
    assert listing(to_date=date(2026, 10, 1))["filtered"] == 1
    assert listing(from_date=date(2026, 11, 1))["filtered"] == 1


def test_reversed_range_rejected_before_database_access():
    with pytest.raises(PRError, match="From date"):
        service.listing(None, None, from_date=date(2026, 11, 1), to_date=date(2026, 10, 1))


def test_export_uses_complete_bounded_filter_path():
    from app.api.v1.in_house_stock import export
    with patch.object(service, "listing", return_value={"items": []}) as call:
        export(query="saved", allergen_id=A, from_date=None, to_date=None,
               date_field="expiry", actor="actor", db="db")
    assert call.call_args.args == ("db", "actor", "saved", 0, 2000, A, None, None, "expiry")
