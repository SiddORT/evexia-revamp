"""Ordered MR zones, preserving the singular compatibility assignment."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0051_mr_zones"
down_revision = "0050_opening_stock"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "mr_zone_assignments",
        sa.Column("mr_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("mr_directory.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("zone_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("zones.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("zone_name", sa.String(200), nullable=False),
        sa.CheckConstraint("position >= 0", name="ck_mr_zone_position"),
    )
    op.create_index("uq_mr_zone_position", "mr_zone_assignments", ["mr_id", "position"], unique=True)
    op.create_index("ix_mr_zone_zone", "mr_zone_assignments", ["zone_id", "mr_id"])
    op.execute('INSERT INTO mr_zone_assignments SELECT id, "zoneId", 0, zone_name FROM mr_directory')
    op.execute("""
    CREATE FUNCTION evexia_mr_zone_integrity() RETURNS trigger AS $$
    DECLARE affected uuid;
    BEGIN
      IF TG_TABLE_NAME = 'mr_directory' THEN
        affected := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
      ELSE
        affected := CASE WHEN TG_OP = 'DELETE' THEN OLD.mr_id ELSE NEW.mr_id END;
      END IF;
      IF EXISTS (SELECT 1 FROM mr_directory d WHERE d.id = affected AND NOT EXISTS (
        SELECT 1 FROM mr_zone_assignments z WHERE z.mr_id = d.id AND z.zone_id = d."zoneId"
      )) THEN RAISE EXCEPTION 'MR primary zone must remain assigned' USING ERRCODE = '23514'; END IF;
      RETURN NULL;
    END; $$ LANGUAGE plpgsql;
    CREATE CONSTRAINT TRIGGER trg_mr_zone_parent AFTER INSERT OR UPDATE ON mr_directory
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION evexia_mr_zone_integrity();
    CREATE CONSTRAINT TRIGGER trg_mr_zone_members AFTER INSERT OR UPDATE OR DELETE ON mr_zone_assignments
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION evexia_mr_zone_integrity();
    """)


def downgrade():
    if op.get_bind().execute(sa.text("""
        SELECT EXISTS (SELECT 1 FROM mr_zone_assignments z JOIN mr_directory d ON d.id=z.mr_id
                       WHERE z.zone_id <> d."zoneId")
    """)).scalar():
        raise RuntimeError("Multiple MR assignments require a lossless forward correction or coordinated restore")
    op.execute("DROP TRIGGER trg_mr_zone_parent ON mr_directory")
    op.execute("DROP TRIGGER trg_mr_zone_members ON mr_zone_assignments")
    op.execute("DROP FUNCTION evexia_mr_zone_integrity()")
    op.drop_table("mr_zone_assignments")
