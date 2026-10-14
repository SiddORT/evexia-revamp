"""Synthetic readiness state for empty create_all schemas, not migration evidence."""
from sqlalchemy import func, select, text

from app.core.schema import SCHEMA_REVISION
from app.db.models import AccountCryptoState, User
from app.services.account_crypto import crypto


def initialize_empty_metadata_accounts(db):
    """Only the private file fixture may synthesize its final-schema metadata."""
    assert db.scalar(text("SELECT current_schema()")).startswith("file_test_")
    assert db.scalar(text("SHOW data_directory")).startswith("/tmp/evexia-api-test.")
    assert db.scalar(select(func.count()).select_from(User)) == 0
    assert db.scalar(select(func.count()).select_from(AccountCryptoState)) == 0
    db.execute(text("CREATE TABLE alembic_version (version_num varchar(32) PRIMARY KEY)"))
    db.execute(text("INSERT INTO alembic_version VALUES (:revision)"), {"revision": SCHEMA_REVISION})
    current = crypto()
    db.add(AccountCryptoState(
        id=1, configuration_digest=current.configuration(),
        protected_email_index=current.lookup_index("crm-admin@allergyevexia.in"),
    ))
    db.commit()
