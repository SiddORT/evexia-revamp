"""Corrupt/legacy inventories must be reported, not guessed or repaired."""
from types import SimpleNamespace
import uuid
import pytest
from app.services.account_crypto import AccountCryptoError, crypto
from app.services.account_migration import inventory


class InventoryInput:
    def __init__(self, users, reservations):
        self.users, self.reservations = users, reservations

    def execute(self, statement):
        rows = self.users if "FROM users" in str(statement) else self.reservations
        return SimpleNamespace(mappings=lambda: SimpleNamespace(all=lambda: rows))

    def scalar(self, statement):
        return next(iter(statement.compile().params.values())).lower()


def user(owner, email, username):
    return dict(id=owner, email=email, username=username, system_role=None,
                is_protected_system_admin=False, is_active=True)


@pytest.mark.parametrize("problem", ["duplicate_namespace", "invalid_reservation",
                                     "missing_or_conflicting_reservation", "invalid_identifier"])
def test_preflight_rejects_corrupt_inventory_without_exposing_values(monkeypatch, problem):
    import app.services.account_migration as module
    monkeypatch.setattr(module.sa, "inspect", lambda db: SimpleNamespace(get_indexes=lambda table: []))
    owner, other = uuid.uuid4(), uuid.uuid4()
    users = [user(owner, "person@example.com", "first.alias")]
    reservations = [dict(identifier="person@example.com", user_id=owner),
                    dict(identifier="first.alias", user_id=owner)]
    if problem == "duplicate_namespace":
        users.append(user(other, "PERSON@example.com", "second.alias"))
        reservations.append(dict(identifier="second.alias", user_id=other))
    elif problem == "invalid_reservation":
        reservations[0]["user_id"] = other
    elif problem == "missing_or_conflicting_reservation":
        reservations.pop()
    else:
        users[0]["username"] = " invalid.alias "
    with pytest.raises(AccountCryptoError, match=problem) as error:
        inventory(InventoryInput(users, reservations), crypto())
    assert str(owner) in str(error.value)
    assert "person@example.com" not in str(error.value).lower()
    assert "first.alias" not in str(error.value)


def test_postgres_normalization_mismatch_is_not_reassigned(monkeypatch):
    import app.services.account_migration as module
    monkeypatch.setattr(module.sa, "inspect", lambda db: SimpleNamespace(get_indexes=lambda table: []))
    owner = uuid.uuid4()
    data = InventoryInput([user(owner, "person@example.com", "İ")], [])
    original = data.scalar
    data.scalar = lambda statement: "i" if next(iter(statement.compile().params.values())) == "İ" else original(statement)
    with pytest.raises(AccountCryptoError, match="invalid_identifier"):
        inventory(data, crypto())


@pytest.mark.parametrize("definition", [
    {"column_names": [None], "expressions": ["lower(trim(email))"]},
    {"column_names": ["id"], "dialect_options": {"postgresql_where": "username IS NOT NULL"}},
])
def test_unreviewed_expression_or_partial_index_blocks_before_changes(monkeypatch, definition):
    import app.services.account_migration as module
    definition["name"] = "unreviewed_operator_index"
    monkeypatch.setattr(module.sa, "inspect",
                        lambda db: SimpleNamespace(get_indexes=lambda table: [definition]))
    with pytest.raises(AccountCryptoError, match="Unreviewed account identifier index"):
        inventory(InventoryInput([], []), crypto())
