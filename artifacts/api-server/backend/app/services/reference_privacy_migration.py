"""Forward-only privacy conversion. No startup calls or approval defaults."""
import time
import sqlalchemy as sa
from sqlalchemy.orm import Session
from app.schemas.vendors import BUSINESS_FIELDS, VendorFields
from app.services import directory_runtime
from app.services.account_migration import require_evidence
from app.services.directory_inventory import VENDOR_FIELDS, DirectoryCryptoError

PREVIOUS = "0035_account_identifiers"
REVISION = "0036_reference_privacy"
VENDOR_LENGTHS = {"registeredAddress": 2000, "contactPersonName": 200,
                 "emailId": 320, "phoneNo": 15, "dialCountry": 2}


def prepare(connection, args):
    connection.execute(sa.text("SET LOCAL lock_timeout='1s'"))
    connection.execute(sa.text(
        "LOCK TABLE vendors, allergen_products, mr_directory, product_categories, "
        "storage_locations, zones, headquarters, directory_crypto_stage IN ACCESS EXCLUSIVE MODE NOWAIT"))
    if list(connection.scalars(sa.text("SELECT version_num FROM alembic_version"))) != [PREVIOUS]:
        raise DirectoryCryptoError()
    inspector = sa.inspect(connection)
    columns = {column["name"]: column for column in inspector.get_columns("vendors")}
    for field, length in VENDOR_LENGTHS.items():
        column = columns.get(field)
        if (column is None or not isinstance(column["type"], sa.String)
                or column["type"].length != length or column["nullable"] or column["default"] is not None):
            raise DirectoryCryptoError()
    approved_checks = ["ck_vendor_" + field + "_length" for field in VENDOR_FIELDS] + [
        "ck_vendor_country", "ck_vendor_phone"]
    # DROP COLUMN can silently remove dependent indexes/checks. Reject unknown
    # dependencies rather than treating an operator approval as blanket consent.
    if connection.scalar(sa.text("""
        SELECT EXISTS(
          SELECT 1 FROM pg_depend d JOIN pg_attribute a
            ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
          WHERE d.refclassid='pg_class'::regclass AND a.attrelid=to_regclass('vendors')
            AND a.attname=ANY(:fields) AND NOT (
              d.classid='pg_constraint'::regclass AND EXISTS(
                SELECT 1 FROM pg_constraint c WHERE c.oid=d.objid
                  AND c.conrelid=a.attrelid AND c.contype='c' AND c.conname=ANY(:approved))))
    """), {"fields": list(VENDOR_FIELDS), "approved": approved_checks}):
        raise DirectoryCryptoError()
    if connection.scalar(sa.text("""
        SELECT EXISTS(SELECT 1 FROM pg_trigger
          WHERE tgrelid=to_regclass('vendors') AND NOT tgisinternal)
    """)):
        raise DirectoryCryptoError()
    populated = any(connection.scalar(sa.text(f"SELECT EXISTS(SELECT 1 FROM {table})"))
                    for table in ("vendors", "allergen_products", "mr_directory"))
    # Reuse the strict target-bound file/integrity verifier, not an older
    # migration's approval. Every attestation has this migration's own scope.
    scoped = {"account_" + suffix: args.get("reference_privacy_" + suffix)
              for suffix in ("writers_stopped", "backup_durable", "restoration_rehearsal",
                             "external_consumers_reviewed", "expected_database",
                             "expected_system_identifier", "backup", "backup_sha256")}
    scoped["account_crypto_approved"] = args.get("reference_privacy_approved")
    with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
        require_evidence(db, scoped, populated)
        crypto = directory_runtime.ready(db)
        db.commit()
    return crypto


def backfill(connection, crypto):
    started = time.monotonic()
    connection.execute(sa.text("""
        UPDATE allergen_products a SET category_name=c.name, storage_location_name=s.name
        FROM product_categories c, storage_locations s
        WHERE a.category_id=c.id AND a.storage_location_id=s.id
    """))
    connection.execute(sa.text("""
        UPDATE mr_directory m SET hq_name=h.name, zone_name=z.name
        FROM headquarters h, zones z WHERE m.hq=h.id AND m."zoneId"=z.id
    """))
    for table, fields in (("allergen_products", ("category_name", "storage_location_name")),
                          ("mr_directory", ("hq_name", "zone_name"))):
        if connection.scalar(sa.text(f"SELECT EXISTS(SELECT 1 FROM {table} WHERE " +
                                     " OR ".join(f"{field} IS NULL" for field in fields) + ")")):
            raise DirectoryCryptoError()
    metadata = sa.MetaData()
    vendors = sa.Table("vendors", metadata, autoload_with=connection, resolve_fks=False)
    mrs = sa.Table("mr_directory", metadata, autoload_with=connection, resolve_fks=False)
    # Keyset batches avoid unbounded result buffers and include tombstones.
    for table in (vendors, mrs):
        cursor = None
        while True:
            query = sa.select(table).order_by(table.c.id).limit(500)
            if cursor is not None:
                query = query.where(table.c.id > cursor)
            rows = connection.execute(query).mappings().all()
            if not rows:
                break
            for row in rows:
                if time.monotonic() - started > 120:
                    raise DirectoryCryptoError()
                if table.name == "vendors":
                    original = {field: row[field] for field in BUSINESS_FIELDS}
                    try:
                        if VendorFields(**original).model_dump() != original:
                            raise ValueError()
                    except ValueError:
                        raise DirectoryCryptoError() from None
                    values = {field: row[field] for field in VENDOR_FIELDS}
                else:
                    manager_id = row["reportingManagerId"]
                    manager = connection.execute(sa.select(mrs.c.name_ciphertext)
                        .where(mrs.c.id == manager_id)).first() if manager_id else None
                    if manager_id and manager is None:
                        raise DirectoryCryptoError()
                    values = {"reporting_manager_name": crypto.decrypt(
                        "mr_directory", manager_id, "name", manager[0]) if manager else None}
                encrypted = {field + "_ciphertext": crypto.encrypt(table.name, row["id"], field, value)
                             for field, value in values.items()}
                connection.execute(table.update().where(table.c.id == row["id"]).values(**encrypted))
                stored = connection.execute(sa.select(table).where(table.c.id == row["id"])).mappings().one()
                if any(crypto.decrypt(table.name, row["id"], field, stored[field + "_ciphertext"]) != value
                       for field, value in values.items()):
                    raise DirectoryCryptoError()
            cursor = rows[-1]["id"]
