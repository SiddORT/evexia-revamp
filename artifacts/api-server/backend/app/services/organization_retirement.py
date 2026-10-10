"""Read-only legacy inventory and restricted external recovery evidence.

No credential/contact fields are returned by preflight. Recovery files contain
retired rows and correlations only, never passwords or refresh token hashes.
"""
import hashlib
import hmac
import json
import os
import stat
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

PREVIOUS = "0031_role_hostnames"
REVISION = "0032_remove_organizations"
TABLES = ("organizations", "memberships")
CONSTRAINTS = {
    "organizations": {"organizations_pkey"},
    "memberships": {"memberships_pkey", "memberships_user_id_fkey",
                    "memberships_organization_id_fkey",
                    "memberships_user_id_organization_id_key", "ck_membership_role"},
}
INDEXES = {
    "organizations": {"organizations_pkey": ["id"]},
    "memberships": {"memberships_pkey": ["id"],
                    "memberships_user_id_organization_id_key": ["user_id", "organization_id"],
                    "ix_memberships_user_id": ["user_id"],
                    "ix_memberships_organization_id": ["organization_id"]},
}
EXPECTED_COLUMNS = {
    "organizations": {"id", "name", "created_at", "updated_at"},
    "memberships": {"id", "user_id", "organization_id", "role", "is_active", "created_at", "updated_at"},
}
MARKER_ACTION = "refresh_rejected"
MARKER_REASON = "legacy_scope_retired"
MARKER_RESOURCE = "refresh_credential"


class RetirementBlocked(RuntimeError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def connection_url(url):
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    if not url.startswith("postgresql+psycopg://"):
        raise RetirementBlocked("PostgreSQL with the application driver is required.")
    return url


def lock(db):
    # Freeze all retirement, ownership, eligibility and audit evidence through DDL.
    # NOWAIT refuses rather than hangs while old runtime writers are still active.
    db.execute(sa.text("""
      LOCK TABLE organizations, memberships, users, staff_profiles, custom_roles,
        mr_profiles, auth_sessions, refresh_sessions, audit_events
      IN ACCESS EXCLUSIVE MODE NOWAIT
    """))


def catalog(db):
    """Reject both catalog dependencies and discoverable logical SQL references."""
    inspector = sa.inspect(db)
    schema = db.scalar(sa.text("SELECT current_schema()"))
    problems = []
    for table in TABLES:
        columns = inspector.get_columns(table, schema=schema)
        if {c["name"] for c in columns} != EXPECTED_COLUMNS[table]:
            problems.append(f"{table}: unexpected columns")
        if inspector.get_table_comment(table, schema=schema)["text"] is not None:
            problems.append(f"{table}: unreviewed table comment")
        for column in columns:
            name = column["name"]
            expected = ("UUID" if name == "id" or name.endswith("_id") else
                        "VARCHAR(160)" if name == "name" else
                        "VARCHAR(20)" if name == "role" else
                        "BOOLEAN" if name == "is_active" else "TIMESTAMP WITH TIME ZONE")
            if (column.get("comment") is not None or column.get("computed") or column.get("identity")
                    or str(column["type"].compile(dialect=postgresql.dialect())) != expected or column["nullable"]
                    or column.get("default") != ("now()" if name in ("created_at", "updated_at") else None)):
                problems.append(f"{table}.{name}: unexpected definition")
        foreign = inspector.get_foreign_keys(table, schema=schema)
        expected_foreign = set() if table == "organizations" else {
            (("user_id",), "users", ("id",)), (("organization_id",), "organizations", ("id",))}
        if ({(tuple(f["constrained_columns"]), f["referred_table"], tuple(f["referred_columns"])) for f in foreign}
                != expected_foreign or any(f["options"] or f["referred_schema"] not in (None, schema) for f in foreign)):
            problems.append(f"{table}: unexpected foreign-key definition")
        checks = inspector.get_check_constraints(table, schema=schema)
        # PostgreSQL versions vary in deparser parentheses around this single
        # ANY expression; remove only parentheses, not operators or literals.
        normalized_checks = [c["sqltext"].replace("(", "").replace(")", "") for c in checks]
        if table == "memberships" and normalized_checks != [
                "role::text = ANY ARRAY['owner'::character varying, 'admin'::character varying, 'viewer'::character varying]::text[]"]:
            problems.append("memberships: unexpected role check")
        actual = db.execute(sa.text("""
          SELECT conname FROM pg_constraint WHERE conrelid=to_regclass(:table)
        """), {"table": f'"{schema}"."{table}"'}).scalars().all()
        if set(actual) != CONSTRAINTS[table]:
            problems.append(f"{table}: unexpected constraints")
        altered_constraints = db.scalar(sa.text("""
          SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass(:table)
            AND (NOT convalidated OR condeferrable OR condeferred
              OR contype<>CASE WHEN conname LIKE '%_pkey' THEN 'p'::"char"
                WHEN conname LIKE '%_fkey' THEN 'f'::"char"
                WHEN conname LIKE '%_key' THEN 'u'::"char" ELSE 'c'::"char" END))
        """), {"table": f'"{schema}"."{table}"'})
        if altered_constraints:
            problems.append(f"{table}: unexpected constraint validity/type/timing")
        actual_indexes = db.execute(sa.text("""
          SELECT ci.relname AS name, i.indisvalid, i.indpred IS NULL AS plain,
            i.indisunique, am.amname,
            NOT EXISTS(SELECT 1 FROM unnest(i.indoption) opt WHERE opt<>0) AS default_order,
            NOT EXISTS(SELECT 1 FROM unnest(i.indclass) cls
              JOIN pg_opclass opc ON opc.oid=cls JOIN pg_namespace ns ON ns.oid=opc.opcnamespace
              WHERE NOT opc.opcdefault OR ns.nspname<>'pg_catalog') AS default_ops,
            array(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY k(n,ord)
              LEFT JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.n
              ORDER BY k.ord) AS columns
          FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid
          JOIN pg_am am ON am.oid=ci.relam
          WHERE i.indrelid=to_regclass(:table)
        """), {"table": f'"{schema}"."{table}"'}).mappings().all()
        if ({r["name"]: list(r["columns"]) for r in actual_indexes} != INDEXES[table]
                or any(not r["plain"] or not r["indisvalid"] or not r["default_order"]
                       or not r["default_ops"] or r["amname"] != "btree"
                       or r["indisunique"] != (r["name"].endswith("_pkey") or r["name"].endswith("_key"))
                       for r in actual_indexes)):
            problems.append(f"{table}: unexpected indexes")
    refresh_fk = [f for f in inspector.get_foreign_keys("refresh_sessions", schema=schema)
                  if "organization_id" in f["constrained_columns"]]
    if (len(refresh_fk) != 1 or refresh_fk[0]["constrained_columns"] != ["organization_id"]
            or refresh_fk[0]["referred_table"] != "organizations"
            or refresh_fk[0]["referred_columns"] != ["id"] or refresh_fk[0]["options"]
            or refresh_fk[0]["referred_schema"] not in (None, schema)):
        problems.append("refresh_sessions: unexpected retired foreign key")
    for table in ("refresh_sessions", "audit_events"):
        column = next((c for c in inspector.get_columns(table, schema=schema)
                       if c["name"] == "organization_id"), None)
        if (column is None or not column["nullable"] or column["default"] is not None
                or str(column["type"].compile(dialect=postgresql.dialect())) != "UUID"
                or column.get("computed") or column.get("identity")):
            problems.append(f"{table}: unexpected retired column definition")
    audit_index = [i for i in inspector.get_indexes("audit_events", schema=schema)
                   if i["name"] == "ix_audit_events_organization_created"]
    if (len(audit_index) != 1 or audit_index[0]["column_names"] != ["organization_id", "created_at"]
            or audit_index[0]["unique"] or audit_index[0].get("column_sorting")
            or any(audit_index[0].get("dialect_options", {}).values())):
        problems.append("audit_events: unexpected retired index")
    unusual = db.execute(sa.text("""
      SELECT c.relname FROM pg_class c WHERE c.oid IN
        (to_regclass('organizations'),to_regclass('memberships'))
        AND (c.relkind<>'r' OR c.relrowsecurity OR c.relforcerowsecurity OR
          EXISTS(SELECT 1 FROM pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid))
    """)).scalars().all()
    problems.extend(f"{table}: unexpected table policy/kind/inheritance" for table in unusual)
    unusual_access = db.execute(sa.text("""
      SELECT c.relname FROM pg_class c WHERE c.oid IN
        (to_regclass('organizations'),to_regclass('memberships'))
        AND (pg_get_userbyid(c.relowner)<>current_user OR c.relacl IS NOT NULL
          OR EXISTS(SELECT 1 FROM pg_seclabel s WHERE s.classoid='pg_class'::regclass AND s.objoid=c.oid))
      UNION SELECT c.relname FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
        WHERE (c.oid IN (to_regclass('organizations'),to_regclass('memberships'))
          OR c.oid IN (to_regclass('refresh_sessions'),to_regclass('audit_events')) AND a.attname='organization_id')
        AND a.attacl IS NOT NULL
    """)).scalars().all()
    problems.extend(f"{table}: unreviewed ownership/ACL/security label" for table in unusual_access)
    # Dependencies of entire retired tables or the two retired columns. Only
    # reviewed baseline constraints/indexes/defaults/row types may disappear.
    dependencies = db.execute(sa.text("""
      SELECT d.classid::regclass::text AS kind,
        pg_describe_object(d.classid,d.objid,d.objsubid) AS object,
        co.conname, cr.relname AS constraint_table, cn.nspname AS constraint_schema,
        ci.relname AS index_name, ni.nspname AS index_schema,
        ty.typrelid IN (to_regclass('organizations'),to_regclass('memberships')) AS row_type,
        ad.adrelid IN (to_regclass('organizations'),to_regclass('memberships'))
          AND aa.attname IN ('created_at','updated_at') AS baseline_default
      FROM pg_depend d
      LEFT JOIN pg_constraint co ON d.classid='pg_constraint'::regclass AND co.oid=d.objid
      LEFT JOIN pg_class cr ON cr.oid=co.conrelid
      LEFT JOIN pg_namespace cn ON cn.oid=cr.relnamespace
      LEFT JOIN pg_class ci ON d.classid='pg_class'::regclass AND ci.oid=d.objid
      LEFT JOIN pg_namespace ni ON ni.oid=ci.relnamespace
      LEFT JOIN pg_type ty ON d.classid='pg_type'::regclass AND ty.oid=d.objid
      LEFT JOIN pg_attrdef ad ON d.classid='pg_attrdef'::regclass AND ad.oid=d.objid
      LEFT JOIN pg_attribute aa ON aa.attrelid=ad.adrelid AND aa.attnum=ad.adnum
      LEFT JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid
      WHERE d.refclassid='pg_class'::regclass AND
        (d.refobjid IN (to_regclass('organizations'),to_regclass('memberships'))
        OR (d.refobjid IN (to_regclass('refresh_sessions'),to_regclass('audit_events'))
          AND a.attname='organization_id'))
      ORDER BY object
    """)).mappings().all()
    allowed_constraints = {**CONSTRAINTS, "refresh_sessions": {"refresh_sessions_organization_id_fkey"}}
    allowed_indexes = {n for names in INDEXES.values() for n in names} | {"ix_audit_events_organization_created"}
    for r in dependencies:
        known = (
            (r["constraint_schema"] == schema
             and r["conname"] in allowed_constraints.get(r["constraint_table"], set()))
            or (r["index_schema"] == schema and r["index_name"] in allowed_indexes)
            or r["row_type"] or r["baseline_default"]
        )
        if not known:
            problems.append(r["object"])
    # Bodies may use dynamic SQL that PostgreSQL's dependency catalog cannot see.
    # Scan all non-system schemas, not just the selected application's schema.
    logical = db.execute(sa.text("""
      SELECT 'function' AS kind, n.nspname AS schema, p.proname AS name
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema')
        AND p.prosrc ~* '\\m(organizations|memberships|organization_id)\\M'
      UNION ALL SELECT 'view', schemaname, viewname FROM pg_views
      WHERE schemaname NOT IN ('pg_catalog','information_schema')
        AND definition ~* '\\m(organizations|memberships|organization_id)\\M'
      UNION ALL SELECT 'materialized_view', schemaname, matviewname FROM pg_matviews
      WHERE definition ~* '\\m(organizations|memberships|organization_id)\\M'
      UNION ALL SELECT 'trigger', n.nspname, t.tgname FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND c.oid IN (to_regclass('organizations'),to_regclass('memberships'))
      ORDER BY kind, schema, name
    """)).mappings().all()
    problems.extend(f"{r['kind']} {r['schema']}.{r['name']}" for r in logical)
    return sorted(set(problems))


def preflight(db, limit=100, offset=0):
    if not 1 <= limit <= 100 or offset < 0:
        raise RetirementBlocked("limit must be 1–100 and offset nonnegative.")
    counts = {}
    for table in TABLES:
        counts[table] = db.scalar(sa.text(f"SELECT count(*) FROM {table}"))
    for table in ("refresh_sessions", "audit_events"):
        counts[table + "_correlations"] = db.scalar(sa.text(
            f"SELECT count(*) FROM {table} WHERE organization_id IS NOT NULL"))
    counts["membership_users"] = db.scalar(sa.text("SELECT count(DISTINCT user_id) FROM memberships"))
    counts["dangling_audit_correlations"] = db.scalar(sa.text("""
      SELECT count(*) FROM audit_events a LEFT JOIN organizations o ON o.id=a.organization_id
      WHERE a.organization_id IS NOT NULL AND o.id IS NULL
    """))
    counts["logical_retired_audit_resources"] = db.scalar(sa.text("""
      SELECT count(*) FROM audit_events WHERE resource_type IN
        ('organization','organizations','membership','memberships')
    """))
    counts["dangling_retired_audit_resources"] = db.scalar(sa.text("""
      SELECT count(*) FROM audit_events a WHERE
        (a.resource_type IN ('organization','organizations') AND NOT EXISTS
          (SELECT 1 FROM organizations o WHERE o.id=a.resource_id)) OR
        (a.resource_type IN ('membership','memberships') AND NOT EXISTS
          (SELECT 1 FROM memberships m WHERE m.id=a.resource_id))
    """))
    classifications = """
      SELECT DISTINCT u.id,
        CASE WHEN NOT u.is_active THEN 'disabled'
          WHEN u.system_role='super_admin' AND u.is_protected_system_admin THEN 'super_admin'
          WHEN u.system_role='mr' AND NOT u.is_protected_system_admin AND EXISTS
            (SELECT 1 FROM mr_profiles p WHERE p.user_id=u.id AND p.is_active) THEN 'mr'
          WHEN u.system_role IS NULL AND u.email IS NULL AND u.username IS NOT NULL
            AND NOT u.is_protected_system_admin AND EXISTS
            (SELECT 1 FROM staff_profiles s LEFT JOIN custom_roles r ON r.id=s.custom_role_id
              WHERE s.user_id=u.id AND s.deleted_at IS NULL AND s.workspace_login_enabled
                AND s.status='active' AND (s.custom_role_id IS NULL OR
                  (r.id IS NOT NULL AND r.deleted_at IS NULL))) THEN 'staff'
          WHEN u.system_role IS NULL THEN 'unmapped' ELSE 'ineligible' END AS eligibility
      FROM users u JOIN memberships m ON m.user_id=u.id
    """
    categories = dict(db.execute(sa.text(
        f"SELECT eligibility,count(*) FROM ({classifications}) q GROUP BY eligibility")).all())
    items = [dict(r) for r in db.execute(sa.text(
        f"{classifications} ORDER BY u.id LIMIT :limit OFFSET :offset"),
        {"limit": limit, "offset": offset}).mappings()]
    refresh_states = dict(db.execute(sa.text("""
      SELECT CASE WHEN r.revoked_at IS NOT NULL THEN 'revoked'
        WHEN r.consumed_at IS NOT NULL THEN 'consumed'
        WHEN r.expires_at<=now() OR r.family_expires_at<=now() THEN 'expired'
        WHEN s.id IS NULL THEN 'session_unbound'
        WHEN s.status<>'ACTIVE' THEN 'session_inactive' ELSE 'scope_rejected_only' END AS state,
        count(*) FROM refresh_sessions r LEFT JOIN auth_sessions s ON s.id=r.session_id
      WHERE r.organization_id IS NOT NULL GROUP BY state
    """)).all())
    samples = {}
    for table in ("refresh_sessions", "audit_events"):
        samples[table] = [dict(r) for r in db.execute(sa.text(
            f"SELECT id,organization_id FROM {table} WHERE organization_id IS NOT NULL "
            "ORDER BY id LIMIT :limit OFFSET :offset"), {"limit": limit, "offset": offset}).mappings()]
    problems = catalog(db)
    return dict(status="blocked" if problems else "verified_read_only",
                revision=db.scalar(sa.text("SELECT version_num FROM alembic_version")),
                counts=counts, eligibility_counts=categories, membership_users=items,
                refresh_state_counts=refresh_states, correlation_samples=samples,
                has_more=offset + limit < counts["membership_users"],
                unexpected_dependency_count=len(problems), unexpected_dependencies=problems[:100],
                retention="operator resolution required before populated removal",
                external_dependencies="operator must review external SQL consumers; not discoverable from this database")


def snapshot(db):
    """Complete bounded-by-file-size recovery data, never emitted in reports."""
    result = {"format": 1, "revision": PREVIOUS,
              "database": db.scalar(sa.text("SELECT current_database()")),
              "operator_role": db.scalar(sa.text("SELECT current_user")),
              "schema": db.scalar(sa.text("SELECT current_schema()"))}
    for table in TABLES:
        result[table] = [dict(r) for r in db.execute(sa.text(f"SELECT * FROM {table} ORDER BY id")).mappings()]
    for table in ("refresh_sessions", "audit_events"):
        rows = db.execute(sa.text(
            f"SELECT * FROM {table} WHERE organization_id IS NOT NULL ORDER BY id")).mappings()
        result[table] = []
        for row in rows:
            retained = {k: v for k, v in row.items() if k != "organization_id"}
            result[table].append(dict(id=str(row["id"]), organization_id=str(row["organization_id"]),
                                      retained_digest=digest(retained)))
    # Membership identities are preserved, never translated to a role/grant.
    result["users"] = [dict(r) for r in db.execute(sa.text("""
      SELECT u.id,u.system_role,u.is_active,u.token_version,u.identity_version,
        u.is_protected_system_admin FROM users u
      WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=u.id) ORDER BY u.id
    """)).mappings()]
    return json.loads(canonical(result))


def restricted_path(path):
    path = Path(path)
    root = Path(__file__).resolve().parents[5]
    if not path.is_absolute() or path.is_symlink() or path.resolve().is_relative_to(root):
        raise RetirementBlocked("Recovery must be an absolute restricted external path outside the workspace.")
    parent = path.parent
    if parent.is_symlink() or parent.stat().st_mode & 0o077 or parent.stat().st_uid != os.getuid():
        raise RetirementBlocked("Recovery parent must be a private operator directory (0700).")
    return path


def save_backup(db, path):
    path = restricted_path(path)
    content = canonical(snapshot(db))
    if len(content) > 64 * 1024 * 1024:
        raise RetirementBlocked("Recovery file exceeds the reviewed 64 MiB bound; arrange operator recovery.")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(content)
        output.flush()
        os.fsync(output.fileno())
    return hashlib.sha256(content).hexdigest()


def load_backup(path, expected_digest):
    try:
        path = restricted_path(path)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as source:
            info = os.fstat(source.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077
                    or info.st_uid != os.getuid() or info.st_size > 64 * 1024 * 1024):
                raise RetirementBlocked("Recovery file is not a restricted operator-owned regular file.")
            content = source.read(64 * 1024 * 1024 + 1)
        if not expected_digest or not hmac.compare_digest(hashlib.sha256(content).hexdigest(), expected_digest):
            raise RetirementBlocked("Recovery integrity validation failed.")
        value = json.loads(content)
        if set(value) != {"format", "revision", "database", "schema", "operator_role", *TABLES, "users", "refresh_sessions", "audit_events"}:
            raise RetirementBlocked("Recovery structure is incomplete.")
        if value["format"] != 1 or value["revision"] != PREVIOUS:
            raise RetirementBlocked("Recovery schema revision is not the reconciled predecessor.")
        return value
    except RetirementBlocked:
        raise
    except Exception:
        raise RetirementBlocked("Recovery unavailable or invalid; no removal/restoration permitted.") from None


def verify_target(db, backup):
    if (db.scalar(sa.text("SELECT current_database()")) != backup["database"]
            or db.scalar(sa.text("SELECT current_schema()")) != backup["schema"]
            or db.scalar(sa.text("SELECT current_user")) != backup["operator_role"]):
        raise RetirementBlocked("Recovery target database/schema/operator role does not match.")
    for user in backup["users"]:
        actual = db.execute(sa.text("""
          SELECT id,system_role,is_active,token_version,identity_version,is_protected_system_admin
          FROM users WHERE id=:id
        """), {"id": user["id"]}).mappings().one_or_none()
        if actual is None or json.loads(canonical(dict(actual))) != user:
            raise RetirementBlocked("Retained identity changed; reviewed recovery is required.")
    for table in ("refresh_sessions", "audit_events"):
        for correlation in backup[table]:
            row = db.execute(sa.text(f"SELECT * FROM {table} WHERE id=:id"),
                             {"id": correlation["id"]}).mappings().one_or_none()
            if row is None or digest({k: v for k, v in row.items() if k != "organization_id"}) != correlation["retained_digest"]:
                raise RetirementBlocked("Retained correlation row changed or missing; rollback refused.")


def evidence(db, args, *, restoring=False, populated=False):
    backup = None
    if args.get("organization_backup"):
        backup = load_backup(args["organization_backup"], args.get("organization_backup_sha256"))
        verify_target(db, backup)
        if args.get("organization_restore_verified") != args.get("organization_backup_sha256"):
            raise RetirementBlocked("A tested restoration attestation matching the backup digest is required.")
    if populated and (backup is None or args.get("organization_retention_resolved") != "yes"):
        raise RetirementBlocked("Populated retirement requires resolved retention and verified external recovery.")
    if backup is not None and not restoring and backup != snapshot(db):
        raise RetirementBlocked("Recovery counts/content changed under write exclusion; removal refused.")
    return backup
