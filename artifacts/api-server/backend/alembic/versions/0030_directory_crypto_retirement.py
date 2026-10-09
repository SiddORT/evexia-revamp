"""Separately approved coordinated cutover; verified plaintext retirement."""
import hmac
import uuid
from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.orm import Session
from app.core.config import Settings
from app.services.directory_crypto import DirectoryCrypto
from app.services.directory_inventory import FIELDS, INDEX_COLUMNS, NULLABLE_FIELDS
from app.services import directory_staging as staging

revision = "0030_directory_crypto_retirement"
down_revision = "0029_directory_crypto_additive"
branch_labels = depends_on = None


def upgrade():
    connection = op.get_bind()
    settings = Settings()
    crypto = DirectoryCrypto(settings)  # Required even for an empty new schema.
    args = context.get_x_argument(as_dictionary=True)
    with Session(bind=connection) as db:
        staging._lock(db, "ACCESS EXCLUSIVE")
        tables = staging._tables(db)
        populated = any(db.scalar(sa.select(sa.func.count()).select_from(t)) for t in tables.values())
        if populated:
            stage = staging._frozen_operator(db, crypto)
            if args.get("directory_retirement_approved") != "yes" or args.get("directory_recovery_verified") != "yes":
                raise RuntimeError("Separate approved directory retirement and verified recovery are required.")
            if settings.app_env == "production" and args.get("directory_production_approved") != "yes":
                raise RuntimeError("Separate production directory retirement approval is required.")
            backup, change = uuid.UUID(args.get("directory_backup_ref", "")), uuid.UUID(args.get("directory_change_ref", ""))
            if backup != stage["backup_ref"] or change != stage["change_ref"]:
                raise RuntimeError("Approved directory recovery references changed.")
            _, content = staging._inventory(db, crypto, tables, complete=True, digest=True)
            if not hmac.compare_digest(content, stage["source_digest"] or ""):
                raise RuntimeError("Directory verification failed; no plaintext is retired.")
        else:
            stage = staging._stage(db)
        # The same transaction still holds exclusion through all DDL.
        op.drop_constraint("ck_directory_crypto_phase", "directory_crypto_stage")
        op.create_check_constraint("ck_directory_crypto_phase", "directory_crypto_stage",
                                   "phase IN ('additive','frozen','encrypted')")
        op.add_column("directory_crypto_stage", sa.Column("index_key_check", sa.String(64)))
        db.execute(sa.text("""
          CREATE OR REPLACE FUNCTION evexia_mr_directory_identity() RETURNS trigger AS $$
          BEGIN
            IF EXISTS (SELECT 1 FROM mr_directory d JOIN mr_profiles p ON p.id=d.id
              JOIN users u ON u.id=p.user_id WHERE
                ((TG_TABLE_NAME='users' AND p.user_id=NEW.id)
                  OR (TG_TABLE_NAME<>'users' AND d.id=NEW.id))
                AND (u.system_role IS DISTINCT FROM 'mr' OR u.is_protected_system_admin OR u.username IS NULL
                  OR u.is_active<>(d.status='active' AND d.deleted_at IS NULL)
                  OR p.is_active<>u.is_active)) THEN
              RAISE EXCEPTION 'invalid MR directory identity' USING ERRCODE='23514';
            END IF;
            RETURN NULL;
          END; $$ LANGUAGE plpgsql
        """))
        for table, constraints in {
            "doctor_directory": ("ck_doctor_required_contact", "ck_doctor_invoice", "ck_doctor_dial"),
            "mr_directory": ("ck_mr_directory_required_contact",),
            "patient_directory": ("ck_patient_gender", "ck_patient_dial"),
        }.items():
            for constraint in constraints:
                op.drop_constraint(constraint, table)
        op.create_check_constraint("ck_doctor_invoice", "doctor_directory", "\"invoiceType\" IN ('normal','gst')")
        op.drop_index("uq_patient_duplicate", "patient_directory")
        op.drop_index("ix_doctor_directory_state", "doctor_directory")
        for table, fields in FIELDS.items():
            for field in fields:
                if (table, field) not in NULLABLE_FIELDS:
                    op.alter_column(table, field + "_ciphertext", nullable=False)
            for column in INDEX_COLUMNS[table]:
                op.alter_column(table, column, nullable=False)
                if column == "duplicate_identity_index":
                    op.create_unique_constraint("uq_patient_duplicate_cipher", table, [column])
                else:
                    op.create_index(f"ix_{table}_{column}", table, [column])
            for field in fields:
                op.drop_column(table, field)
        db.execute(sa.text("UPDATE directory_crypto_stage SET phase='encrypted',index_key_check=:value, configuration_digest=:configuration WHERE id=1"),
                   {"value": crypto._index("configuration", ["index-key-check"]),
                    "configuration": staging._configuration_digest(crypto)})
        if stage["runtime_role"]:
            role = connection.dialect.identifier_preparer.quote(stage["runtime_role"])
            db.execute(sa.text(f"GRANT SELECT ON directory_crypto_stage TO {role}"))
        # No commit/rollback: Alembic owns the coordinated atomic transaction.


def downgrade():
    connection = op.get_bind()
    with Session(bind=connection) as db:
        db.execute(sa.text("LOCK TABLE directory_crypto_stage, mr_directory, doctor_directory, patient_directory, patients IN ACCESS EXCLUSIVE MODE NOWAIT"))
        stage = staging._stage(db)
        if stage["maintenance_role"] or any(db.scalar(sa.text(f"SELECT count(*) FROM {table}")) for table in FIELDS):
            raise RuntimeError("Populated directory retirement cannot be downgraded. Approved coordinated backup/key recovery is required.")
        # A never-populated schema has no retired personal data to reconstruct.
        sizes = dict(name=200, phone=20, alternatePhone=20, email=320, dialCountry=2,
                     qualification=200, clinicName=200, gstNumber=20, drugLicenceNumber=100,
                     addressLine1=300, addressLine2=300, landmark=200, pincode=12,
                     city=100, state=100, country=100, gender=17, instructionsLanguage=100)
        for table, fields in FIELDS.items():
            for field in fields:
                kind = sa.Date() if field.startswith("dateOf") else sa.String(6 if table == "mr_directory" and field == "pincode" else sizes[field])
                op.add_column(table, sa.Column(field, kind, nullable=(table, field) in NULLABLE_FIELDS))
                op.alter_column(table, field + "_ciphertext", nullable=True)
            for column in INDEX_COLUMNS[table]:
                if column == "duplicate_identity_index":
                    op.drop_constraint("uq_patient_duplicate_cipher", table)
                else:
                    op.drop_index(f"ix_{table}_{column}", table)
                op.alter_column(table, column, nullable=True)
        op.create_index("ix_doctor_directory_state", "doctor_directory", ["state"])
        op.execute('CREATE UNIQUE INDEX uq_patient_duplicate ON patient_directory (lower(btrim(name)), "dialCountry", phone, "dateOfBirth")')
        for table, name in (("doctor_directory", "ck_doctor_required_contact"), ("mr_directory", "ck_mr_directory_required_contact")):
            op.create_check_constraint(name, table, '"contactRequirement" = \'optional\' OR (phone <> \'\' AND email <> \'\')')
        op.drop_constraint("ck_doctor_invoice", "doctor_directory")
        op.create_check_constraint("ck_doctor_invoice", "doctor_directory", '"invoiceType" IN (\'normal\',\'gst\') AND ("invoiceType" <> \'gst\' OR "gstNumber" <> \'\')')
        for table, name in (("doctor_directory", "ck_doctor_dial"), ("patient_directory", "ck_patient_dial")):
            op.create_check_constraint(name, table, '"dialCountry" IN (\'IN\',\'US\',\'GB\',\'AE\')')
        op.create_check_constraint("ck_patient_gender", "patient_directory", "gender IN ('male','female','other','prefer not to say')")
        db.execute(sa.text("UPDATE directory_crypto_stage SET phase='additive' WHERE id=1"))
        op.drop_column("directory_crypto_stage", "index_key_check")
        op.drop_constraint("ck_directory_crypto_phase", "directory_crypto_stage")
        op.create_check_constraint("ck_directory_crypto_phase", "directory_crypto_stage", "phase IN ('additive','frozen')")
        # Restore the historical email invariant only after restoring plaintext.
        op.execute("""
        CREATE OR REPLACE FUNCTION evexia_mr_directory_identity() RETURNS trigger AS $$
        BEGIN
          IF EXISTS (SELECT 1 FROM mr_directory d JOIN mr_profiles p ON p.id = d.id
            JOIN users u ON u.id = p.user_id WHERE
              ((TG_TABLE_NAME = 'users' AND p.user_id = NEW.id)
                OR (TG_TABLE_NAME <> 'users' AND d.id = NEW.id))
              AND (u.system_role IS DISTINCT FROM 'mr' OR u.is_protected_system_admin OR u.username IS NULL
              OR coalesce(u.email, '') <> d.email
              OR u.is_active <> (d.status = 'active' AND d.deleted_at IS NULL)
              OR p.is_active <> u.is_active)) THEN
            RAISE EXCEPTION 'invalid MR directory identity' USING ERRCODE = '23514';
          END IF;
          RETURN NULL;
        END; $$ LANGUAGE plpgsql;
        """)
