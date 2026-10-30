"""Disposable PostgreSQL financial fixtures, not HTTP/auth/upload coverage.

Only identity revalidation and clinical/catalogue resolution are seams. Real
authorization lock ordering, SQL queries, encryption, idempotency, order writes,
memberships and settlement posting remain active.
"""
import copy
import os
import uuid
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import MRProfile
from app.db.mr_models import MRDirectory
from app.db.session import get_db, session_factory
from app.main import app
from app.schemas.settlements import SettlementInput
from app.services import immunotherapy, kits, lupin, mr_orders, order_eligibility, settlements, spt
from app.services.directory_runtime import crypto_scope

SERVICES = dict(immunotherapy=immunotherapy, kits=kits, spt=spt, lupin=lupin)
TODAY = date(2026, 10, 30)


@pytest.fixture(scope="session")
def financial_seed():
    # Fail before opening a connection, including when invoked outside our runner.
    assert os.environ.get("EVEXIA_ELIGIBILITY_DISPOSABLE") == "approved-private-fixture"
    assert get_settings().app_env == "test"
    assert os.environ["DATABASE_URL"] == os.environ["TEST_DATABASE_URL"]
    assert "/tmp/evexia-api-test." in os.environ["DATABASE_URL"]
    engine = session_factory().kw["bind"]
    from test_staff import admin_headers
    from test_master_permissions import seed
    from test_doctors import add as add_doctor, fields as doctor_fields
    from test_patients import add as add_patient, fields as patient_fields
    from mr_projection_fixture import seed_directory

    with Session(engine, expire_on_commit=False) as db:
        def override():
            yield db
        app.dependency_overrides[get_db] = override
        try:
            with TestClient(app, base_url="http://testserver") as api:
                headers, admin = admin_headers(api, db)
                _, rows = seed(api, headers, db)
                doctor2 = add_doctor(api, headers, doctor_fields(
                    rows["mr"], registrationNumber="ELIG-SECOND"))
                patient2 = add_patient(api, headers, patient_fields(
                    rows["doctor"], name="Second financial fixture patient", phone="9000000091"))
                other_mr = seed_directory(db, admin.id, 1)[0]
                mr = db.get(MRProfile, uuid.UUID(rows["mr"]["id"]))
                def actor(profile=None):
                    return SimpleNamespace(
                        user=SimpleNamespace(id=profile.user_id if profile else admin.id,
                            is_active=True, is_protected_system_admin=not bool(profile)),
                        mr=SimpleNamespace(id=profile.id, is_active=True) if profile else None,
                        staff=None, role="mr" if profile else "super_admin", session_id=None,
                        permissions=["admin.access"], is_protected_system_admin=not bool(profile))
                result = SimpleNamespace(
                    engine=engine, actor=actor(mr),
                    other=actor(db.get(MRProfile, other_mr)), admin=actor(),
                    doctor=uuid.UUID(rows["doctor"]["id"]), doctor2=uuid.UUID(doctor2["id"]),
                    patients=[uuid.UUID(rows["patient"]["id"]), uuid.UUID(patient2["id"])])
                db.commit()
        finally:
            app.dependency_overrides.clear()
    return result


@pytest.fixture
def financial_store(financial_seed, monkeypatch):
    seed = financial_seed
    # Real mr_orders.authorize still locks policy -> financial -> graph and
    # checks the saved MR assignment. No mocked lock or financial read.
    monkeypatch.setattr(mr_orders, "revalidate_identity", lambda db, actor, lock: actor)
    monkeypatch.setattr(order_eligibility, "today", lambda: TODAY)

    def resolved(db, *args):
        body = next(arg for arg in args if hasattr(arg, "status"))
        if hasattr(body, "financial_snapshot"):
            return copy.deepcopy(body.financial_snapshot)
        # Explicit resubmission validates a real Pydantic contract, then uses
        # the saved historical financial facts, not newly resolved prices.
        previous = next(arg for arg in args if isinstance(arg, dict))
        return {**copy.deepcopy(previous), "status": body.status}
    for kind, service in SERVICES.items():
        monkeypatch.setattr(service, "resolve" if kind == "spt" else "resolved", resolved)
    # Every test commits independently; only this suite's synthetic database
    # is cleared. CASCADE cannot reach a shared/development database (guard above).
    tables = [s.Order.__tablename__ for s in SERVICES.values()]
    tables += [s.Retry.__tablename__ for s in SERVICES.values()]
    tables += ["settlement_entries", "settlement_batches", "settlement_rejections"]
    with seed.engine.begin() as conn:
        conn.execute(text("TRUNCATE " + ", ".join(tables) + " CASCADE"))
    with Session(seed.engine) as db:
        for actor in (seed.actor, seed.other):
            row = db.get(MRDirectory, actor.mr.id)
            row.paymentLimit, row.doctorDaysLimit = Decimal("100.00"), 0
        db.commit()
    return FinancialStore(seed)


class FinancialStore:
    def __init__(self, seed):
        self.__dict__.update(seed.__dict__)

    def settings(self, limit="100.00", days=0, actor=None):
        with Session(self.engine) as db:
            row = db.get(MRDirectory, (actor or self.actor).mr.id)
            row.paymentLimit, row.doctorDaysLimit = Decimal(limit), days
            db.commit()

    def body(self, kind, amount="50.00", *, doctor=None, status=None, order_date=None, actor=None):
        actor = actor or self.actor
        status = status or ("Saved" if kind == "spt" else "Confirmed")
        doctor = doctor or self.doctor
        patients = [dict(id=str(p), source="master", amount="25.00", name=f"Patient {i}")
                    for i, p in enumerate(self.patients)]
        data = dict(status=status, doctorId=str(doctor), mrId=str(actor.mr.id),
                    patientId=str(self.patients[0]), paymentStatus="Unpaid",
                    doctor=dict(id=str(doctor), name="Saved Doctor"),
                    mr=dict(id=str(actor.mr.id), name="Saved MR"),
                    patients=patients, patientIds=[str(p) for p in self.patients],
                    patientCount=1, price=amount or "1.00", attachments=[], groups=[], total=amount,
                    totalMinor=int(Decimal(amount) * 100) if amount is not None else None,
                    pricing=None, kit={}, lancets="", applicators="", tray="",
                    correctionSaved=False, remarks="", dosage="PD", histamine="1",
                    saline="0", shipping="doctor")
        if kind == "immunotherapy":
            data["groups"] = [dict(id="fixture", mrp=amount, items=[
                dict(allergenId=str(uuid.uuid4()), result="1", rate=amount)])]
        if kind in ("lupin", "immunotherapy"):
            # Resubmission only needs saved prescription metadata at this seam.
            # Attachment verification itself is deliberately outside this suite.
            data["attachments"] = [dict(id=str(uuid.uuid4()), name="Synthetic prescription")]
        if kind == "kits":
            # Eligibility verifies saved Kits calculation, so use a genuine
            # zero-accessory price basis rather than a made-up pricing snapshot.
            from app.schemas.kits import KitsInput
            from app.schemas.kits_pricing import KitsPricingInput, calculate
            values = KitsInput(doctorId=doctor, mrId=actor.mr.id, kit=dict(
                product="100", volume="1", quantity="1"), lancets="", applicators="", tray="")
            data["kit"] = values.kit.model_dump()
            if amount is not None:
                price = KitsPricingInput(kitRate=amount, forwardingCharges="0.00",
                                         discountType="inr", discountValue="0.00")
                data["pricing"] = calculate(values, price, "0.00")
        return SimpleNamespace(
            financial_snapshot=data, doctorId=doctor, mrId=actor.mr.id,
            patientId=self.patients[0], patientIds=self.patients, patientCount=1,
            patients=[SimpleNamespace(id=p, source="master") for p in self.patients],
            attachmentIds=[], groups=[], orderFor="doctor", orderDate=order_date,
            status=status, paymentStatus="Unpaid")

    def place(self, kind, body=None, *, actor=None, key=None, identity=None, expected=None,
              hook=None, before=None):
        """Use actual transaction/idempotent/apply chain for each order type.

        Synthetic resolved data is intentionally not an HTTP input/response
        contract. In particular IT's outer ImmRecord serializer is not tested.
        """
        service = SERVICES[kind]
        body = body or self.body(kind)
        key = key or uuid.uuid4()
        payload = {"operation": "financial-test", "identity": str(identity),
                   "values": body.financial_snapshot, "expected": expected}
        with Session(self.engine) as db:
            if before:
                before(db)
            def work(current, keys):
                if hook:
                    hook(db)
                return service.idempotent(db, current, keys, key, payload,
                    lambda: service.apply(db, current, keys, body, identity, expected))
            return service.transaction(db, actor or self.actor, work, action="edit" if identity else "add")

    def evaluate(self, kind, body=None, *, actor=None, identity=None):
        service = SERVICES[kind]
        body = body or self.body(kind)
        with Session(self.engine) as db:
            def work(current, keys):
                row = service.find(db, identity) if identity else None
                previous = service.project(keys, row) if row else None
                return order_eligibility.evaluate(db, keys, kind, body.financial_snapshot,
                    row=row, previous=previous, order_date=body.orderDate)
            return service.transaction(db, actor or self.actor, work)

    def rewrite(self, kind, identity, **changes):
        """Historical fixture edit; never use catalogue or present-day estimates."""
        service = SERVICES[kind]
        with Session(self.engine) as db, crypto_scope(db) as keys:
            row = db.get(service.Order, uuid.UUID(str(identity)))
            data = service.unseal(keys, "orders", row.id, row.snapshot_ciphertext)
            for field, value in changes.items():
                if field in ("date", "status"):
                    setattr(row, field, value)
                if field != "date":
                    data[field] = value
            row.snapshot_ciphertext = service.seal(keys, "orders", row.id, data)
            db.commit()

    def payment(self, kind, order, amount, *, actor=None, key=None, paid="0.00"):
        body = SettlementInput(idempotency_key=key or uuid.uuid4(), date=TODAY.isoformat(),
            mode="Cash", entries=[dict(kind=order_eligibility.LABELS[kind], id=order["id"],
                expected_version=order["version"], expected_paid=paid, amount=amount)])
        with Session(self.engine) as db:
            return settlements.post(db, actor or self.actor, body)

    def counts(self):
        with Session(self.engine) as db:
            return {kind: len(list(db.scalars(select(service.Order)))) for kind, service in SERVICES.items()}
