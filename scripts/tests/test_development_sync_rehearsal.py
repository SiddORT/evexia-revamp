"""Rehearse the exact protected 0040 -> 0044 sequence on synthetic predecessor tables.

This is NOT an original-database restoration or permission to execute it there.
"""
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine
from sqlalchemy.exc import DBAPIError

ROOT = Path(__file__).resolve().parents[2]
VERSIONS = ROOT / "artifacts/api-server/backend/alembic/versions"
PATH = ["0041_location_geography", "0042_rate_hundredths",
        "0043_email_templates", "0044_purchase_received"]


class ProtectedRehearsalTests(unittest.TestCase):
    def test_exact_protected_path_and_data_effects(self):
        with tempfile.TemporaryDirectory(prefix="protected-path-rehearsal-") as tmp:
            data = Path(tmp) / "pg"
            subprocess.run(["initdb", "-D", str(data), "-U", "fixture", "-A", "trust",
                            "--no-locale", "--encoding=UTF8"], check=True, capture_output=True)
            subprocess.run(["pg_ctl", "-D", str(data), "-l", str(Path(tmp) / "pg.log"),
                            "-o", f"-F -k {tmp} -c listen_addresses='' -p 55432", "-w", "start"],
                           check=True, capture_output=True)
            engine = create_engine(f"postgresql+psycopg://fixture@/postgres?host={tmp}&port=55432",
                                   hide_parameters=True)
            try:
                with engine.begin() as conn:
                    # Minimal historical contracts, deliberately not current ORM fields.
                    for name in ("users", "storage_locations", "vendors", "staff_profiles",
                                 "purchase_orders", "purchase_order_lines", "audit_events"):
                        conn.exec_driver_sql(f"CREATE TABLE {name} (id uuid PRIMARY KEY)")
                    conn.exec_driver_sql("""
                        CREATE TABLE product_categories (
                          id uuid PRIMARY KEY, unit_price numeric(18,6) NOT NULL,
                          version integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
                          CONSTRAINT ck_product_category_price CHECK (unit_price >= 0));
                        CREATE TABLE allergen_products (
                          id uuid PRIMARY KEY, selling_price numeric(18,6) NOT NULL,
                          gst numeric(18,6) NOT NULL, version integer NOT NULL,
                          updated_at timestamptz NOT NULL DEFAULT now(),
                          CONSTRAINT ck_allergen_price CHECK (selling_price >= 0),
                          CONSTRAINT ck_allergen_gst CHECK (gst >= 0 AND gst <= 100));
                        CREATE TABLE alembic_version (version_num varchar(64) PRIMARY KEY);
                        INSERT INTO alembic_version VALUES ('0040_po_tax_basis');
                        INSERT INTO product_categories (id,unit_price,version)
                          VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1.235,7);
                        INSERT INTO allergen_products (id,selling_price,gst,version)
                          VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',2.345,5.555,9);
                    """)
                with engine.begin() as conn:
                    conn.exec_driver_sql("SET LOCAL lock_timeout='10s'")
                    conn.exec_driver_sql("SET LOCAL statement_timeout='60s'")
                    conn.exec_driver_sql("SELECT pg_advisory_xact_lock(145002)")
                    backend = VERSIONS.parents[1]
                    config = Config(str(backend / "alembic.ini"))
                    config.set_main_option("script_location", str(backend / "alembic"))
                    config.attributes["connection"] = conn
                    settings = SimpleNamespace(database_url=str(engine.url))
                    with patch("app.core.config.get_settings", return_value=settings):
                        command.upgrade(config, PATH[-1])
                    self.assertEqual(conn.exec_driver_sql(
                        "SELECT unit_price::text,version FROM product_categories").one(), ("1.24", 8))
                    self.assertEqual(conn.exec_driver_sql(
                        "SELECT selling_price::text,gst::text,version FROM allergen_products").one(),
                        ("2.35", "5.56", 10))
                    seed = conn.exec_driver_sql(
                        "SELECT id::text,event_key,version,provenance FROM email_templates").one()
                    self.assertEqual(seed, ("e7e80000-0000-4000-8000-000000000001",
                                            "password_recovery", 1, "migration_seed"))
                    for table in ("purchase_receipts", "purchase_receipt_sources",
                                  "purchase_receipt_history", "purchase_receipt_requests"):
                        self.assertEqual(conn.exec_driver_sql(f"SELECT count(*) FROM {table}").scalar_one(), 0)
                    self.assertEqual(conn.exec_driver_sql(
                        "SELECT to_regclass('purchase_receipt_number_seq')").scalar_one(),
                        "purchase_receipt_number_seq")
                    with self.assertRaises(DBAPIError), conn.begin_nested():
                        conn.exec_driver_sql("DELETE FROM email_templates")
                with engine.connect() as conn:
                    self.assertEqual(conn.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one(),
                                     "0044_purchase_received")
            finally:
                engine.dispose()
                subprocess.run(["pg_ctl", "-D", str(data), "-m", "immediate", "-w", "stop"],
                               check=True, capture_output=True)


if __name__ == "__main__":
    unittest.main()
