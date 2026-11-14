"""Add configuration-only combination prices; retain every legacy/count revision."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0104_combination_pricing"
down_revision = "0102_category_count_tariffs"
branch_labels = depends_on = None


def upgrade():
    op.create_table("it_combination_tariffs",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("category_id", UUID, sa.ForeignKey("product_categories.id"), nullable=False),
        sa.Column("dosage", sa.String(2), nullable=False),
        sa.Column("member_key", sa.String(110), nullable=False),
        sa.Column("effective_from", sa.Date, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=False),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("category_id", "dosage", "member_key", "effective_from", name="uq_it_combination_date"),
        sa.UniqueConstraint("category_id", "dosage", "member_key", "version", name="uq_it_combination_version"),
        sa.CheckConstraint("version >= 1", name="ck_it_combination_version"),
        sa.CheckConstraint("dosage IN ('PD','DD','B1','B2','B3','B4','B5','B6','B7','B8')", name="ck_it_combination_dosage"),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_it_combination_cipher"))
    op.execute("CREATE TRIGGER it_combination_immutable BEFORE UPDATE OR DELETE ON it_combination_tariffs FOR EACH ROW EXECUTE FUNCTION inventory_immutable()")
    op.execute("CREATE TRIGGER it_combination_no_truncate BEFORE TRUNCATE ON it_combination_tariffs FOR EACH STATEMENT EXECUTE FUNCTION inventory_immutable()")


def downgrade():
    raise RuntimeError("Combination price history is immutable; use reviewed recovery.")
