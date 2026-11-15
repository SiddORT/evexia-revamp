"""Independent append-only combination configuration status; no repricing."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0106_combination_rule_status"
down_revision = "0104_combination_pricing"
branch_labels = depends_on = None


def upgrade():
    op.create_table("it_combination_rule_status",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("category_id", UUID, sa.ForeignKey("product_categories.id"), nullable=False),
        sa.Column("dosage", sa.String(2), nullable=False),
        sa.Column("member_key", sa.String(110), nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("revision_id", UUID, sa.ForeignKey("it_combination_tariffs.id"), nullable=False),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("category_id", "dosage", "member_key", "version", name="uq_it_combination_status_version"),
        sa.CheckConstraint("version >= 1", name="ck_it_combination_status_version"),
        sa.CheckConstraint("status IN ('active','inactive')", name="ck_it_combination_status"))
    op.execute("CREATE TRIGGER it_combination_status_immutable BEFORE UPDATE OR DELETE ON it_combination_rule_status FOR EACH ROW EXECUTE FUNCTION inventory_immutable()")
    op.execute("CREATE TRIGGER it_combination_status_no_truncate BEFORE TRUNCATE ON it_combination_rule_status FOR EACH STATEMENT EXECUTE FUNCTION inventory_immutable()")
    # Persist a baseline for every configured key. This is NOT a historical
    # activation: version 1 is labelled Initial Active baseline by the reader.
    # actor_id identifies the source rate actor, recorded_at is initialization
    # time, and revision_id preserves the exact provenance without rewriting it.
    op.execute("""
        INSERT INTO it_combination_rule_status
          (id,category_id,dosage,member_key,version,status,revision_id,actor_id,recorded_at)
        SELECT id,category_id,dosage,member_key,1,'active',id,actor_id,CURRENT_TIMESTAMP
        FROM (
          SELECT DISTINCT ON (category_id,dosage,member_key)
            id,category_id,dosage,member_key,actor_id
          FROM it_combination_tariffs
          ORDER BY category_id,dosage,member_key,version
        ) initial
    """)


def downgrade():
    raise RuntimeError("Configuration status history is immutable; use reviewed recovery.")
