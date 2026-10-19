"""Locale-independent Unicode case handling for the Language catalogue."""
from alembic import op
import sqlalchemy as sa

revision = "0048_language_unicode"
down_revision = "0047_languages"
branch_labels = depends_on = None


def upgrade():
    connection = op.get_bind()
    collation = connection.execute(sa.text("""
        SELECT c.collprovider, c.collisdeterministic, n.nspname,
               coalesce(to_jsonb(c)->>'colllocale',
                        to_jsonb(c)->>'colliculocale') AS locale
        FROM pg_catalog.pg_collation c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.collnamespace
        WHERE c.oid = to_regcollation('pg_c_utf8')
    """)).mappings().first()
    if collation is None:
        # PostgreSQL 16 lacks the PG17 builtin. ICU's deterministic root
        # collation supplies Unicode lowercasing without relying on OS locale.
        # This schema-owned alias and the index are created in one transaction.
        op.execute('CREATE COLLATION "pg_c_utf8" FROM pg_catalog."und-x-icu"')
    elif not (collation["collisdeterministic"] and (
            (collation["collprovider"] == "b" and collation["nspname"] == "pg_catalog")
            or (collation["collprovider"] == "i" and collation["locale"] == "und"))):
        raise RuntimeError("Language uniqueness requires a deterministic Unicode root collation")
    # Transactional replacement: if existing Unicode names collide, index
    # creation fails and the old index remains. Never merge/rename user records.
    op.drop_index("uq_languages_live_name", table_name="languages")
    op.create_index("uq_languages_live_name", "languages",
                    [sa.text('lower(name COLLATE "pg_c_utf8")')], unique=True,
                    postgresql_where=sa.text("deleted_at IS NULL"))


def downgrade():
    op.drop_index("uq_languages_live_name", table_name="languages")
    op.create_index("uq_languages_live_name", "languages", [sa.text("lower(name)")], unique=True,
                    postgresql_where=sa.text("deleted_at IS NULL"))
