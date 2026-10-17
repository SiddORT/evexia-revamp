#!/usr/bin/env python3
"""Standing development-only policy: classified, additive, atomic migrations.

Never initializes a pristine DB through protected history, supplies approvals,
resets data, migrates production, stamps, or upgrades head.
"""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "artifacts/api-server/backend"
sys.path.insert(0, str(BACKEND))


class Blocked(ValueError):
    pass


def additive(path):
    """Conservative allowlist; arbitrary Python/SQL cannot be auto-authorized."""
    tree = ast.parse(path.read_text())
    upgrade = None
    functions = set()
    for node in tree.body:
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            continue
        if isinstance(node, ast.Import):
            if not all(n.name == "sqlalchemy" and n.asname == "sa" for n in node.names):
                raise Blocked("UNREVIEWED_IMPORT")
        elif isinstance(node, ast.ImportFrom):
            if node.module != "alembic" or [(n.name, n.asname) for n in node.names] != [("op", None)]:
                raise Blocked("UNREVIEWED_IMPORT")
        elif isinstance(node, ast.Assign):
            if not all(isinstance(n, ast.Name) and n.id in ("revision", "down_revision", "branch_labels", "depends_on") for n in node.targets):
                raise Blocked("EXECUTABLE_MODULE_STATE")
            ast.literal_eval(node.value)
        elif isinstance(node, ast.FunctionDef) and node.name in ("upgrade", "downgrade"):
            if node.name in functions:
                raise Blocked("DUPLICATE_MIGRATION_FUNCTION")
            functions.add(node.name)
            if (node.decorator_list or node.returns or node.args.args or node.args.defaults or
                    node.args.posonlyargs or node.args.kwonlyargs or node.args.kw_defaults or
                    node.args.vararg or node.args.kwarg):
                raise Blocked("EXECUTABLE_MIGRATION_SIGNATURE")
            if node.name == "upgrade":
                upgrade = node
        else:
            raise Blocked("UNREVIEWED_MIGRATION_CODE")
    if upgrade is None:
        raise Blocked("MISSING_UPGRADE")
    for statement in upgrade.body:
        if isinstance(statement, ast.Pass):
            continue
        if not isinstance(statement, ast.Expr) or not isinstance(statement.value, ast.Call):
            raise Blocked("NON_ADDITIVE_MIGRATION")
        call = statement.value
        if (not isinstance(call.func, ast.Attribute) or not isinstance(call.func.value, ast.Name)
                or call.func.value.id != "op" or call.func.attr not in ("add_column", "create_table", "create_index")):
            raise Blocked("NON_ADDITIVE_MIGRATION")
        for child in ast.walk(call):
            if isinstance(child, ast.Call) and child is not call:
                if (not isinstance(child.func, ast.Attribute) or not isinstance(child.func.value, ast.Name)
                        or child.func.value.id != "sa" or child.func.attr not in
                        ("Column", "String", "Text", "Integer", "BigInteger", "SmallInteger", "Boolean",
                         "DateTime", "Date", "Numeric", "JSON", "Float", "LargeBinary", "ForeignKey",
                         "PrimaryKeyConstraint", "UniqueConstraint")):
                    raise Blocked("EXECUTABLE_DDL_EXPRESSION")
            if isinstance(child, (ast.Name, ast.Attribute)) and isinstance(child.ctx, ast.Load):
                if isinstance(child, ast.Name) and child.id not in ("op", "sa"):
                    raise Blocked("DYNAMIC_DDL_EXPRESSION")
            if isinstance(child, (ast.Lambda, ast.Starred, ast.ListComp, ast.DictComp, ast.GeneratorExp, ast.Subscript)):
                raise Blocked("DYNAMIC_DDL_EXPRESSION")
            if isinstance(child, ast.keyword) and (child.arg is None or child.arg in ("default", "server_default", "postgresql_concurrently")):
                raise Blocked("UNREVIEWED_DEFAULT_OR_CONCURRENT_DDL")
        if call.func.attr == "add_column":
            if len(call.args) != 2 or not isinstance(call.args[1], ast.Call):
                raise Blocked("UNREVIEWED_COLUMN")
            column = call.args[1]
            if not isinstance(column.func, ast.Attribute) or column.func.attr != "Column":
                raise Blocked("UNREVIEWED_COLUMN")
            if not any(k.arg == "nullable" and isinstance(k.value, ast.Constant) and k.value.value is True for k in column.keywords):
                raise Blocked("EXISTING_TABLE_COLUMN_MUST_BE_NULLABLE")


def target_matches(settings, connection, binding):
    if settings.app_env != "development" or binding.get("version") != 1:
        raise Blocked("DEVELOPMENT_ONLY")
    row = connection.exec_driver_sql(
        "SELECT current_database(), (SELECT system_identifier::text FROM pg_control_system()), "
        "(SELECT oid FROM pg_database WHERE datname=current_database()), pg_is_in_recovery()"
    ).one()
    driver = connection.connection.driver_connection
    if (driver.info.host, driver.info.port, *row) != (
            binding["host"], binding["port"], binding["database"], binding["cluster"], binding["oid"], False):
        raise Blocked("WRONG_DEVELOPMENT_DATABASE")


def source_review(root):
    spec = importlib.util.spec_from_file_location(
        "development_schema_review", root / "scripts/review-development-schema.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        return module.review(root)
    except module.ReviewBlocked as exc:
        raise Blocked(str(exc)) from None


def synchronize(*, root=ROOT, settings=None, engine=None, readiness_check=None):
    """Only tests inject a disposable engine/settings; the CLI has no overrides."""
    from sqlalchemy import create_engine
    from alembic import command
    from alembic.config import Config
    # Independent development integrity, not production installation approval.
    # No compatibility diagnostics or shared database probe occurs in this check.
    runner, graph, policy, target, paths = source_review(root)
    backend = root / "artifacts/api-server/backend"
    if settings is None:
        from app.core.config import get_settings
        settings = get_settings()
    if settings.app_env != "development":
        raise Blocked("DEVELOPMENT_ONLY")
    binding = json.loads((root / "scripts/development-database.json").read_text())
    owned_engine = engine is None
    if owned_engine:
        engine = create_engine(settings.database_url.replace("postgresql://", "postgresql+psycopg://", 1), hide_parameters=True)
    try:
        return synchronize_connection(engine, settings, binding, root, backend, runner,
                                      graph, policy, target, paths, command, Config, readiness_check)
    finally:
        if owned_engine:
            engine.dispose()


def synchronize_connection(engine, settings, binding, root, backend, runner,
                           graph, policy, target, paths, command, Config, readiness_check):
    with engine.begin() as connection:
        connection.exec_driver_sql("SET LOCAL lock_timeout='10s'")
        connection.exec_driver_sql("SET LOCAL statement_timeout='60s'")
        target_matches(settings, connection, binding)
        if not connection.exec_driver_sql("SELECT pg_try_advisory_xact_lock(145002)").scalar_one():
            raise Blocked("OTHER_OPERATOR_ACTIVE")
        if not connection.exec_driver_sql("SELECT to_regclass('public.alembic_version')").scalar_one():
            raise Blocked("FRESH_DATABASE_REQUIRES_SUPPORTED_FRESH_INSTALL")
        current = list(connection.exec_driver_sql("SELECT version_num FROM public.alembic_version").scalars())
        try:
            planned = runner.plan(graph, policy, current, target)
        except runner.PolicyError as exc:
            raise Blocked(str(exc)) from None
        if planned["operator_only"]:
            planned["action"] = (
                "No migrations executed. Obtain exact-path operator approval and verified recovery; "
                "follow docs/development-schema-activation.md. Do not stamp, reclassify or upgrade head."
            )
            print(json.dumps(planned))
            return 42
        pinned = {}
        for revision in planned["pending"]:
            additive(paths[revision])
            pinned[revision] = hashlib.sha256(paths[revision].read_bytes()).hexdigest()
        if pinned:
            tables = connection.exec_driver_sql(
                "SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2"
            ).all()
            quote = connection.dialect.identifier_preparer.quote
            connection.exec_driver_sql("LOCK TABLE " + ", ".join(
                quote(s) + "." + quote(t) for s, t in tables) + " IN SHARE MODE")
            for revision, digest in pinned.items():
                if hashlib.sha256(paths[revision].read_bytes()).hexdigest() != digest:
                    raise Blocked("MIGRATION_CHANGED")
            # Revalidate the complete reviewed contract after waiting for table locks.
            source_review(root)
            config = Config(str(backend / "alembic.ini"))
            config.set_main_option("script_location", str(backend / "alembic"))
            config.attributes["connection"] = connection
            command.upgrade(config, target)
            # A schema/key/runtime postcondition failure rolls back the DDL too.
            if readiness_check is None:
                from sqlalchemy.orm import Session
                from app.api.v1.system import readiness
                with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
                    readiness(db)
            else:
                readiness_check(connection)
        if list(connection.exec_driver_sql("SELECT version_num FROM public.alembic_version").scalars()) != [target]:
            raise Blocked("POSTCONDITION_FAILED")
    # Emit success only after commit succeeds.
    print(json.dumps({"result": "READY", "schema": target, "applied": planned["pending"]}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(synchronize())
    except Exception as exc:
        print("DEVELOPMENT_SYNC_BLOCKED: " + (str(exc) if isinstance(exc, Blocked) else type(exc).__name__), file=sys.stderr)
        sys.exit(1)
