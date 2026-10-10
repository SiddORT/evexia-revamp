"""Verified non-tenant retirement; external recovery, no substitute archives."""
import os
import uuid

from alembic import context, op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from app.services import organization_retirement as retirement

revision = "0031_remove_organizations"
down_revision = "0030_directory_crypto_retirement"
branch_labels = depends_on = None


def upgrade():
    connection = op.get_bind()
    args = context.get_x_argument(as_dictionary=True)
    if os.environ.get("APP_ENV") != "test" and args.get("organization_removal_approved") != "yes":
        raise retirement.RetirementBlocked("Separate operator approval and stopped application writers are required.")
    if os.environ.get("APP_ENV") != "test" and any(args.get(key) != "yes" for key in (
            "organization_writers_stopped", "organization_external_consumers_reviewed", "organization_backup_durable")):
        raise retirement.RetirementBlocked("Stopped writers, reviewed external consumers and durable restricted recovery custody are required.")
    retirement.lock(connection)
    report = retirement.preflight(connection)
    if report["revision"] != retirement.PREVIOUS:
        raise retirement.RetirementBlocked("Retirement must upgrade the reconciled predecessor.")
    if report["unexpected_dependency_count"]:
        raise retirement.RetirementBlocked("Unrecognized dependencies block removal; run the read-only preflight.")
    populated = any(report["counts"][key] for key in
                    ("organizations", "memberships", "refresh_sessions_correlations",
                     "audit_events_correlations", "logical_retired_audit_resources"))
    backup = retirement.evidence(connection, args, populated=populated)
    if os.environ.get("APP_ENV") != "test" and backup is None:
        raise retirement.RetirementBlocked("Managed removal requires verified external evidence even for empty retired data.")
    if populated and backup is None:
        raise retirement.RetirementBlocked("Verified populated recovery is required.")
    # Preserve the removed scope guard as credential-bound rejection evidence.
    # This adds metadata-only failure history; it does not revoke/reactivate or
    # rewrite any credential, session, user, grant or existing audit event.
    connection.execute(sa.text("""
      INSERT INTO audit_events (id,actor_id,action,resource_type,resource_id,session_id,reason,outcome)
      SELECT pg_catalog.gen_random_uuid(),r.user_id,'refresh_rejected','refresh_credential',r.id,
        r.session_id,'legacy_scope_retired','failure'
      FROM refresh_sessions r WHERE r.organization_id IS NOT NULL AND NOT EXISTS
        (SELECT 1 FROM audit_events a WHERE a.resource_id=r.id
          AND a.actor_id=r.user_id AND a.action='refresh_rejected'
          AND a.resource_type='refresh_credential' AND a.reason='legacy_scope_retired'
          AND a.outcome='failure')
    """))
    op.drop_constraint("refresh_sessions_organization_id_fkey", "refresh_sessions", type_="foreignkey")
    op.drop_index("ix_audit_events_organization_created", table_name="audit_events")
    op.drop_column("refresh_sessions", "organization_id")
    op.drop_column("audit_events", "organization_id")
    op.drop_table("memberships")
    op.drop_table("organizations")


def downgrade():
    connection = op.get_bind()
    args = context.get_x_argument(as_dictionary=True)
    if os.environ.get("APP_ENV") != "test" and args.get("organization_rollback_approved") != "yes":
        raise retirement.RetirementBlocked("Separate coordinated rollback approval is required.")
    connection.execute(sa.text("""
      LOCK TABLE users, auth_sessions, refresh_sessions, audit_events
      IN ACCESS EXCLUSIVE MODE NOWAIT
    """))
    # There is deliberately no archive/receipt table in the app DB. Even an
    # empty retained schema cannot prove the retired tables were empty (an
    # organization can have no members). Always require original recovery.
    backup = retirement.evidence(connection, args, restoring=True, populated=True)
    op.create_table("organizations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_table("memberships",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("organization_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "organization_id"),
        sa.CheckConstraint("role IN ('owner','admin','viewer')", name="ck_membership_role"))
    op.create_index("ix_memberships_user_id", "memberships", ["user_id"])
    op.create_index("ix_memberships_organization_id", "memberships", ["organization_id"])
    op.add_column("refresh_sessions", sa.Column("organization_id", UUID(as_uuid=True),
                                               sa.ForeignKey("organizations.id"), nullable=True))
    op.add_column("audit_events", sa.Column("organization_id", UUID(as_uuid=True), nullable=True))
    op.create_index("ix_audit_events_organization_created", "audit_events", ["organization_id", "created_at"])
    if backup is not None:
        for table in retirement.TABLES:
            target = sa.Table(table, sa.MetaData(), autoload_with=connection)
            for row in backup[table]:
                values = {k: uuid.UUID(v) if k.endswith("_id") or k == "id" else v for k, v in row.items()}
                connection.execute(target.insert().values(**values))
        for table in ("refresh_sessions", "audit_events"):
            for row in backup[table]:
                connection.execute(sa.text(f"UPDATE {table} SET organization_id=:org WHERE id=:id"),
                                   {"org": row["organization_id"], "id": row["id"]})
        if retirement.snapshot(connection) != backup:
            raise retirement.RetirementBlocked("Restored counts/content do not match verified recovery; rollback refused.")
    # Retain the rejection evidence: schema rollback must never revive a
    # previously rejected scope-bearing credential or erase security history.
