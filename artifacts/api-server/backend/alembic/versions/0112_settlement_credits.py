"""Empty append-only non-cash credits; no invoice issuance or financial backfill."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0112_settlement_credits"
down_revision = "0110_retire_legacy_pricing"
branch_labels = depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout='5s'")
    op.execute("SELECT pg_advisory_xact_lock(145580)")
    uid = postgresql.UUID(as_uuid=True)
    op.execute("CREATE SEQUENCE settlement_credit_number_seq AS bigint START WITH 1 NO CYCLE")
    op.create_table("settlement_credit_notes",
        sa.Column("id", uid, primary_key=True),
        sa.Column("sequence", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("order_id", uid, nullable=False),
        sa.Column("mr_id", uid, sa.ForeignKey("mr_directory.id")),
        sa.Column("actor_id", uid, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.CheckConstraint("kind IN ('IT','Kit','SPT','Lupin')", name="ck_credit_kind"),
        sa.CheckConstraint("sequence > 0", name="ck_credit_sequence"),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_credit_cipher"))
    op.create_index("ix_credit_order", "settlement_credit_notes", ["kind", "order_id"])
    op.create_index("ix_credit_date", "settlement_credit_notes", ["date", "id"])
    op.create_index("ix_credit_mr_date", "settlement_credit_notes", ["mr_id", "date", "id"])
    op.create_table("settlement_credit_reversals",
        sa.Column("id", uid, primary_key=True),
        sa.Column("note_id", uid, sa.ForeignKey("settlement_credit_notes.id"), nullable=False, unique=True),
        sa.Column("actor_id", uid, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_credit_reversal_cipher"))
    op.create_table("settlement_credit_requests",
        sa.Column("id", uid, primary_key=True),
        sa.Column("actor_id", uid, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_ciphertext", sa.Text(), nullable=False),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_credit_request_cipher"))
    for table in ("settlement_credit_notes", "settlement_credit_reversals", "settlement_credit_requests"):
        op.execute(f"""
          CREATE TRIGGER {table}_immutable BEFORE UPDATE OR DELETE ON {table}
          FOR EACH ROW EXECUTE FUNCTION guard_settlement_immutable()
        """)
    op.execute("""
      CREATE FUNCTION guard_credit_actor() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM users WHERE id=NEW.actor_id
            AND is_protected_system_admin AND is_active AND system_role='super_admin') THEN
          RAISE EXCEPTION 'Credit actor must be the protected Super Admin';
        END IF;
        RETURN NEW;
      END $$;
      CREATE FUNCTION guard_credit_order() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE source_table text; found_id uuid; found_mr uuid;
      BEGIN
        source_table := CASE NEW.kind WHEN 'IT' THEN 'immunotherapy_orders'
          WHEN 'Kit' THEN 'kits_orders' WHEN 'SPT' THEN 'spt_orders' WHEN 'Lupin' THEN 'lupin_orders' END;
        IF source_table IS NULL THEN RAISE EXCEPTION 'Invalid credit order type'; END IF;
        EXECUTE format('SELECT id,mr_id FROM %I WHERE id=$1 FOR KEY SHARE', source_table)
          INTO found_id,found_mr USING NEW.order_id;
        IF found_id IS NULL OR found_mr IS DISTINCT FROM NEW.mr_id THEN
          RAISE EXCEPTION 'Credit saved order association is invalid';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER settlement_credit_order BEFORE INSERT ON settlement_credit_notes
        FOR EACH ROW EXECUTE FUNCTION guard_credit_order();
    """)
    for table in ("settlement_credit_notes", "settlement_credit_reversals", "settlement_credit_requests"):
        op.execute(f"""
          CREATE TRIGGER {table}_actor BEFORE INSERT ON {table}
          FOR EACH ROW EXECUTE FUNCTION guard_credit_actor()
        """)


def downgrade():
    raise RuntimeError("Credit notes, numbers, reversals and retry evidence must be retained.")
