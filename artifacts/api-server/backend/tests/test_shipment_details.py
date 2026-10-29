"""Focused, database-free shipment read contracts; no live account/session use."""
import copy
import uuid
from datetime import date
from types import SimpleNamespace

import pytest

from app.schemas.shipments import ShipmentDetails
from app.services import shipments
from app.services.immunotherapy import ImmError


IDENTITY = uuid.UUID("11111111-1111-4111-8111-111111111111")


def row(status="Shipped"):
    return SimpleNamespace(id=IDENTITY, number="synthetic-order",
                           date=date(2026, 10, 24), version=5, status=status)


@pytest.mark.parametrize("kind", ["IT", "Kit", "SPT", "Lupin"])
def test_details_preserve_saved_order_and_patient_names(monkeypatch, kind):
    saved = {
        "id": str(IDENTITY), "number": "synthetic-order", "date": "2026-10-24",
        "version": 5, "doctor": {"name": "Saved doctor"}, "mr": {"name": "Saved MR"},
        "billing": {"address": "Saved billing address"},
        "recipient": {"name": "Saved recipient", "address": "Saved shipping address"},
        "groups": [{"items": [{"name": "Saved allergen", "quantity": 3}]}],
        "remarks": "Saved remarks", "decisionEligibility": {"internal": True},
        "mrEditable": False,
        "shipment": {"courierName": "Saved courier", "trackingId": "tracking-1",
                     "expectedDeliveryDate": "2026-10-31"},
    }
    if kind in {"IT", "Kit"}:
        saved["patient"] = {"name": "Saved patient"}
    else:
        saved["patients"] = [{"name": "Saved patient"}, {"name": "Second saved patient"}]
    original = copy.deepcopy(saved)
    source = shipments.SOURCES[kind]
    monkeypatch.setattr(source, "project", lambda keys, value: copy.deepcopy(saved))
    monkeypatch.setattr(shipments, "transaction", lambda db, actor, work: work(actor, object()))

    class ReadOnlyDB:
        def get(self, model, identity):
            assert model is source.Order and identity == IDENTITY
            return row()

    result = ShipmentDetails.model_validate(
        shipments.detail(ReadOnlyDB(), object(), kind, IDENTITY))
    assert result.record.type == kind
    assert result.record.status == "Shipped"
    assert result.record.doctor == "Saved doctor" and result.record.mr == "Saved MR"
    expected = ["Saved patient"] if kind in {"IT", "Kit"} else ["Saved patient", "Second saved patient"]
    assert result.record.patients == expected
    assert result.order["groups"][0]["items"][0]["quantity"] == 3
    assert result.order["billing"]["address"] == "Saved billing address"
    assert result.order["recipient"]["address"] == "Saved shipping address"
    assert result.record.trackingId == "tracking-1"
    assert "decisionEligibility" not in result.order and "mrEditable" not in result.order
    assert saved == original


@pytest.mark.parametrize("status", [None, "Draft", "Confirmed", "Rejected"])
def test_details_reject_missing_or_non_shipment_orders(monkeypatch, status):
    monkeypatch.setattr(shipments, "transaction", lambda db, actor, work: work(actor, object()))
    db = SimpleNamespace(get=lambda model, identity: None if status is None else row(status))
    with pytest.raises(ImmError) as failure:
        shipments.detail(db, object(), "IT", IDENTITY)
    assert failure.value.status == 404


@pytest.mark.parametrize("role,protected", [("mr", False), ("staff", False), ("super_admin", False)])
def test_details_reject_unprotected_and_non_super_admins_before_read(monkeypatch, role, protected):
    actor = SimpleNamespace(role=role, permissions={"admin.access"},
                            user=SimpleNamespace(is_protected_system_admin=protected, is_active=True))
    monkeypatch.setattr(shipments, "lock_policy", lambda db: None)
    def revalidate(db, value, *, lock):
        assert lock is True
        return actor
    monkeypatch.setattr(shipments, "revalidate_identity", revalidate)
    db = SimpleNamespace(rollback=lambda: None)
    with pytest.raises(ImmError) as failure:
        shipments.detail(db, actor, "IT", IDENTITY)
    assert failure.value.status == 403


def test_patient_names_do_not_infer_shipping_recipient():
    result = shipments.projection("IT", row(), {"recipient": {"name": "Doctor recipient"}})
    assert result["patients"] == []
