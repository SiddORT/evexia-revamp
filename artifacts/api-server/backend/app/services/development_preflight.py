"""Bounded, redacted, read-only candidate preflight. Never run on production."""
import json
import signal
import time


class Deadline(BaseException):
    pass


def report():
    from app.core.schema import SCHEMA_REVISION
    checks = {}
    result = {"format": 1, "scope": "development-candidate", "ok": False,
              "required_revision": SCHEMA_REVISION, "current_revision": None,
              "checks": checks,
              "next_steps": [
                  "Resolve failed configuration checks using existing Secrets; never replace keys to clear this report.",
                  "Inspect the selected development database. Apply schema or crypto rollout only with separate operator approval.",
                  "Restart managed development services after approved setup. Run pnpm verify:development and retry in the browser.",
                  "A candidate pass does not verify the running API or activate this release.",
              ]}
    for name in ("contract", "configuration", "directory_keys", "staff_keys",
                 "communication_keys", "database", "revision", "directory_state",
                 "account_state", "schema", "running_api", "ingress"):
        checks[name] = "not_verified"
    try:
        from app.core.development_identity import candidate_identity
        identity = candidate_identity()
        checks["contract"] = "pass" if identity["schema"] == SCHEMA_REVISION else "incompatible_contract"
    except Exception:
        checks["contract"] = "incompatible_contract"
    try:
        from app.core.config import get_settings
        settings = get_settings()
        if settings.app_env != "development":
            checks["configuration"] = "development_only"
            return result
        settings.signing_key
        settings.allowed_origins
        settings.bootstrap_hosts
        settings.proxy_peers
        checks["configuration"] = "pass"
    except Exception:
        checks["configuration"] = "missing_or_invalid_configuration"
        return result
    from app.services.directory_crypto import DirectoryCrypto
    from app.services.staff_crypto import StaffCrypto
    from app.services.communication_crypto import CommunicationCrypto
    for name, constructor in (("directory_keys", DirectoryCrypto),
                              ("staff_keys", StaffCrypto),
                              ("communication_keys", CommunicationCrypto)):
        try:
            constructor(settings)
            checks[name] = "pass"
        except Exception:
            checks[name] = "missing_or_invalid_configuration"
    engine = None
    try:
        from sqlalchemy import create_engine, text
        from sqlalchemy.orm import Session
        from app.services.organization_retirement import connection_url
        engine = create_engine(connection_url(settings.database_url), hide_parameters=True,
                               connect_args={"connect_timeout": 2}, pool_pre_ping=False)
        with engine.connect() as connection, connection.begin():
            connection.execute(text("SET TRANSACTION READ ONLY"))
            connection.execute(text("SET LOCAL statement_timeout = '1500ms'"))
            connection.execute(text("SET LOCAL lock_timeout = '500ms'"))
            connection.execute(text("SELECT 1"))
            checks["database"] = "pass"
            try:
                revisions = connection.execute(text("SELECT version_num FROM alembic_version LIMIT 2")).scalars().all()
                # Never echo arbitrary database-controlled values.
                from app.core.development_identity import ROOT
                known = json.loads((ROOT / "scripts/migration-policy.json").read_text())["revisions"]
                result["current_revision"] = revisions if all(r in known for r in revisions) else "unknown"
                checks["revision"] = "pass" if revisions == [SCHEMA_REVISION] else "revision_mismatch"
            except Exception:
                checks["revision"] = "revision_unverified"
                return result
            if checks["revision"] != "pass":
                return result
            with Session(bind=connection) as db:
                from app.services.directory_runtime import ready as directory_ready
                from app.services.account_crypto import ready as account_ready
                # Each rule gets a savepoint so one failed SELECT cannot mask the rest.
                for name, function in (("directory_state", directory_ready), ("account_state", account_ready)):
                    try:
                        with db.begin_nested():
                            function(db)
                        checks[name] = "pass"
                    except Exception:
                        checks[name] = "configuration_or_schema_invalid"
                try:
                    from app.api.v1.system import readiness
                    with db.begin_nested():
                        readiness(db)
                    checks["schema"] = "pass"
                except Exception:
                    checks["schema"] = "configuration_or_schema_invalid"
    except Exception:
        checks["database"] = "database_unavailable"
    finally:
        if engine is not None:
            engine.dispose()
    result["ok"] = all(value == "pass" for name, value in checks.items()
                       if name not in ("running_api", "ingress"))
    return result


def main():
    started = time.monotonic()
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(Deadline()))
    signal.alarm(8)
    try:
        result = report()
    except (Exception, Deadline):
        result = {"format": 1, "scope": "development-candidate", "ok": False,
                  "checks": {"preflight": "timeout_or_unverified",
                             "running_api": "not_verified", "ingress": "not_verified"}}
    signal.alarm(0)
    result["elapsed_ms"] = round((time.monotonic() - started) * 1000)
    print(json.dumps(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
