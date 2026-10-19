"""Locale-independent Unicode case handling for the Language catalogue."""
from alembic import op
import sqlalchemy as sa

revision = "0048_language_unicode"
down_revision = "0047_languages"
branch_labels = depends_on = None


def upgrade():
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
