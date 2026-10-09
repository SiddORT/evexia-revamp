"""Additive ciphertext staging only: no automatic backfill, cutover or retirement."""
from alembic import op
import sqlalchemy as sa
from app.services.directory_inventory import FIELDS, INDEX_COLUMNS

revision = "0029_directory_crypto_additive"
down_revision = "0028_staff_designation_lifecycle"
branch_labels = depends_on = None


def upgrade():
    for table, fields in FIELDS.items():
        for field in fields:
            op.add_column(table, sa.Column(field + "_ciphertext", sa.Text(), nullable=True))
        for column in INDEX_COLUMNS[table]:
            # Final lookup/uniqueness constraints belong to coordinated cutover.
            op.add_column(table, sa.Column(column, sa.String(64), nullable=True))
    op.create_table(
        "directory_crypto_stage",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("phase", sa.String(16), nullable=False),
        sa.Column("maintenance_role", sa.String(63)),
        sa.Column("runtime_role", sa.String(63)),
        sa.Column("backup_ref", sa.Uuid()),
        sa.Column("change_ref", sa.Uuid()),
        sa.Column("configuration_digest", sa.String(64)),
        sa.Column("source_digest", sa.String(64)),
        sa.CheckConstraint("id = 1", name="ck_directory_crypto_singleton"),
        sa.CheckConstraint("phase IN ('additive','frozen')", name="ck_directory_crypto_phase"),
    )
    db = op.get_bind()
    db.execute(sa.text("INSERT INTO directory_crypto_stage(id,phase) VALUES (1,'additive')"))
    # This table must not be part of the normal API's grant set.
    db.execute(sa.text("REVOKE ALL ON directory_crypto_stage FROM PUBLIC"))
    schema = db.scalar(sa.text("SELECT current_schema()"))
    quoted = db.dialect.identifier_preparer.quote_schema(schema)
    db.execute(sa.text(f"""
        CREATE FUNCTION {quoted}.directory_crypto_write_guard() RETURNS trigger
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
        DECLARE stage record;
        BEGIN
          SELECT phase, maintenance_role INTO STRICT stage
            FROM {quoted}.directory_crypto_stage WHERE id = 1;
          IF stage.phase = 'frozen' AND session_user <> stage.maintenance_role THEN
            RAISE EXCEPTION 'Directory maintenance in progress' USING ERRCODE = '55000';
          END IF;
          RETURN NULL;
        END $$;
    """))
    db.execute(sa.text(f"REVOKE ALL ON FUNCTION {quoted}.directory_crypto_write_guard() FROM PUBLIC"))
    for table in (*FIELDS, "patients"):
        db.execute(sa.text(f"""
          CREATE TRIGGER directory_crypto_write_guard
          BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON {quoted}.{table}
          FOR EACH STATEMENT EXECUTE FUNCTION {quoted}.directory_crypto_write_guard()
        """))


def downgrade():
    db = op.get_bind()
    # No downgrade may silently throw away staged ciphertext or frozen evidence.
    db.execute(sa.text("LOCK TABLE directory_crypto_stage, doctor_directory, mr_directory, "
                       "patient_directory, patients IN ACCESS EXCLUSIVE MODE NOWAIT"))
    if db.scalar(sa.text("SELECT phase <> 'additive' FROM directory_crypto_stage WHERE id=1")):
        raise RuntimeError("Directory maintenance is frozen; approved recovery is required.")
    for table, fields in FIELDS.items():
        checks = [f'"{field}_ciphertext" IS NOT NULL' for field in fields]
        checks.extend(f'"{column}" IS NOT NULL' for column in INDEX_COLUMNS[table])
        if db.scalar(sa.text(f"SELECT EXISTS (SELECT 1 FROM {table} WHERE {' OR '.join(checks)})")):
            raise RuntimeError("Staged directory encryption exists; downgrade would discard evidence.")
    for table in (*FIELDS, "patients"):
        db.execute(sa.text(f"DROP TRIGGER directory_crypto_write_guard ON {table}"))
    db.execute(sa.text("DROP FUNCTION directory_crypto_write_guard()"))
    op.drop_table("directory_crypto_stage")
    for table, fields in FIELDS.items():
        for column in INDEX_COLUMNS[table]:
            op.drop_column(table, column)
        for field in fields:
            op.drop_column(table, field + "_ciphertext")
