"""Dated total-suborder tariffs; no legacy conversion or date/price seeding."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0102_category_count_tariffs"
down_revision = "0100_applicable_gst"
branch_labels = depends_on = None


def upgrade():
    op.create_table("it_category_count_tariffs",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("category_id", UUID, sa.ForeignKey("product_categories.id"), nullable=False),
        sa.Column("allergen_count", sa.Integer, nullable=False),
        sa.Column("effective_from", sa.Date, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=False),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("category_id", "allergen_count", "effective_from", name="uq_it_tariff_date"),
        sa.UniqueConstraint("category_id", "allergen_count", "version", name="uq_it_tariff_version"),
        sa.CheckConstraint("allergen_count BETWEEN 1 AND 3 AND version >= 1", name="ck_it_tariff_count_version"),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_it_tariff_cipher"))
    op.execute("CREATE TRIGGER it_tariff_immutable BEFORE UPDATE OR DELETE ON it_category_count_tariffs FOR EACH ROW EXECUTE FUNCTION inventory_immutable()")
    op.execute("CREATE TRIGGER it_tariff_no_truncate BEFORE TRUNCATE ON it_category_count_tariffs FOR EACH STATEMENT EXECUTE FUNCTION inventory_immutable()")


def downgrade():
    raise RuntimeError("Dated tariff history is immutable; use reviewed recovery.")
