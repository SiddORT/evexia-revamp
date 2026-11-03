"""Add expiry/cost/disposal evidence without interpreting historical snapshots."""
from alembic import op
import sqlalchemy as sa

revision = "0084_allergen_expiry"
down_revision = "0083_immunotherapy_batches"
branch_labels = depends_on = None


def upgrade():
    op.create_table("inventory_batch_costs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("source_kind", sa.String(7), nullable=False),
        sa.Column("batch_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.UniqueConstraint("source_kind", "batch_id", name="uq_batch_cost_source"),
        sa.CheckConstraint("source_kind IN ('lot','reserve')", name="ck_batch_cost_kind"))
    op.create_table("inventory_expiry_disposals",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("source_kind", sa.String(7), nullable=False),
        sa.Column("batch_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("audit_events.id"), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False))
    op.create_table("inventory_expiry_requests",
        sa.Column("key", sa.Uuid(), primary_key=True),
        sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False))
    op.create_table("inventory_expiry_scans",
        sa.Column("source_kind", sa.String(7), primary_key=True),
        sa.Column("cursor", sa.Uuid()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("inventory_expiry_separations",
        sa.Column("source_kind", sa.String(7), primary_key=True),
        sa.Column("batch_id", sa.Uuid(), primary_key=True),
        sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("inventory_expiry_digests",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("category", sa.String(80)),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("token", sa.Uuid(), nullable=False),
        sa.CheckConstraint("status IN ('preparing','sending','blocked','failed','unknown','accepted')", name="ck_expiry_digest_status"))
    op.create_table("inventory_expiry_templates",
        sa.Column("key", sa.String(30), primary_key=True),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("introduction", sa.Text(), nullable=False))
    op.execute("INSERT INTO inventory_expiry_templates (key,subject,introduction) VALUES "
               "('daily_admin','EVEXIA — daily allergen expiry digest','Expiry-today stock is already unusable. Quantities remain at their saved physical locations. Sign in to review inventory.')")
    op.alter_column("in_house_postings", "movement_id", nullable=True)
    op.add_column("in_house_postings", sa.Column("disposal_id", sa.Uuid(), sa.ForeignKey("inventory_expiry_disposals.id")))
    op.create_check_constraint("ck_reserve_posting_origin", "in_house_postings",
        "(movement_id IS NOT NULL AND disposal_id IS NULL) OR (movement_id IS NULL AND disposal_id IS NOT NULL)")
    op.create_unique_constraint("uq_reserve_disposal_posting", "in_house_postings", ["disposal_id", "reserve_id", "location_id"])
    # Evidence is append-only even for privileged application writers.
    op.execute("""CREATE FUNCTION protect_expiry_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Expiry evidence is append only'; END $$""")
    for table in ("inventory_batch_costs", "inventory_expiry_disposals", "inventory_expiry_separations"):
        op.execute(f"CREATE TRIGGER immutable_expiry_evidence BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION protect_expiry_evidence()")


def downgrade():
    raise RuntimeError("Actual costs, disposal and daily handoff evidence must not be discarded.")
