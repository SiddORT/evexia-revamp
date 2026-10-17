"""Atomic, empty-only production installation. Never an existing-data upgrade."""
import argparse
import json
import sys

from alembic import op
from alembic.runtime.environment import EnvironmentContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app import fresh_install as fresh
from app.core.config import get_settings
from app.services.initialization_diagnostics import exception_diagnostic


def initialize(connection, settings, *, database, cluster, host, port, hostname=None):
    """The pristine proof and every DDL/bootstrap operation share one transaction.

    Only the organization-retirement step has an empty-install implementation.
    Its historical operator implementation remains unchanged. No approval,
    backup, restoration or origin evidence is manufactured.
    """
    if not connection.in_transaction():
        raise fresh.FreshInstallBlocked("Caller-owned transaction required.")
    fresh.configuration(settings)
    fresh.reviewed_graph()
    url = make_url(settings.database_url)
    if (url.query.get("host") or url.host, url.port or 5432) != (host, port):
        raise fresh.FreshInstallBlocked("Configured database host/port does not match the expected target.")
    fresh.verify_database_target(connection, database, cluster)
    if connection.scalar(text("SELECT pg_is_in_recovery()")) is not False:
        raise fresh.FreshInstallBlocked("A writable primary is required.")
    connection.execute(text("SET LOCAL lock_timeout='10s'"))
    connection.execute(text("SET LOCAL statement_timeout='120s'"))
    if not connection.scalar(text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": fresh.LOCK_ID}):
        raise fresh.FreshInstallBlocked("Another migration/operator is active.")
    fresh.pristine(connection)
    transaction = connection.get_transaction()
    config = fresh.alembic_config(connection)
    script = ScriptDirectory.from_config(config)

    def empty_retirement():
        # This closure exists ONLY after pristine() succeeded on this exact
        # still-open transaction. It cannot be selected by ordinary Alembic,
        # the deployment runner, x-arguments, env settings or an existing DB.
        if op.get_bind() is not connection or connection.get_transaction() is not transaction:
            raise fresh.FreshInstallBlocked("Fresh transaction identity changed.")
        from app.services import organization_retirement as retirement
        retirement.lock(connection)
        report = retirement.preflight(connection)
        if (report["revision"] != retirement.PREVIOUS or report["unexpected_dependency_count"]
                or any(report["counts"].values())):
            raise fresh.FreshInstallBlocked("Empty retirement state/dependencies changed.")
        op.drop_constraint("refresh_sessions_organization_id_fkey", "refresh_sessions", type_="foreignkey")
        op.drop_index("ix_audit_events_organization_created", table_name="audit_events")
        op.drop_column("refresh_sessions", "organization_id")
        op.drop_column("audit_events", "organization_id")
        op.drop_table("memberships")
        op.drop_table("organizations")

    def steps(current, context):
        # Alembic's normal topological planner handles down_revision/depends_on.
        # Only one reviewed revision has alternative empty-only semantics;
        # all other historical upgrade functions execute without alteration.
        planned = script._upgrade_revs(fresh.FINAL_TARGET, current)
        for step in planned:
            if step.revision.revision == "0031_remove_organizations":
                step.migration_fn = empty_retirement
        return planned

    with EnvironmentContext(config, script, fn=steps, as_sql=False,
                            destination_rev=fresh.FINAL_TARGET):
        script.run_env()
    fresh.finalize(connection, settings, hostname)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-database", required=True)
    parser.add_argument("--expected-system-identifier", required=True, type=int)
    parser.add_argument("--expected-host", required=True)
    parser.add_argument("--expected-port", type=int, default=5432)
    parser.add_argument("--admin-hostname")
    args = parser.parse_args(argv)
    engine = None
    try:
        if (not args.expected_database or not args.expected_host
                or not 0 < args.expected_system_identifier < 2**64
                or not 0 < args.expected_port < 65536):
            raise fresh.FreshInstallBlocked("Explicit valid target identity required.")
        hostname = args.admin_hostname
        if hostname is not None:
            from app.schemas.role_urls import canonical_hostname
            hostname = canonical_hostname(hostname)
        settings = get_settings()
        url = settings.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        if not url.startswith("postgresql+psycopg://"):
            raise fresh.FreshInstallBlocked("PostgreSQL is required.")
        engine = create_engine(url, hide_parameters=True)
        with engine.begin() as connection:
            initialize(connection, settings, database=args.expected_database,
                       cluster=args.expected_system_identifier, host=args.expected_host,
                       port=args.expected_port, hostname=hostname)
        print(json.dumps({"result": "INITIALIZATION_READY", "schema": fresh.FINAL_TARGET,
                          "super_admin": "created", "transaction": "committed"}))
        return 0
    except fresh.FreshInstallBlocked as exc:
        print("INITIALIZATION_BLOCKED: " + exception_diagnostic(exc), file=sys.stderr)
        return 1
    except Exception as exc:
        print("INITIALIZATION_ERROR: " + exception_diagnostic(exc), file=sys.stderr)
        print("INITIALIZATION_FAILED: success was not confirmed; details sanitized. "
              "Failures before commit roll back. If commit/output acknowledgement was lost, "
              "inspect revision/readiness before retry; do not assume rollback.",
              file=sys.stderr)
        return 1
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
