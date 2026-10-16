"""Only Communication CRUD against disposable PostgreSQL; synthetic credentials."""
import base64
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.communication_models import CommunicationChannel, CommunicationConfiguration
from app.db.models import AuditEvent, User
from app.db.session import session_factory, get_db
from app.main import app
from app.services.communication_crypto import CommunicationCrypto
from app.api.deps import current_identity
from app.services.auth import Identity
from test_sessions import client, create_user, login
from test_reporting import admin_headers

BASE = "/api/v1/admin/communication"
SECRET = "synthetic-communication-secret-ONLY"
PAYLOADS = [
    ("email", "smtp", dict(name="Synthetic SMTP", host="smtp.example.test", port="587", security="starttls",
                          username="synthetic-smtp-user", fromName="Synthetic sender", fromEmail="sender@example.test")),
    ("email", "api", dict(name="Synthetic email API", provider="Synthetic mail", endpoint="https://mail.example.test/send",
                         fromName="Synthetic sender", fromEmail="sender@example.test")),
    ("email", "platform", dict(name="Synthetic platform", provider="Synthetic platform", endpoint="https://platform.example.test/send",
                              fromName="Synthetic sender", fromEmail="sender@example.test")),
    ("sms", "api", dict(name="Synthetic SMS", provider="Synthetic SMS provider", senderId="SYNTHETIC",
                       endpoint="https://sms.example.test/send", dltEntityId="entity-test", dltTemplateId="template-test")),
    ("waba", "api", dict(name="Synthetic WABA", provider="Synthetic WhatsApp", endpoint="https://waba.example.test/send",
                        businessAccountId="business-test", phoneNumberId="phone-test", senderPhone="+91 98765 43210", apiVersion="v23.0")),
]


def create(api, headers, channel="email", kind="smtp", values=None, secret=SECRET):
    if values is None:
        values = next(v for c, t, v in PAYLOADS if c == channel and t == kind)
    state = api.get(BASE, headers=headers).json()["channels"][channel]
    return api.post(BASE, headers=headers, json=dict(channel=channel, type=kind, values=values,
                    secret=secret, channelVersion=state["version"]))


def target(result, channel="email", index=0):
    state = result["channels"][channel]
    row = state["configurations"][index]
    return row, dict(version=row["version"], channelVersion=state["version"])


@pytest.mark.parametrize("channel,kind,values", PAYLOADS)
def test_roundtrip_all_fields_ciphertext_and_write_only(client, channel, kind, values):
    api, db, settings = client
    headers, actor = admin_headers(api, db)
    result = create(api, headers, channel, kind, values)
    assert result.status_code == 201, result.text
    row, version = target(result.json(), channel)
    assert row["values"] == values and row["credentialPresent"]
    assert SECRET not in result.text
    assert api.get(BASE, headers=headers).json() == result.json()
    assert api.get(f"{BASE}/{row['id']}", headers=headers).json() == row
    stored = db.get(CommunicationConfiguration, uuid.UUID(row["id"]))
    raw = str(db.execute(text("SELECT row_to_json(c)::text FROM communication_configurations c")).scalar())
    for value in [SECRET, *values.values()]:
        assert json.dumps(value) not in raw
    crypto = CommunicationCrypto(settings)
    assert json.loads(crypto.decrypt(stored, "payload", stored.payload_ciphertext)) == values
    assert crypto.decrypt(stored, "secret", stored.secret_ciphertext) == SECRET
    events = list(db.scalars(select(AuditEvent).where(AuditEvent.action.like("communication_%"))))
    assert len(events) == 1 and events[0].actor_id == actor.id
    assert SECRET not in str(events[0].__dict__) and values["name"] not in str(events[0].__dict__)


def test_edit_retention_replacement_stale_and_type_change(client):
    api, db, settings = client
    headers, _ = admin_headers(api, db)
    result = create(api, headers).json()
    row, version = target(result)
    body = dict(channel="email", type="smtp", values={**row["values"], "name": "Revised synthetic"}, **version)
    response = api.post(f"{BASE}/{row['id']}/edit", headers=headers, json=body)
    assert response.status_code == 200, response.text
    stored = db.get(CommunicationConfiguration, uuid.UUID(row["id"]))
    crypto = CommunicationCrypto(settings)
    assert crypto.decrypt(stored, "secret", stored.secret_ciphertext) == SECRET
    assert api.post(f"{BASE}/{row['id']}/edit", headers=headers, json=body).status_code == 409
    latest, version = target(response.json())
    body = dict(channel="email", type="api", values=PAYLOADS[1][2], **version)
    assert api.post(f"{BASE}/{row['id']}/edit", headers=headers, json=body).status_code == 422
    body["secret"] = "synthetic-replacement"
    response = api.post(f"{BASE}/{row['id']}/edit", headers=headers, json=body)
    assert response.status_code == 200, response.text
    db.expire_all()
    stored = db.get(CommunicationConfiguration, uuid.UUID(row["id"]))
    assert crypto.decrypt(stored, "secret", stored.secret_ciphertext) == body["secret"]
    changed, version = target(response.json())
    assert api.post(f"{BASE}/{row['id']}/edit", headers=headers, json=dict(channel="sms", type="api", values=PAYLOADS[3][2], secret=SECRET, **version)).status_code == 422
    assert SECRET not in api.get(BASE, headers=headers).text


def test_defaults_replacement_and_last_deletion(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    first = create(api, headers).json()
    first_id = first["channels"]["email"]["defaultId"]
    result = create(api, headers, kind="api").json()
    second = next(r for r in result["channels"]["email"]["configurations"] if r["id"] != first_id)
    state = result["channels"]["email"]
    version = dict(version=second["version"], channelVersion=state["version"])
    switched = api.post(f"{BASE}/{second['id']}/default", headers=headers, json=version)
    assert switched.status_code == 200 and switched.json()["channels"]["email"]["defaultId"] == second["id"]
    assert api.post(f"{BASE}/{second['id']}/default", headers=headers, json=version).status_code == 409
    state = switched.json()["channels"]["email"]
    row = next(r for r in state["configurations"] if r["id"] == second["id"])
    version = dict(version=row["version"], channelVersion=state["version"])
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json=version).status_code == 422
    assert api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={**version, "replacementId": str(uuid.uuid4())}).status_code == 422
    deleted = api.post(f"{BASE}/{row['id']}/delete", headers=headers, json={**version, "replacementId": first_id})
    assert deleted.status_code == 200, deleted.text
    row, version = target(deleted.json())
    assert deleted.json()["channels"]["email"]["defaultId"] == first_id
    deleted = api.post(f"{BASE}/{row['id']}/delete", headers=headers, json=version)
    assert deleted.status_code == 200 and deleted.json()["channels"]["email"]["defaultId"] is None
    assert deleted.json()["channels"]["email"]["configurations"] == []


@pytest.mark.parametrize("change", [
    {"secret": None}, {"secret": ""}, {"secret": "x" * 4097}, {"type": "unknown"},
    {"channel": "sms"}, {"values": {"name": SECRET}},
    {"values": {**PAYLOADS[1][2], "endpoint": "https://user:synthetic-secret@example.test"}},
    {"values": {**PAYLOADS[1][2], "endpoint": "https://example.test?unexpected=synthetic-secret"}},
    {"values": {**PAYLOADS[1][2], "endpoint": "https://example.test#synthetic-secret"}},
    {"values": {**PAYLOADS[1][2], "endpoint": "http://example.test"}},
    {SECRET: SECRET}, {"values": {**PAYLOADS[1][2], SECRET: SECRET}},
])
def test_invalid_writes_redacted_and_atomic(client, change):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    body = dict(channel="email", type="api", channelVersion=1, values=PAYLOADS[1][2], secret=SECRET)
    response = api.post(BASE, headers=headers, json={**body, **change})
    assert response.status_code == 422, response.text
    assert SECRET not in response.text and "synthetic-secret" not in response.text
    assert not list(db.scalars(select(CommunicationConfiguration)))
    assert not list(db.scalars(select(AuditEvent).where(AuditEvent.action.like("communication_%"))))


def test_authorization_for_all_crud_operations(client):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    created = create(api, headers).json()
    row, version = target(created)
    user = create_user(db, "synthetic-mr@example.test")
    operations = [("get", "", None), ("get", f"/{row['id']}", None),
                  ("post", "", dict(channel="email", type="smtp", values=PAYLOADS[0][2], secret=SECRET, channelVersion=2)),
                  ("post", f"/{row['id']}/edit", dict(channel="email", type="smtp", values=PAYLOADS[0][2], **version)),
                  ("post", f"/{row['id']}/delete", version), ("post", f"/{row['id']}/default", version)]
    for method, path, body in operations:
        response = api.request(method.upper(), BASE + path, **({"json": body} if body else {}))
        assert response.status_code == 401, response.text
    # Policy-boundary identities, not sign-in/system tests. Exercise both MR and
    # staff-like principals, including an unprotected super_admin role label.
    for role in ("mr", None, "super_admin"):
        user.system_role = role
        app.dependency_overrides[current_identity] = lambda: Identity(user)
        try:
            for method, path, body in operations:
                response = api.request(method.upper(), BASE + path, **({"json": body} if body else {}))
                assert response.status_code == 403, response.text
                assert SECRET not in response.text
        finally:
            app.dependency_overrides.pop(current_identity, None)


@pytest.mark.parametrize("failure", ["missing", "bad", "wrong", "unknown_active", "reused_staff", "tamper", "aad"])
def test_unreadable_keys_and_tampering_fail_closed_through_crud(client, failure):
    api, db, settings = client
    headers, _ = admin_headers(api, db)
    result = create(api, headers).json()
    row, version = target(result)
    stored = db.get(CommunicationConfiguration, uuid.UUID(row["id"]))
    previous = settings.communication_encryption_keys
    active = settings.communication_encryption_key_id
    if failure == "missing":
        settings.communication_encryption_keys = None
    elif failure == "bad":
        settings.communication_encryption_keys = SecretStr('{"primary":"bad"}')
    elif failure == "wrong":
        settings.communication_encryption_keys = SecretStr(json.dumps({"primary": base64.b64encode(b"Z" * 32).decode()}))
    elif failure == "unknown_active":
        settings.communication_encryption_key_id = "missing"
    elif failure == "reused_staff":
        settings.communication_encryption_keys = settings.staff_encryption_keys
    elif failure == "tamper":
        stored.secret_ciphertext = stored.secret_ciphertext[:-4] + "AAAA"
        db.commit()
    else:
        stored.payload_ciphertext = stored.secret_ciphertext
        db.commit()
    try:
        for method, path, body in [
            ("get", "", None), ("get", f"/{row['id']}", None),
            ("post", f"/{row['id']}/edit", dict(channel="email", type="smtp", values=row["values"], **version)),
            ("post", f"/{row['id']}/default", version), ("post", f"/{row['id']}/delete", version),
            ("post", "", dict(channel="sms", type="api", channelVersion=1, values=PAYLOADS[3][2], secret=SECRET)),
        ]:
            response = api.request(method.upper(), BASE + path, headers=headers, **({"json": body} if body else {}))
            assert response.status_code == 503, response.text
            assert SECRET not in response.text
        assert len(list(db.scalars(select(CommunicationConfiguration)))) == 1
    finally:
        settings.communication_encryption_keys = previous
        settings.communication_encryption_key_id = active


def test_database_unique_default_and_transaction_rollback(client, monkeypatch):
    api, db, _ = client
    headers, _ = admin_headers(api, db)
    create(api, headers)
    result = create(api, headers, kind="api").json()
    rows = list(db.scalars(select(CommunicationConfiguration)))
    with pytest.raises(IntegrityError), db.begin_nested():
        for row in rows:
            row.is_default = True
        db.flush()
    before = api.get(BASE, headers=headers).json()
    import app.services.communication as service
    original = service.snapshot
    calls = 0
    def fail_after_write(*args):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise service.CommunicationError()
        return original(*args)
    monkeypatch.setattr(service, "snapshot", fail_after_write)
    row, version = target(before)
    response = api.post(f"{BASE}/{row['id']}/edit", headers=headers, json=dict(channel="email", type=row["type"],
        values={**row["values"], "name": "Must roll back"}, **version))
    assert response.status_code == 503
    monkeypatch.setattr(service, "snapshot", original)
    assert api.get(BASE, headers=headers).json() == before


def test_concurrent_first_create_default_and_delete_invariants():
    """Independent connections with committed disposable data, not savepoint fixtures."""
    factory = session_factory()
    with TestClient(app) as api:
        with factory() as db:
            headers, _ = admin_headers(api, db)
        def race(requests):
            barrier = Barrier(2)
            def run(spec):
                path, body = spec
                barrier.wait()
                return api.post(BASE + path, headers=headers, json=body)
            with ThreadPoolExecutor(max_workers=2) as pool:
                return list(pool.map(run, requests))
        state = api.get(BASE, headers=headers).json()["channels"]["email"]
        assert state["configurations"] == []
        bodies = [dict(channel="email", type="smtp", values={**PAYLOADS[0][2], "name": f"Concurrent {i}"}, secret=SECRET, channelVersion=state["version"]) for i in range(2)]
        responses = race([("", b) for b in bodies])
        assert sorted(r.status_code for r in responses) == [201, 409]
        create(api, headers, kind="api")
        result = api.get(BASE, headers=headers).json()
        state = result["channels"]["email"]
        requests = [(f"/{r['id']}/default", dict(version=r["version"], channelVersion=state["version"])) for r in state["configurations"]]
        responses = race(requests)
        assert sorted(r.status_code for r in responses) == [200, 409]
        state = api.get(BASE, headers=headers).json()["channels"]["email"]
        requests = [(f"/{r['id']}/delete", dict(version=r["version"], channelVersion=state["version"],
                     replacementId=next(o["id"] for o in state["configurations"] if o["id"] != r["id"]))) for r in state["configurations"]]
        responses = race(requests)
        assert sorted(r.status_code for r in responses) == [200, 409]
        state = api.get(BASE, headers=headers).json()["channels"]["email"]
        assert len(state["configurations"]) == 1 and state["defaultId"] == state["configurations"][0]["id"]
