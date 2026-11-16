"""Permanent Free kit policy and quota journal; no defaults or backfill."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0114_free_kit_limits"
down_revision = "0112_settlement_credits"
branch_labels = depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout='5s'")
    op.execute("SELECT pg_advisory_xact_lock(145580)")
    op.execute("SELECT pg_advisory_xact_lock(145581)")
    uid = UUID(as_uuid=True)
    op.create_table("free_kit_policy",
        sa.Column("version", sa.Integer(), primary_key=True),
        sa.Column("request_id", uid, nullable=False, unique=True),
        sa.Column("actor_id", uid, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("mr_cap", sa.Integer(), nullable=False),
        sa.Column("mr_period", sa.String(16), nullable=False),
        sa.Column("doctor_cap", sa.Integer(), nullable=False),
        sa.Column("doctor_period", sa.String(16), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("request_payload", JSONB(), nullable=False),
        sa.CheckConstraint("version > 0 AND mr_cap >= 0 AND doctor_cap >= 0", name="ck_free_kit_caps"),
        sa.CheckConstraint("mr_period IN ('financial_year','month') AND doctor_period IN ('financial_year','month')",
                           name="ck_free_kit_periods"))
    op.create_table("free_kit_use",
        sa.Column("order_id", uid, sa.ForeignKey("kits_orders.id"), primary_key=True),
        sa.Column("mr_id", uid, sa.ForeignKey("mr_directory.id"), nullable=False),
        sa.Column("doctor_id", uid, sa.ForeignKey("doctor_directory.id"), nullable=False),
        sa.Column("order_date", sa.Date(), nullable=False),
        sa.Column("policy_version", sa.Integer(), sa.ForeignKey("free_kit_policy.version"), nullable=False),
        sa.Column("order_version", sa.Integer(), nullable=False),
        sa.Column("actor_id", uid, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("marked_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("order_version > 1", name="ck_free_kit_order_version"))
    for dimension in ("mr", "doctor"):
        op.create_index(f"ix_free_kit_{dimension}_date", "free_kit_use", [f"{dimension}_id", "order_date"])
    for table in ("free_kit_policy", "free_kit_use"):
        op.execute(f"CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION inventory_immutable()")
        op.execute(f"CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE ON {table} FOR EACH STATEMENT EXECUTE FUNCTION inventory_immutable()")
        op.execute(f"CREATE TRIGGER {table}_actor BEFORE INSERT ON {table} FOR EACH ROW EXECUTE FUNCTION guard_credit_actor()")
    op.execute("""
        CREATE FUNCTION guard_free_kit_identity() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM free_kit_use u WHERE u.order_id=OLD.id) AND
              (NEW.mr_id IS DISTINCT FROM OLD.mr_id OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
               OR NEW.date IS DISTINCT FROM OLD.date OR NEW.order_for IS DISTINCT FROM OLD.order_for
               OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.payment_status IS DISTINCT FROM OLD.payment_status) THEN
            RAISE EXCEPTION 'Permanent Free kit attribution is immutable';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER kits_free_identity BEFORE UPDATE ON kits_orders
          FOR EACH ROW EXECUTE FUNCTION guard_free_kit_identity();
    """)


def downgrade():
    raise RuntimeError("Permanent Free kit evidence and quota consumption must be retained.")
