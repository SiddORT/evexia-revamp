"""Encrypted MR phone region; no plaintext mirror or identity reindexing.

Apply only with operator approval on managed databases. Backfill preserves
historical India semantics, including soft-deleted records, in one transaction.
"""
from alembic import op
import sqlalchemy as sa
from app.core.config import Settings
from app.services.directory_crypto import DirectoryCrypto

revision = "0034_shared_phone_countries"
down_revision = "0033_merge_directory_branches"
branch_labels = depends_on = None


def upgrade():
    connection = op.get_bind()
    crypto = DirectoryCrypto(Settings())
    connection.execute(sa.text("LOCK TABLE mr_directory IN ACCESS EXCLUSIVE MODE"))
    op.add_column("mr_directory", sa.Column("dialCountry_ciphertext", sa.Text(), nullable=True))
    # Keyset batches keep memory bounded; DDL and all rows share the transaction.
    after = None
    while True:
        rows = connection.execute(sa.text(
            "SELECT id FROM mr_directory WHERE (CAST(:after AS uuid) IS NULL OR id > CAST(:after AS uuid)) ORDER BY id LIMIT 500"
        ), {"after": str(after) if after else None}).all()
        if not rows:
            break
        for (record_id,) in rows:
            connection.execute(sa.text('UPDATE mr_directory SET "dialCountry_ciphertext"=:value WHERE id=:id'),
                {"id": record_id, "value": crypto.encrypt("mr_directory", record_id, "dialCountry", "IN")})
        after = rows[-1][0]
    # Validate deferred identity guards before DDL, without disabling them.
    connection.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
    op.alter_column("mr_directory", "dialCountry_ciphertext", existing_type=sa.Text(), nullable=False)


def downgrade():
    connection = op.get_bind()
    connection.execute(sa.text("LOCK TABLE mr_directory IN ACCESS EXCLUSIVE MODE"))
    crypto = DirectoryCrypto(Settings())
    for row in connection.execute(sa.text('SELECT id, "dialCountry_ciphertext" FROM mr_directory')):
        # The preceding schema implies India, so only verified India values
        # can be represented losslessly there. Never discard global selections.
        if crypto.decrypt("mr_directory", row.id, "dialCountry", row.dialCountry_ciphertext) != "IN":
            raise RuntimeError("Refusing to discard encrypted MR country selections; approved recovery is required.")
    op.drop_column("mr_directory", "dialCountry_ciphertext")
