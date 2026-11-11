"""Permit one-way verification only; preserve immutable financial evidence."""
from alembic import op

revision = "0090_settlement_verification"
down_revision = "0089_invoice_settings"
branch_labels = depends_on = None


def upgrade():
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("""
      CREATE FUNCTION guard_settlement_entry_verification() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'Settlement transactions cannot be deleted';
        END IF;
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
           OR NEW.kind IS DISTINCT FROM OLD.kind
           OR NEW.order_id IS DISTINCT FROM OLD.order_id
           OR NEW.payload_ciphertext IS DISTINCT FROM OLD.payload_ciphertext THEN
          RAISE EXCEPTION 'Settlement financial evidence is immutable';
        END IF;
        IF OLD.verified_at IS NOT NULL OR OLD.verified_by IS NOT NULL
           OR NEW.verified_at IS NULL OR NEW.verified_by IS NULL THEN
          RAISE EXCEPTION 'Settlement verification is one-way';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.verified_by
                       AND is_protected_system_admin AND is_active
                       AND system_role = 'super_admin') THEN
          RAISE EXCEPTION 'Settlement verifier must be the protected Super Admin';
        END IF;
        RETURN NEW;
      END $$;
      DROP TRIGGER settlement_entries_immutable ON settlement_entries;
      CREATE TRIGGER settlement_entries_immutable BEFORE UPDATE OR DELETE ON settlement_entries
        FOR EACH ROW EXECUTE FUNCTION guard_settlement_entry_verification();
    """)


def downgrade():
    raise RuntimeError("Verified settlement evidence is durable; destructive downgrade is unsupported.")
