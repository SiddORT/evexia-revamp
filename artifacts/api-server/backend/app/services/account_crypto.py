"""Account-specific authenticated encryption and a shared login namespace.

Reuses the directory keyring, never its AAD or blind-index domain. Identifiers
remain exact authored strings; normalization is only for lookup/uniqueness.
"""
import hashlib
import hmac
import logging
from types import SimpleNamespace

from sqlalchemy import func, or_, select, text

from app.core.config import get_settings
from app.services.directory_inventory import DirectoryCryptoError
from app.services.staff_crypto import StaffCrypto


class AccountCryptoError(DirectoryCryptoError):
    message = "Account encryption unavailable; operator review is required."
    status = 503
    code = "account_crypto_unavailable"

    def __init__(self, message=None):
        self.message = message or self.message
        Exception.__init__(self, self.message)


class AccountCrypto(StaffCrypto):
    def __init__(self, settings):
        # Validate this keyring through the established primitive. An unrelated
        # broken Staff key must not disable otherwise valid account sessions.
        try:
            super().__init__(SimpleNamespace(
                staff_encryption_keys=settings.directory_encryption_keys,
                staff_encryption_key_id=settings.directory_encryption_key_id,
                staff_email_index_key=settings.directory_index_key,
                signing_key=settings.signing_key,
            ))
        except Exception:
            raise AccountCryptoError() from None

    @staticmethod
    def aad(record_id, field):
        if field not in ("email", "username"):
            raise AccountCryptoError()
        return f"evexia:account:v1:{record_id}:{field}".encode()

    @staticmethod
    def validate(field, value):
        if value is None:
            return
        maximum = 320 if field == "email" else 32
        if (not isinstance(value, str) or not value or len(value) > maximum
                or value != value.strip() or any(ord(c) < 32 or ord(c) == 127 for c in value)):
            raise AccountCryptoError()

    def encrypt(self, record_id, field, value):
        try:
            self.validate(field, value)
            return None if value is None else StaffCrypto.encrypt(self, record_id, field, value)
        except Exception:
            raise AccountCryptoError() from None

    def decrypt(self, record_id, field, value):
        try:
            result = None if value is None else StaffCrypto.decrypt(self, record_id, field, value)
            self.validate(field, result)
            return result
        except Exception:
            raise AccountCryptoError() from None

    def lookup_index(self, normalized):
        # Same domain for both fields: email/username and historical identifiers
        # share one namespace, rather than permitting cross-column collisions.
        return hmac.new(self.index_key, b"evexia:account:lookup:v1\0" +
                        normalized.encode(), hashlib.sha256).hexdigest()

    def configuration(self):
        # Pin the stable lookup key; adding an encryption key must not invalidate
        # every login. Every field still authenticates against its retained key.
        return self.lookup_index("configuration:v1")


def crypto():
    try:
        return AccountCrypto(get_settings())
    except Exception:
        raise AccountCryptoError() from None


def ready(db):
    engine = db.get_bind().engine
    if (engine.echo or logging.getLogger("sqlalchemy.engine").isEnabledFor(logging.INFO)
            or logging.getLogger("sqlalchemy.engine.Engine").isEnabledFor(logging.INFO)):
        raise AccountCryptoError()
    revisions = db.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
    # Explicitly reviewed successors do not alter account storage or its anchors.
    # 0041 adds only Storage Location geography; 0042 changes catalogue rates,
    # not account ciphertext/index contracts. Never infer future compatibility.
    if revisions not in (
        ["0035_account_identifiers"], ["0036_reference_privacy"],
        ["0037_domain_admission"], ["0038_purchase_orders"],
        ["0039_communication"], ["0040_po_tax_basis"], ["0041_location_geography"],
        ["0042_rate_hundredths"],
        ["0043_email_templates"],
        # Additive PR tables leave the account ciphertext/index anchors unchanged.
        ["0044_purchase_received"],
        # Batch-only additive policy/counters do not change account encryption.
        ["0045_pr_batch_numbers"],
        # Additive inventory has no account fields or configuration anchors.
        ["0046_live_inventory"],
        # Name-only language catalogue/history leave account anchors unchanged.
        ["0047_languages"],
        # Language Unicode index only; no account storage/anchor changes.
        ["0048_language_unicode"],
        # Reviewed product-only branch and its language-history merge preserve
        # all account ciphertext/anchors. No arbitrary future schemas accepted.
        ["0047_stock_products"], ["0049_product_language_merge"],
        # Physical opening sources preserve account encryption and anchors.
        ["0050_opening_stock"],
        # Nullable HQ zone links and child areas change no account anchors.
        ["0051_headquarter_areas"],
        # MR assignment links and the no-op reconciliation preserve anchors too.
        ["0051_mr_zones"], ["0052_hq_mr_zones_merge"],
        # Email evidence uses its own AAD/index domain and unchanged account keys.
        ["0053_email_invitations"],
        # Reviewed template presentation/test-evidence successor changes no
        # account ciphertext, blind indexes, reservations or encryption anchors.
        ["0054_modern_email_tests"],
        # Nullable Staff manager references/snapshots leave account anchors intact.
        ["0055_mr_staff_managers"],
        # Reviewed Staff business-label widening changes no account identifiers,
        # lookup keys, reservations, login roles or encryption anchors.
        ["0056_staff_business_roles"],
        # Optional Staff business metadata does not alter account identity/keys.
        ["0057_staff_employee_code"],
        ["0058_master_numbers"],
        ["0059_staff_unified_access"],
        # Reviewed sequence/backfill leaves encryption envelopes and keys intact.
        ["0060_staff_account_numbers"],
        ["0061_immunotherapy_orders"],
        ["0062_kits_orders"],
    ):
        raise AccountCryptoError()
    current = crypto()
    row = db.execute(text(
        "SELECT configuration_digest, protected_email_index FROM account_crypto_state WHERE id=1"
    )).one_or_none()
    if (row is None or not hmac.compare_digest(row.configuration_digest, current.configuration())
            or not hmac.compare_digest(row.protected_email_index,
                                      current.lookup_index("crm-admin@allergyevexia.in"))):
        raise AccountCryptoError()
    return current


def index(db, value):
    # Stored identifiers already passed the PostgreSQL/Python agreement check
    # during migration or before_flush. Lookups never send the identifier to SQL.
    return ready(db).lookup_index(value.lower())


def lookup(db, value):
    from app.db.models import User
    digest = index(db, value)
    return or_(User.email_index == digest, User.username_index == digest)


def read(record_id, field, ciphertext, digest=None):
    if (ciphertext is None) != (digest is None):
        raise AccountCryptoError()
    current = crypto()
    value = current.decrypt(record_id, field, ciphertext)
    if digest is not None and (value is None or not hmac.compare_digest(
            current.lookup_index(value.lower()), digest)):
        raise AccountCryptoError()
    return value


def matching_user_ids(db, query, *, label_only=False):
    """Explicit finite identifier scan; no substring index or credential load."""
    from app.db.models import User
    ready(db)
    rows = db.execute(select(User.id, User.username_ciphertext, User.email_ciphertext,
                             User.username_index, User.email_index).limit(10001)).all()
    if len(rows) > 10000:
        raise AccountCryptoError()
    term = query.lower()
    result = []
    for row in rows:
        username = read(row.id, "username", row.username_ciphertext, row.username_index)
        email = read(row.id, "email", row.email_ciphertext, row.email_index)
        values = [username or email] if label_only else [username, email]
        if any(term in (value or "").lower() for value in values):
            result.append(row.id)
    return result
