"""Optional saved Doctor Area and honest immutable assignment baselines."""
import uuid
import hmac
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0108_doctor_mr_mapping"
down_revision = "0106_territory_assignments"
branch_labels = depends_on = None


def upgrade():
    # This migration is prepared only. A future approved operator run requires
    # the retained Directory keyring to authenticate all baseline snapshots.
    from app.core.config import get_settings
    from app.services.directory_crypto import DirectoryCrypto
    from app.services.directory_staging import _configuration_digest
    crypto = DirectoryCrypto(get_settings())
    bind = op.get_bind()
    # Exclude assignment/identity writes while the current-state evidence is
    # captured. No assignment date, creator or historical reason is inferred.
    bind.execute(sa.text("LOCK TABLE directory_crypto_stage, doctor_directory, mr_directory IN SHARE ROW EXCLUSIVE MODE"))
    stage = bind.execute(sa.text(
        "SELECT phase,configuration_digest,index_key_check FROM directory_crypto_stage WHERE id=1"
    )).one()
    if (stage.phase != "encrypted" or not stage.configuration_digest or not stage.index_key_check
            or not hmac.compare_digest(stage.configuration_digest, _configuration_digest(crypto))
            or not hmac.compare_digest(stage.index_key_check, crypto._index("configuration", ["index-key-check"]))):
        raise RuntimeError("Finish Directory maintenance and verify its configuration before adding mapping history.")
    op.add_column("doctor_directory", sa.Column("areaVersion", sa.Integer, nullable=False, server_default="1"))
    op.create_check_constraint("ck_doctor_area_version", "doctor_directory", '"areaVersion" >= 1')
    op.create_table("doctor_assignment_events",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("doctor_id", UUID, sa.ForeignKey("doctor_directory.id"), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload_ciphertext", sa.Text, nullable=False),
        sa.CheckConstraint("kind IN ('baseline','initial','transfer','area')", name="ck_doctor_assignment_kind"),
        sa.CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_doctor_assignment_cipher"))
    op.create_index("ix_doctor_assignment_timeline", "doctor_assignment_events", ["doctor_id", "recorded_at", "id"])
    # Keyset batches bound migration memory without skipping tombstoned Doctors.
    last = None
    while True:
        rows = list(bind.execute(sa.text("""
            SELECT d.id,d."doctorNumber",d.name_ciphertext,d."mrId",d."areaId",
                   m.name_ciphertext AS mr_name,m."employeeCode",a.name AS area_name,h.name AS hq_name
            FROM doctor_directory d LEFT JOIN mr_directory m ON m.id=d."mrId"
            LEFT JOIN headquarter_areas a ON a.id=d."areaId"
            LEFT JOIN headquarters h ON h.id=a.headquarter_id
            WHERE (CAST(:last AS uuid) IS NULL OR d.id > CAST(:last AS uuid))
            ORDER BY d.id LIMIT 200
        """), {"last": str(last) if last else None}).mappings())
        if not rows:
            break
        for row in rows:
            event_id = uuid.uuid4()
            mr = (dict(id=str(row["mrId"]), name=crypto.decrypt(
                "mr_directory", row["mrId"], "name", row["mr_name"]),
                number=row["employeeCode"]) if row["mr_name"] else None)
            payload = dict(doctor=dict(id=str(row["id"]), name=crypto.decrypt(
                "doctor_directory", row["id"], "name", row["name_ciphertext"]), number=row["doctorNumber"]),
                previousMR=None, newMR=mr, previousArea=None,
                newArea=(dict(id=str(row["areaId"]), name=row["area_name"], headquarter=row["hq_name"])
                         if row["areaId"] else None),
                actor=dict(id=None, name="Opening/current-state baseline; original actor unknown"),
                reason="Original assignment date and reason unknown")
            bind.execute(sa.text("""
                INSERT INTO doctor_assignment_events
                (id,doctor_id,kind,actor_id,recorded_at,payload_ciphertext)
                VALUES (:id,:doctor,'baseline',NULL,CURRENT_TIMESTAMP,:cipher)
            """), dict(id=event_id, doctor=row["id"], cipher=crypto.encrypt_mapping(event_id, payload)))
        last = rows[-1]["id"]
    op.execute("CREATE TRIGGER doctor_assignment_immutable BEFORE UPDATE OR DELETE ON doctor_assignment_events FOR EACH ROW EXECUTE FUNCTION inventory_immutable()")
    op.execute("CREATE TRIGGER doctor_assignment_no_truncate BEFORE TRUNCATE ON doctor_assignment_events FOR EACH STATEMENT EXECUTE FUNCTION inventory_immutable()")


def downgrade():
    raise RuntimeError("Doctor assignment evidence is immutable; use reviewed recovery.")
