"""Verified ciphertext-only account identifiers and historical reservations."""
from alembic import context, op
import sqlalchemy as sa
from app.services.account_migration import prepare

revision = "0035_account_identifiers"
down_revision = "0034_shared_phone_countries"
branch_labels = depends_on = None


def upgrade():
    db = op.get_bind()
    current, users, reservations = prepare(db, context.get_x_argument(as_dictionary=True))
    for field in ("email", "username"):
        op.add_column("users", sa.Column(field + "_encrypted", sa.Text()))
        op.add_column("users", sa.Column(field + "_index", sa.String(64)))
    op.add_column("account_identifier_reservations", sa.Column("identifier_encrypted", sa.Text()))
    op.add_column("account_identifier_reservations", sa.Column("identifier_index", sa.String(64)))
    op.add_column("account_identifier_reservations", sa.Column("field", sa.String(8)))
    for row in users:
        values = {"id": row["id"]}
        for field in ("email", "username"):
            value = row[field]
            ciphertext = current.encrypt(row["id"], field, value)
            if current.decrypt(row["id"], field, ciphertext) != value:
                raise RuntimeError("Account round-trip verification failed.")
            values[field + "_encrypted"] = ciphertext
            values[field + "_index"] = None if value is None else current.lookup_index(value.lower())
        db.execute(sa.text("""
          UPDATE users SET email_encrypted=:email_encrypted, username_encrypted=:username_encrypted,
            email_index=:email_index, username_index=:username_index WHERE id=:id
        """), values)
    for row in reservations:
        ciphertext = current.encrypt(row["user_id"], "email", row["identifier"])
        if current.decrypt(row["user_id"], "email", ciphertext) != row["identifier"]:
            raise RuntimeError("Reservation round-trip verification failed.")
        db.execute(sa.text("""
          UPDATE account_identifier_reservations SET identifier_encrypted=:ciphertext,
            identifier_index=:digest, field='email' WHERE identifier=:original
        """), {"ciphertext": ciphertext, "digest": current.lookup_index(row["identifier"]),
               "original": row["identifier"]})
    # Verify persisted shadows before retiring a single plaintext column.
    for row in db.execute(sa.text("SELECT * FROM users")).mappings():
        for field in ("email", "username"):
            if current.decrypt(row["id"], field, row[field + "_encrypted"]) != row[field]:
                raise RuntimeError("Persisted account verification failed.")
    for row in db.execute(sa.text("SELECT * FROM account_identifier_reservations")).mappings():
        if current.decrypt(row["user_id"], "email", row["identifier_encrypted"]) != row["identifier"]:
            raise RuntimeError("Persisted reservation verification failed.")
    db.execute(sa.text("SET CONSTRAINTS ALL IMMEDIATE"))
    # Replace column-bound triggers under the same exclusive transaction, not
    # CASCADE. They are recreated below before writers can resume.
    op.execute("DROP TRIGGER trg_account_namespace ON users")
    op.execute("DROP TRIGGER trg_account_reserve ON users")
    op.drop_constraint("ck_users_protected_super_admin_identity", "users")
    for name in ("ix_users_email", "ix_users_username", "uq_users_lower_email", "uq_users_lower_username"):
        op.drop_index(name, table_name="users")
    op.drop_constraint("account_identifier_reservations_pkey", "account_identifier_reservations")
    for field in ("email", "username"):
        op.drop_column("users", field)
        op.alter_column("users", field + "_encrypted", new_column_name=field)
        op.create_unique_constraint("uq_users_" + field + "_index", "users", [field + "_index"])
        op.create_check_constraint("ck_users_" + field + "_encrypted", "users",
            f"({field} IS NULL) = ({field}_index IS NULL) AND "
            f"({field} IS NULL OR {field} LIKE 'v1:%') AND "
            f"({field}_index IS NULL OR {field}_index ~ '^[0-9a-f]{{64}}$')")
    op.drop_column("account_identifier_reservations", "identifier")
    op.alter_column("account_identifier_reservations", "identifier_encrypted",
                    new_column_name="identifier", nullable=False)
    op.alter_column("account_identifier_reservations", "identifier_index", nullable=False)
    op.alter_column("account_identifier_reservations", "field", nullable=False)
    op.create_primary_key("account_identifier_reservations_pkey", "account_identifier_reservations", ["identifier_index"])
    op.create_check_constraint("ck_account_reservation_field", "account_identifier_reservations",
                              "field IN ('email','username')")
    op.create_check_constraint("ck_account_reservation_encrypted", "account_identifier_reservations",
                              "identifier LIKE 'v1:%' AND identifier_index ~ '^[0-9a-f]{64}$'")
    op.create_table("account_crypto_state",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("configuration_digest", sa.String(64), nullable=False),
        sa.Column("protected_email_index", sa.String(64), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_account_crypto_singleton"))
    db.execute(sa.text("INSERT INTO account_crypto_state VALUES (1,:configuration,:protected)"), {
        "configuration": current.configuration(),
        "protected": current.lookup_index("crm-admin@allergyevexia.in")})
    op.create_check_constraint("ck_users_protected_super_admin_identity", "users",
                              "NOT is_protected_system_admin OR (email_index IS NOT NULL AND is_active)")
    op.execute("""
      CREATE OR REPLACE FUNCTION evexia_account_namespace() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(73182451);
        IF (NEW.email_index IS NOT NULL AND NEW.email_index = NEW.username_index)
          OR EXISTS (SELECT 1 FROM account_identifier_reservations r WHERE r.user_id <> NEW.id
                     AND r.identifier_index IN (NEW.email_index, NEW.username_index)) THEN
          RAISE EXCEPTION 'account identifier reserved' USING ERRCODE='23505',
            CONSTRAINT='uq_users_login_namespace';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      CREATE OR REPLACE FUNCTION evexia_account_reserve() RETURNS trigger AS $$
      BEGIN
        INSERT INTO account_identifier_reservations(identifier_index,identifier,user_id,field)
          SELECT NEW.email_index,NEW.email,NEW.id,'email' WHERE NEW.email_index IS NOT NULL
          UNION ALL SELECT NEW.username_index,NEW.username,NEW.id,'username' WHERE NEW.username_index IS NOT NULL
          ON CONFLICT(identifier_index) DO NOTHING;
        RETURN NULL;
      END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER trg_account_namespace BEFORE INSERT OR UPDATE OF email,username,email_index,username_index ON users
        FOR EACH ROW EXECUTE FUNCTION evexia_account_namespace();
      CREATE TRIGGER trg_account_reserve AFTER INSERT OR UPDATE OF email,username,email_index,username_index ON users
        FOR EACH ROW EXECUTE FUNCTION evexia_account_reserve();
      CREATE OR REPLACE FUNCTION evexia_protect_super_admin() RETURNS trigger AS $$
      BEGIN
        IF TG_OP='DELETE' THEN
          IF OLD.is_protected_system_admin THEN
            RAISE EXCEPTION 'protected Super Admin cannot be deleted' USING ERRCODE='23514';
          END IF;
          RETURN OLD;
        END IF;
        IF NEW.is_protected_system_admin AND (NEW.email_index IS DISTINCT FROM
            (SELECT protected_email_index FROM account_crypto_state WHERE id=1)) THEN
          RAISE EXCEPTION 'invalid protected identity' USING ERRCODE='23514';
        END IF;
        IF TG_OP='INSERT' THEN
          IF NEW.is_protected_system_admin AND
             current_setting('evexia.bootstrap_super_admin',true) IS DISTINCT FROM 'on' THEN
            RAISE EXCEPTION 'protected bootstrap required' USING ERRCODE='23514';
          END IF;
          RETURN NEW;
        END IF;
        IF OLD.is_protected_system_admin AND (
          NEW.id IS DISTINCT FROM OLD.id OR NEW.email IS DISTINCT FROM OLD.email
          OR NEW.username IS DISTINCT FROM OLD.username OR NEW.email_index IS DISTINCT FROM OLD.email_index
          OR NEW.username_index IS DISTINCT FROM OLD.username_index OR NEW.system_role IS DISTINCT FROM OLD.system_role
          OR NEW.is_protected_system_admin IS DISTINCT FROM OLD.is_protected_system_admin
          OR NEW.is_active IS DISTINCT FROM OLD.is_active OR NEW.identity_version IS DISTINCT FROM OLD.identity_version) THEN
          RAISE EXCEPTION 'protected identity immutable' USING ERRCODE='23514';
        END IF;
        IF NEW.is_protected_system_admin AND NOT OLD.is_protected_system_admin THEN
          RAISE EXCEPTION 'protected promotion forbidden' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
    """)


def downgrade():
    raise RuntimeError("Ciphertext account downgrade is refused. Use an approved forward fix or a verified full backup restore.")
