"""One-off offline workbook generation and validation; no app/database imports.

Run from the workspace root: python scripts/schema_dictionary/generate.py
Only committed model/migration files may be used for this merged-code snapshot.
Alembic upgrade functions are NOT run: selected declarative DDL expressions are
recorded in memory. Connection/data operations and raw SQL are never executed.
"""
import ast
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone
from zipfile import ZipFile

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic.runtime.migration import MigrationContext
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

from purposes import TABLES, LOGICAL, column_purpose

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "artifacts/api-server/backend"
OUTPUT = ROOT / "generated-artifacts/schema/EVEXIA_Database_Data_Dictionary.xlsx"
DIALECT = postgresql.dialect()
sys.path.insert(0, str(BACKEND))
from app.db import models  # noqa: E402,F401 — metadata registration only
from app.db.base import Base  # noqa: E402


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args], text=True).strip()


def compiled(value):
    return str(value.compile(dialect=DIALECT))


def default_text(value):
    if value is None:
        return "None declared"
    if isinstance(value, sa.Computed):
        return "GENERATED ALWAYS AS (" + str(value.sqltext) + ") STORED"
    arg = value.arg
    if callable(arg):
        name = getattr(arg, "__name__", type(arg).__name__)
        return {"uuid4": "uuid.uuid4() (application-generated)",
                "<lambda>": "secrets.token_urlsafe(32) (application-generated)",
                "list": "Empty list (application-generated)"}.get(name, name + "() (application-generated)")
    if hasattr(arg, "compile"):
        return compiled(arg)
    return repr(arg)


class DDLRecorder:
    """No engine, connection or database is constructed."""

    def __init__(self):
        self.metadata = sa.MetaData()
        self.raw_sql = []
        self.revision = ""
        self.origins = {}
        self.indexes = {}
        self.allowed = {
            "create_table", "add_column", "alter_column", "create_foreign_key",
            "create_check_constraint", "create_unique_constraint", "create_index",
            "drop_constraint", "drop_column", "drop_index", "drop_table", "execute",
        }

    def create_table(self, name, *elements, **kwargs):
        table = sa.Table(name, self.metadata, *elements, **kwargs)
        self.origins[name] = self.revision
        return table

    def add_column(self, table, column):
        self.metadata.tables[table].append_column(column)

    def drop_column(self, table, column):
        # Retired constraints must have been explicitly dropped by the migration.
        target = self.metadata.tables[table]
        target._columns.remove(target.c[column])

    def drop_table(self, table):
        self.metadata.remove(self.metadata.tables[table])
        self.indexes.pop(table, None)
        self.origins.pop(table, None)

    def drop_index(self, name, table_name=None):
        tables = [table_name] if table_name else list(self.indexes)
        for table in tables:
            self.indexes[table] = [i for i in self.indexes.get(table, [])
                                   if not i.startswith(name + ":") and not i.startswith("UNIQUE " + name + ":")]

    def create_unique_constraint(self, name, table, columns):
        self.metadata.tables[table].append_constraint(sa.UniqueConstraint(*columns, name=name))

    def alter_column(self, table, column, **kwargs):
        col = self.metadata.tables[table].c[column]
        supported = {"existing_type", "type_", "nullable", "server_default"}
        if set(kwargs) - supported:
            raise ValueError(f"Unreviewed alter-column arguments: {kwargs}")
        if "nullable" in kwargs:
            col.nullable = kwargs["nullable"]
        if "type_" in kwargs:
            col.type = kwargs["type_"]
        if "server_default" in kwargs:
            value = kwargs["server_default"]
            col.server_default = None if value is None else sa.DefaultClause(value)

    def create_foreign_key(self, name, source, target, local, remote, **kwargs):
        self.metadata.tables[source].append_constraint(sa.ForeignKeyConstraint(
            local, [f"{target}.{c}" for c in remote], name=name, **kwargs))

    def create_check_constraint(self, name, table, condition):
        self.metadata.tables[table].append_constraint(sa.CheckConstraint(condition, name=name))

    def create_index(self, name, table, columns, **kwargs):
        parts = [c if isinstance(c, str) else compiled(c) for c in columns]
        note = ("UNIQUE " if kwargs.get("unique") else "") + name + ": (" + ", ".join(parts) + ")"
        predicate = kwargs.get("postgresql_where")
        if predicate is not None:
            note += " WHERE " + compiled(predicate)
        if kwargs.get("postgresql_using"):
            note += " USING " + kwargs["postgresql_using"]
        self.indexes.setdefault(table, []).append(note)

    def drop_constraint(self, name, table, **kwargs):
        target = self.metadata.tables[table]
        found = [c for c in target.constraints if c.name == name]
        if not found and kwargs.get("type_") == "foreignkey":
            # PostgreSQL assigned the original unnamed single-column FK its
            # baseline name. Recognize that one reviewed removal, not arbitrary
            # guessed constraints throughout the dictionary.
            if (table, name) == ("refresh_sessions", "refresh_sessions_organization_id_fkey"):
                found = [c for c in target.foreign_key_constraints
                         if c.name is None and list(c.column_keys) == ["organization_id"]]
        if len(found) != 1:
            raise ValueError(f"Constraint not found: {table}.{name}")
        target.constraints.remove(found[0])
        if isinstance(found[0], sa.ForeignKeyConstraint):
            for element in found[0].elements:
                target.foreign_keys.discard(element)
                element.parent.foreign_keys.discard(element)

    def execute(self, statement):
        sql = str(statement)
        # Raw migration SQL here defines triggers/functions/indexes, not columns.
        # New raw table/column DDL needs explicit review rather than silent omission.
        if re.search(r"\b(?:CREATE|ALTER|DROP)\s+TABLE\b", sql, re.I):
            raise ValueError("Unreviewed raw table DDL")
        self.raw_sql.append((self.revision, sql))


def migration_metadata():
    recorder = DDLRecorder()
    revisions = {}
    for path in sorted((BACKEND / "alembic/versions").glob("*.py")):
        spec = importlib.util.spec_from_file_location("dictionary_" + path.stem, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        revisions[module.revision] = (module, path)
    remaining = set(revisions)
    applied = set()
    ordered = []
    while remaining:
        ready = sorted(r for r in remaining if revisions[r][0].down_revision is None
                       or revisions[r][0].down_revision in applied)
        if not ready:
            raise ValueError("Migration chain is missing a parent or contains an unreviewed branch")
        for revision in ready:
            module, path = revisions[revision]
            tree = ast.parse(path.read_text())
            upgrade = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "upgrade")
            module.op = recorder
            recorder.revision = revision
            record_structural_ddl(upgrade.body, module.__dict__, path, recorder)
            ordered.append(revision)
            applied.add(revision)
            remaining.remove(revision)
    heads = sorted(applied - {m.down_revision for m, _ in revisions.values()})
    return recorder, ordered, heads


def record_structural_ddl(nodes, namespace, path, recorder):
    """Record static op DDL only, including reviewed nested crypto-field loops.

    Never evaluate connection/session setup, data assignments or service calls.
    A DDL-bearing dynamic condition/loop fails explicitly rather than guessing.
    """
    def has_ddl(node):
        return any(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                   and isinstance(n.func.value, ast.Name) and n.func.value.id == "op"
                   and n.func.attr != "get_bind" for n in ast.walk(node))

    for node in nodes:
        if isinstance(node, ast.Assign):
            calls = [n for n in ast.walk(node.value) if isinstance(n, ast.Call)]
            # Only literal assignments and the historical permission catalogue's
            # string join are needed by structural DDL. Never run service calls.
            if not calls or all(isinstance(c.func, ast.Attribute) and c.func.attr == "join"
                                and isinstance(c.func.value, ast.Constant)
                                and isinstance(c.func.value.value, str) for c in calls):
                exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), "exec"), namespace)
            continue
        if not has_ddl(node):
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            call = node.value
            if (isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Name)
                    and call.func.value.id == "op" and call.func.attr in recorder.allowed):
                exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), "exec"), namespace)
                continue
        if isinstance(node, ast.With):
            record_structural_ddl(node.body, namespace, path, recorder)
            continue
        if isinstance(node, ast.For):
            iterable = eval(compile(ast.Expression(node.iter), str(path), "eval"), namespace)
            for value in iterable:
                assignment = ast.Assign(targets=[node.target], value=ast.Name(id="_dictionary_value", ctx=ast.Load()))
                namespace["_dictionary_value"] = value
                exec(compile(ast.fix_missing_locations(ast.Module(body=[assignment], type_ignores=[])),
                             str(path), "exec"), namespace)
                record_structural_ddl(node.body, namespace, path, recorder)
            continue
        if isinstance(node, ast.If):
            condition = eval(compile(ast.Expression(node.test), str(path), "eval"), namespace)
            record_structural_ddl(node.body if condition else node.orelse, namespace, path, recorder)
            continue
        raise ValueError(f"Unreviewed structural DDL in {path.name}: {ast.unparse(node)[:100]}")


def fk_signature(fk):
    return (fk.table.name, tuple(e.parent.name for e in fk.elements),
            tuple(e.target_fullname for e in fk.elements), fk.ondelete, fk.onupdate)


def reconcile(metadata):
    assert set(metadata.tables) == set(Base.metadata.tables) | {"directory_crypto_stage"}, "Migration/model table mismatch"
    for name, model in Base.metadata.tables.items():
        migrated = metadata.tables[name]
        assert set(model.c.keys()) == set(migrated.c.keys()), f"{name}: column mismatch"
        for c in model.c:
            other = migrated.c[c.name]
            assert (compiled(c.type), c.primary_key) == (
                compiled(other.type), other.primary_key), f"{name}.{c.name}: type/key mismatch"
            if c.nullable != other.nullable:
                # The generated column migration omits NOT NULL; mapped str infers
                # NOT NULL in the ORM. Preserve both, never change the schema here.
                assert (name, c.name, c.nullable, other.nullable) == (
                    "custom_roles", "normalized_name", False, True), f"{name}.{c.name}: unreviewed nullable mismatch"
        assert {fk_signature(fk) for fk in model.foreign_key_constraints} == {
            fk_signature(fk) for fk in migrated.foreign_key_constraints}, f"{name}: foreign-key mismatch"


def build_rows(recorder, ordered, heads, commit, source_hash, snapshot):
    metadata = recorder.metadata
    application_columns = sum(len(t.c) for t in Base.metadata.tables.values())
    constraint_count = sum(len(t.foreign_key_constraints) for t in metadata.tables.values())
    # The Alembic infrastructure table is derived without loading env.py.
    infrastructure = MigrationContext.configure(dialect_name="postgresql")._version
    readme = [
        ("Document", "EVEXIA Database Data Dictionary — merged-code snapshot, not a live database export."),
        ("Snapshot date (UTC)", snapshot),
        ("Merged source commit", commit),
        ("Schema source SHA-256", source_hash),
        ("Coverage", f"{len(Base.metadata.tables)} application tables; {application_columns} application columns; {constraint_count} foreign-key constraints. alembic_version and directory_crypto_stage are infrastructure and excluded from these counts."),
        ("Sources", "Committed SQLAlchemy Base.metadata via app.db.models and all registered extension models; committed Alembic revisions in dependency order; backend README.md, STORAGE_CONTRACT.md and relevant domain documentation/services."),
        ("Migration head(s)", ", ".join(heads)),
        ("Migration chain", " → ".join(ordered)),
        ("No deployed-schema claim", "Schema definitions do not prove migrations were applied to the deployed database. No development or production database was connected to, queried or migrated. No records were read."),
        ("Offline reconciliation", "Selected declarative DDL expressions from upgrade bodies were recorded in memory, not applied. Connection/data operations were skipped and raw SQL was retained as text only. Identifiers, PostgreSQL types, primary keys and foreign-key signatures match the models; the one known nullability difference is disclosed below."),
        ("Defaults", "Columns separates application/ORM defaults from final migration-defined database defaults. None declared is not an implicit application/service value. Temporary backfill defaults removed by later ALTERs are not current defaults."),
        ("Generated/update values", "normalized_name is a stored generated expression. updated_at uses a database insertion default plus SQLAlchemy onupdate; direct SQL writes do not automatically update it from this mixin."),
        ("Data type", "PostgreSQL dialect rendering, preserving VARCHAR lengths, NUMERIC precision/scale, timezone-aware timestamps and arrays. UUID is an identifier, not a row value shown here."),
        ("Nullable", "Nullable reports final migration-defined SQL nullability. ORM nullable is included separately. Yes means SQL NULL is allowed; No means NOT NULL. Empty strings and service-required fields are separate concepts."),
        ("Primary key", "Uniquely identifies a row. A primary key can also be a foreign key, as in MR/patient directory extensions."),
        ("Foreign key", "An actual constraint linking source and target columns. A composite constraint enforces its ordered column tuple together, not independent column references. Names omitted in migrations are labeled unnamed rather than guessing PostgreSQL-generated names."),
        ("Relationships", "One row per foreign-key column pair, with shared relationship ID/name and ordered position for composite constraints. Logical and derived associations are labeled Not enforced and are not included in foreign-key counts."),
        ("Retired organization schema", "The current head removes the legacy organization and membership tables and both scope columns. Immutable historical migrations, restricted external recovery and credential-bound rejection evidence preserve history without a replacement tenant system."),
        ("Core identities versus directory extensions", "users stores credentials. mr_profiles and patients support ownership/authorization. mr_directory and patient_directory are optional one-to-one business extensions with shared PK/FK IDs; identity-only rows need not have directory details. doctor_directory is a business directory, not a login account."),
        ("Staff roles and permissions", "Staff contacts are ciphertext with a keyed blind email index. Business roles/designations grant no privileges by label. Workspace sign-in is explicit opt-in, and custom_roles stores allowlisted action keys for eight masters; system identity is distinct."),
        ("Files and downloads", "files contains metadata and logical object keys, not binary contents, physical paths or public links. download_grants contains digests. download_logs records initiation/issuance metadata, not proof of delivery."),
        ("Catalogue versus financial/stock ledgers", "Product categories/allergens define catalogue prices, tax, storage choices and thresholds, not stock quantities, opening balances, purchase orders, receipts or payment ledgers. Designations are business labels, not payroll. Sales targets are budgets, not achieved sales; annual totals are stored database-generated sums and geography is derived. opening_balances is a separate financial-year starting-position register, not payment processing, settlement or a transaction ledger."),
        ("Opening-balance imports", "opening_balance_import_reviews stores one current, short-lived review per authenticated session, with keyed digest, actor and expiry only. It stores no file bytes; commit consumes the review. Unused expired metadata is retained until replaced, not automatically purged."),
        ("Sales-target precision", "q1–q4 use unscaled NUMERIC with explicit bounds and trunc(amount, 2) checks to reject excess precision instead of letting fixed-scale NUMERIC round it. One non-deleted target per MR/start year is enforced by a partial unique index."),
        ("Infrastructure separately documented", f"alembic_version: Alembic migration tracking table, one column version_num ({compiled(infrastructure.c.version_num.type)}), NOT NULL primary key; no default or foreign key. Excluded from application counts; infrastructure rows are explicitly marked in Tables and Columns."),
        ("Scope exclusions", "No unmerged implementation, browser-local/demo stores, data rows, patient/staff details, credentials, secrets, database URLs or live connection configuration. Browser-reporting module names do not establish corresponding backend tables."),
        ("Constraints beyond foreign keys", "Tables includes migration-declared unique/check constraints. Migration-only trigger/functions and expression-index support also exist (identity protection, account namespace, append-only downloads and activity search); this workbook is a dictionary, not a full executable schema dump."),
        ("Known ORM/migration distinctions", "custom_roles.normalized_name is nullable in its migration, but mapped str infers NOT NULL in the ORM; its generated expression derives from required name. The encryption phase registry is migration-only infrastructure. Some MR validation checks exist only in migrations. Many migration-defined version defaults are absent from ORM server_default while ORM insert defaults are present. This export changes none of these definitions."),
    ]
    tables = []
    columns = []
    relationships = []
    for name in sorted(metadata.tables):
        table = metadata.tables[name]
        model = Base.metadata.tables.get(name, table)
        category = "Infrastructure (excluded)" if name == "directory_crypto_stage" else "Application"
        refs = sorted({e.column.table.name for fk in table.foreign_key_constraints for e in fk.elements})
        checks = sorted(f"{c.name or '(unnamed)'}: {c.sqltext}" for c in table.constraints if isinstance(c, sa.CheckConstraint))
        uniques = sorted(f"{c.name or '(unnamed)'}: ({', '.join(c.columns.keys())})" for c in table.constraints if isinstance(c, sa.UniqueConstraint))
        # Avoid publishing the hard-coded protected identity contact in a schema rule.
        checks = [re.sub(r"'[^']+@[^']+'", "'[reserved protected-admin identity]'", s) for s in checks]
        tables.append([name, category, TABLES[name], len(table.c), ", ".join(refs) or "None",
                       recorder.origins[name], "\n".join(uniques) or "None declared",
                       "\n".join(checks) or "None declared",
                       "\n".join(recorder.indexes.get(name, [])) or "None declared via op.create_index"])
        for col in model.c:
            migrated = table.c[col.name]
            targets = sorted(col.foreign_keys, key=lambda fk: fk.target_fullname)
            columns.append([
                name, category, col.name, compiled(col.type), "Yes" if migrated.nullable else "No",
                "Yes" if col.primary_key else "No", column_purpose(name, col.name),
                default_text(col.default), default_text(migrated.server_default),
                default_text(col.server_default), default_text(col.onupdate),
                "\n".join(fk.column.table.name for fk in targets) or "None",
                "\n".join(fk.column.name for fk in targets) or "None",
                "Yes" if col.nullable else "No",
            ])
        fks = sorted(table.foreign_key_constraints, key=fk_signature)
        for number, fk in enumerate(fks, 1):
            for position, element in enumerate(fk.elements, 1):
                relationships.append([
                    f"{name}.FK{number:02d}", "Foreign-key constraint", "Yes",
                    fk.name or "(unnamed in migration)", name, element.parent.name,
                    element.column.table.name, element.column.name, position, len(fk.elements),
                    fk.ondelete or "NO ACTION (PostgreSQL default)",
                    fk.onupdate or "NO ACTION (PostgreSQL default)",
                    ("Self-reference. " if name == element.column.table.name else "") +
                    ("Composite owner constraint: all column pairs are enforced together." if len(fk.elements) > 1 else
                     "Enforced reference; NULL source is allowed only if Columns marks it nullable."),
                ])
    tables.append(["alembic_version", "Infrastructure (excluded)", "Alembic's applied-revision tracking; infrastructure only.", 1, "None", "Alembic-managed", "None beyond PK", "None declared", "Primary-key index only"])
    columns.append(["alembic_version", "Infrastructure (excluded)", "version_num",
                    compiled(infrastructure.c.version_num.type), "No", "Yes",
                    "Applied Alembic revision identifier; multiple rows can represent multiple migration heads.",
                    *["None declared"] * 4, "None", "None", "No"])
    for number, (source, local, target, remote, kind, note) in enumerate(LOGICAL, 1):
        relationships.append([f"LOGICAL{number:02d}", kind, "No", "Not a constraint", source,
                              local, target, remote, "N/A", "N/A", "N/A", "N/A", note])
    return readme, tables, columns, relationships, constraint_count


def sheet(wb, title, headers, rows, widths):
    ws = wb.create_sheet(title)
    ws.append(headers)
    for row in rows:
        ws.append(row)
    ws.freeze_panes = "B2" if title in ("Columns", "Relationships") else "A2"
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A3
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.print_title_rows = "1:1"
    ws.print_options.horizontalCentered = True
    ws.oddFooter.center.text = "EVEXIA merged-code dictionary | Page &P of &N"
    ws.row_dimensions[1].height = 34
    for index, width in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(index)].width = width
    for cell in ws[1]:
        cell.font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="163B50")
        cell.alignment = Alignment(wrap_text=True, vertical="center")
    for row in ws.iter_rows(min_row=2):
        max_lines = 1
        for i, cell in enumerate(row):
            # Explicit string cells, never formulas or automatic hyperlinks.
            if isinstance(cell.value, str):
                cell.data_type = "s"
            cell.font = Font(name="Calibri", size=11, color="17394B")
            cell.alignment = Alignment(wrap_text=True, vertical="top")
            text = str(cell.value or "")
            max_lines = max(max_lines, sum(max(1, math.ceil(len(line) / max(8, widths[i] - 3))) for line in text.split("\n")))
        ws.row_dimensions[row[0].row].height = min(409, max(32, max_lines * 16 + 8))
        if row[0].value == "alembic_version" or (title == "Relationships" and row[2].value == "No"):
            for cell in row:
                cell.fill = PatternFill("solid", fgColor="FFF0D5")
    ref = f"A1:{get_column_letter(ws.max_column)}{ws.max_row}"
    tab = Table(displayName=title.replace(" ", "") + "Dictionary", ref=ref)
    tab.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
    ws.add_table(tab)
    ws.auto_filter.ref = ref
    ws.print_area = ref


def validate(path, expected, metadata, constraint_count):
    wb = load_workbook(path, data_only=False, keep_links=False)
    assert wb.sheetnames == ["Read Me", "Tables", "Columns", "Relationships"]
    for ws, rows in zip(wb.worksheets, expected):
        actual = list(ws.iter_rows(min_row=2, values_only=True))
        assert actual == [tuple(row) for row in rows], f"{ws.title}: round-trip data mismatch"
        assert ws.freeze_panes and ws.auto_filter.ref and len(ws.tables) == 1
        assert all(cell.data_type != "f" and cell.hyperlink is None for row in ws for cell in row)
        assert all(ws.column_dimensions[get_column_letter(i)].width >= 10 for i in range(1, ws.max_column + 1))
        assert all(c.alignment.wrap_text for row in ws for c in row)
    rows = list(wb["Columns"].iter_rows(min_row=2, values_only=True))
    app = [r for r in rows if r[1] == "Application"]
    assert {(r[0], r[2]) for r in app} == {(t.name, c.name) for t in Base.metadata.tables.values() for c in t.c}
    assert len(app) == sum(len(t.c) for t in Base.metadata.tables.values())
    fks = [r for r in wb["Relationships"].iter_rows(min_row=2, values_only=True) if r[2] == "Yes"]
    assert len({r[0] for r in fks}) == constraint_count
    assert len(fks) == sum(len(fk.elements) for t in metadata.tables.values() for fk in t.foreign_key_constraints)
    for row in fks:
        assert row[5] in metadata.tables[row[4]].c and row[7] in metadata.tables[row[6]].c
    composite = [r for r in fks if r[9] > 1]
    assert [(r[5], r[7]) for r in composite] == [("session_id", "id"), ("user_id", "user_id")]
    assert any(r[4] == r[6] == "refresh_sessions" for r in fks)
    assert any(r[4] == r[6] == "mr_directory" for r in fks)
    assert any(r[4] == r[6] == "files" for r in fks)
    assert not wb._external_links and wb.vba_archive is None
    with ZipFile(path) as archive:
        assert archive.testzip() is None
        assert not any("vba" in n.lower() or "externallink" in n.lower() or "connections" in n.lower() for n in archive.namelist())
    return {"application_tables": len(Base.metadata.tables), "application_columns": len(app),
            "foreign_key_constraints": constraint_count, "foreign_key_column_pairs": len(fks),
            "logical_or_derived_rows": len(LOGICAL), "infrastructure_tables": 2,
            "sheets": wb.sheetnames, "validation": "PASS"}


def main():
    global OUTPUT
    parser = argparse.ArgumentParser()
    parser.add_argument("--working-tree", action="store_true",
                        help="Explicitly labeled unmerged snapshot for synthetic verification, never a merged/release export.")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    OUTPUT = args.output.resolve()
    sources = sorted((BACKEND / "app/db").glob("*.py")) + sorted((BACKEND / "alembic/versions").glob("*.py"))
    # Session/config modules are not imported or inspected for live settings.
    sources = [p for p in sources if p.name != "session.py"]
    committed = set(git("ls-files").splitlines())
    for path in sources:
        relative = path.relative_to(ROOT).as_posix()
        if not args.working_tree:
            assert relative in committed, f"Unmerged/untracked schema source: {relative}"
            assert subprocess.check_output(["git", "-C", str(ROOT), "show", f"HEAD:{relative}"]) == path.read_bytes(), f"Unmerged schema change: {relative}"
    commit = git("rev-parse", "HEAD")
    source_hash = hashlib.sha256(b"".join(
        p.relative_to(ROOT).as_posix().encode() + b"\0" + p.read_bytes() for p in sources)).hexdigest()
    assert set(TABLES) == set(Base.metadata.tables) | {"directory_crypto_stage"}, "Business descriptions must cover every current table"
    recorder, ordered, heads = migration_metadata()
    reconcile(recorder.metadata)
    snapshot = datetime.now(timezone.utc).isoformat(timespec="seconds")
    readme, tables, columns, relationships, count = build_rows(recorder, ordered, heads, commit, source_hash, snapshot)
    if args.working_tree:
        readme[0] = ("Document", "EVEXIA Database Data Dictionary — UNMERGED WORKING TREE verification snapshot, not a release or live database export.")
    wb = Workbook()
    wb.remove(wb.active)
    wb.properties.title = "EVEXIA Database Data Dictionary"
    wb.properties.subject = "Offline merged-code schema snapshot; no database records"
    wb.properties.creator = "EVEXIA"
    sheet(wb, "Read Me", ["Topic", "Explanation"], readme, [36, 115])
    sheet(wb, "Tables", ["Table", "Scope", "Purpose", "Column count", "Referenced tables (FK only)", "Created by revision", "Unique constraints (migration)", "Check constraints (migration)", "Indexes declared through migration operations"], tables, [34, 26, 80, 14, 45, 32, 65, 95, 85])
    sheet(wb, "Columns", ["Table", "Scope", "Column", "PostgreSQL data type", "Nullable (migrations)", "Primary key", "Column purpose", "Application / ORM insert default", "Database default / generated (migrations)", "ORM server_default / generated", "ORM on-update", "FK target table(s)", "FK target column(s)", "ORM nullable"], columns, [34, 26, 29, 34, 16, 12, 80, 38, 48, 48, 28, 35, 28, 14])
    sheet(wb, "Relationships", ["Relationship ID", "Relationship kind", "Enforced FK", "Constraint name", "Source table", "Source column", "Target table", "Target column", "Pair position", "Pairs in constraint", "On delete", "On update", "Explanation"], relationships, [42, 37, 14, 58, 34, 35, 34, 27, 14, 18, 38, 38, 80])
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUTPUT)
    summary = validate(OUTPUT, [readme, tables, columns, relationships], recorder.metadata, count)
    # Detect a merge arriving while the workbook was being built.
    assert git("rev-parse", "HEAD") == commit, "Merged source changed during generation; regenerate"
    summary.update(snapshot_utc=snapshot, source_commit=commit, schema_sha256=source_hash,
                   migration_heads=heads, working_tree=args.working_tree,
                   file=str(OUTPUT.relative_to(ROOT)) if OUTPUT.is_relative_to(ROOT) else OUTPUT.name)
    OUTPUT.with_suffix(".validation.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
