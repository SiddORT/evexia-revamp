"""Independent durable master numbers; no deletion or account rewriting."""
import re
from alembic import op
import sqlalchemy as sa

revision = "0058_master_numbers"
down_revision = "0057_staff_employee_code"
branch_labels = depends_on = None


def upgrade():
    db = op.get_bind()
    # Exclude writers while collecting occupied IDs, including tombstones and
    # encrypted immutable login reservations. Never reset an existing sequence.
    db.execute(sa.text("LOCK TABLE users, account_identifier_reservations, "
                       "patient_directory, doctor_directory, mr_directory IN ACCESS EXCLUSIVE MODE"))
    db.execute(sa.text("CREATE SEQUENCE patient_number_seq AS bigint"))
    db.execute(sa.text("CREATE SEQUENCE doctor_number_seq AS bigint"))
    db.execute(sa.text("CREATE SEQUENCE mr_login_number_seq AS bigint"))
    maximum = db.scalar(sa.text(
        "SELECT max(substring(code from 5)::numeric) FROM patient_directory WHERE code ~ '^PAT-[0-9]+$'"
    )) or 0
    if maximum > 9223372036854775806:
        raise RuntimeError("Patient numeric identity range exhausted; operator review required.")
    if maximum:
        db.execute(sa.text("SELECT setval('patient_number_seq', :maximum, true)"), {"maximum": int(maximum)})

    # Use the established authenticated decryption primitive, not plaintext SQL
    # or a new ciphertext format. No values are emitted to logs or persisted.
    from app.services.account_crypto import read
    maximum = 0
    for row in db.execute(sa.text(
        "SELECT user_id,field,identifier,identifier_index FROM account_identifier_reservations"
    )).mappings():
        value = read(row["user_id"], row["field"], row["identifier"], row["identifier_index"])
        if re.fullmatch(r"MR-[0-9]+", value, re.IGNORECASE):
            maximum = max(maximum, int(value[3:]))
    if maximum > 9223372036854775806:
        raise RuntimeError("MR numeric identity range exhausted; operator review required.")
    if maximum:
        db.execute(sa.text("SELECT setval('mr_login_number_seq', :maximum, true)"), {"maximum": maximum})

    op.add_column("doctor_directory", sa.Column("doctorNumber", sa.String(64), nullable=True))
    # Stable, deterministic historical backfill; medical registrations untouched.
    for row in db.execute(sa.text("SELECT id FROM doctor_directory ORDER BY created_at,id")):
        value = db.scalar(sa.text("SELECT nextval('doctor_number_seq')"))
        db.execute(sa.text('UPDATE doctor_directory SET "doctorNumber"=:number WHERE id=:id'),
                   {"number": f"DR-{value:03d}", "id": row.id})
    op.alter_column("doctor_directory", "doctorNumber", nullable=False)
    op.create_unique_constraint("uq_doctor_number", "doctor_directory", ["doctorNumber"])
    op.create_check_constraint("ck_doctor_number", "doctor_directory", '"doctorNumber" ~ \'^DR-[0-9]{3,}$\'')


def downgrade():
    raise RuntimeError("Number reservations must never be reset; restore through coordinated recovery.")
