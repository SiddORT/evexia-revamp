"""Non-destructive encrypted defaults against populated historical disposable PG."""
from alembic import command
from sqlalchemy import text
from app.core.config import Settings
from app.services.directory_crypto import DirectoryCrypto
from test_migration_0006 import migration_db
from test_directory_staging import seed, runtime
from test_directory_retirement import stage
import pytest


def test_historical_encrypted_mr_backfill_preserves_ciphertext_and_tombstones(migration_db):
    engine, config, *_ = seed(migration_db)
    command.upgrade(config, "0029_directory_crypto_additive")
    with runtime(engine) as (role, _):
        stage(engine, config, role)
        command.upgrade(config, "0030_directory_crypto_retirement")
        with engine.connect() as connection:
            before = connection.execute(text('SELECT id, name_ciphertext, phone_ciphertext, deleted_at, version FROM mr_directory ORDER BY id')).all()
        from test_migration_0006 import upgrade_with_retirement_recovery
        upgrade_with_retirement_recovery(engine, config)
        crypto = DirectoryCrypto(Settings())
        with engine.connect() as connection:
            after = connection.execute(text('SELECT id, name_ciphertext, phone_ciphertext, deleted_at, version FROM mr_directory ORDER BY id')).all()
            regions = connection.execute(text('SELECT id, "dialCountry_ciphertext" FROM mr_directory')).all()
            assert not connection.scalar(text("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mr_directory' AND column_name='dialCountry')"))
        assert before == after and regions
        assert all(crypto.decrypt("mr_directory", row_id, "dialCountry", value) == "IN" for row_id, value in regions)
        with engine.begin() as connection:
            row_id = regions[0][0]
            connection.execute(text('UPDATE mr_directory SET "dialCountry_ciphertext"=:value WHERE id=:id'),
                {"id": row_id, "value": crypto.encrypt("mr_directory", row_id, "dialCountry", "SG")})
        with pytest.raises(RuntimeError, match="Refusing to discard"):
            command.downgrade(config, "0030_directory_crypto_retirement")
