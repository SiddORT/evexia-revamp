"""Bind refresh credential history to stable, revoked legacy sessions.

Revision ID: 0006_auth_sessions
Revises: 0005_protected_admin
"""
import secrets

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "0006_auth_sessions"
down_revision = "0005_protected_admin"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    inconsistent_family = connection.execute(sa.text("""
        SELECT family_id
        FROM refresh_sessions
        GROUP BY family_id
        HAVING count(DISTINCT user_id) <> 1
        LIMIT 1
    """)).scalar_one_or_none()
    if inconsistent_family is not None:
        raise RuntimeError(
            "Migration 0006 found a refresh family with inconsistent user ownership; "
            "review and repair the family before retrying."
        )

    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("family_id", UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("token_version", sa.Integer(), nullable=False),
        sa.Column("identity_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_refreshed_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column("persistent", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("family_id", name="uq_auth_sessions_family"),
        sa.UniqueConstraint("id", "user_id", name="uq_auth_sessions_id_user"),
        sa.CheckConstraint("status IN ('ACTIVE', 'EXPIRED', 'REVOKED')", name="ck_auth_sessions_status"),
        sa.CheckConstraint("token_version >= 0", name="ck_auth_sessions_token_version"),
        sa.CheckConstraint("identity_version >= 0", name="ck_auth_sessions_identity_version"),
        sa.CheckConstraint("expires_at > created_at", name="ck_auth_sessions_expiry"),
        sa.CheckConstraint(
            "(status = 'REVOKED' AND revoked_at IS NOT NULL) OR "
            "(status <> 'REVOKED' AND revoked_at IS NULL)",
            name="ck_auth_sessions_revoked_timestamp",
        ),
        sa.CheckConstraint(
            "last_refreshed_at IS NULL OR last_refreshed_at >= created_at",
            name="ck_auth_sessions_refresh_timestamp",
        ),
    )
    op.create_index("ix_auth_sessions_user_created", "auth_sessions", ["user_id", "created_at"])
    op.create_index("ix_auth_sessions_user_status", "auth_sessions", ["user_id", "status"])

    op.add_column("refresh_sessions", sa.Column("session_id", sa.String(64), nullable=True))
    op.add_column("refresh_sessions", sa.Column("consumed_at", sa.DateTime(timezone=True)))
    op.add_column("refresh_sessions", sa.Column("replaced_by_id", UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_refresh_sessions_replaced_by_id_refresh_sessions",
        "refresh_sessions", "refresh_sessions", ["replaced_by_id"], ["id"],
    )
    op.create_index("ix_refresh_sessions_replaced_by", "refresh_sessions", ["replaced_by_id"])

    # Existing family and token history is retained, but legacy credentials cannot
    # remain usable because no access token issued before this migration is session-bound.
    families = connection.execute(sa.text("""
        SELECT rs.family_id, rs.user_id, min(rs.created_at) AS created_at,
               max(rs.family_expires_at) AS expires_at,
               max(rs.created_at) AS last_refreshed_at,
               bool_or(rs.persistent) AS persistent,
               u.token_version, u.identity_version
        FROM refresh_sessions AS rs
        JOIN users AS u ON u.id = rs.user_id
        GROUP BY rs.family_id, rs.user_id, u.token_version, u.identity_version
        ORDER BY rs.family_id
    """)).mappings().all()
    for family in families:
        session_id = secrets.token_urlsafe(32)
        connection.execute(sa.text("""
            INSERT INTO auth_sessions
                (id, user_id, family_id, status, token_version, identity_version,
                 created_at, expires_at, last_refreshed_at, revoked_at, persistent)
            VALUES
                (:id, :user_id, :family_id, 'REVOKED', :token_version, :identity_version,
                 :created_at, :expires_at, :last_refreshed_at, CURRENT_TIMESTAMP, :persistent)
        """), {
            "id": session_id,
            "user_id": family["user_id"],
            "family_id": family["family_id"],
            "token_version": family["token_version"],
            "identity_version": family["identity_version"],
            "created_at": family["created_at"],
            "expires_at": family["expires_at"],
            "last_refreshed_at": family["last_refreshed_at"],
            "persistent": family["persistent"],
        })
        connection.execute(sa.text(
            "UPDATE refresh_sessions SET session_id = :session_id WHERE family_id = :family_id"
        ), {"session_id": session_id, "family_id": family["family_id"]})

    op.alter_column("refresh_sessions", "session_id", nullable=False)
    op.create_foreign_key(
        "fk_refresh_sessions_session_owner",
        "refresh_sessions", "auth_sessions",
        ["session_id", "user_id"], ["id", "user_id"],
    )
    op.create_index("ix_refresh_sessions_session", "refresh_sessions", ["session_id"])
    connection.execute(sa.text(
        "UPDATE refresh_sessions SET revoked_at = coalesce(revoked_at, CURRENT_TIMESTAMP)"
    ))

    op.add_column("audit_events", sa.Column("session_id", sa.String(64), nullable=True))
    op.add_column("audit_events", sa.Column("reason", sa.String(40), nullable=True))
    op.create_foreign_key(
        "fk_audit_events_session_id_auth_sessions",
        "audit_events", "auth_sessions", ["session_id"], ["id"],
    )
    op.create_index("ix_audit_events_session_created", "audit_events", ["session_id", "created_at"])


def downgrade():
    connection = op.get_bind()
    has_session_history = connection.execute(sa.text(
        "SELECT EXISTS (SELECT 1 FROM auth_sessions) "
        "OR EXISTS (SELECT 1 FROM audit_events WHERE session_id IS NOT NULL)"
    )).scalar_one()
    if has_session_history:
        raise RuntimeError(
            "Cannot downgrade migration 0006 while session history exists; "
            "use a reviewed forward migration to preserve lifecycle evidence."
        )

    op.drop_index("ix_audit_events_session_created", table_name="audit_events")
    op.drop_constraint("fk_audit_events_session_id_auth_sessions", "audit_events", type_="foreignkey")
    op.drop_column("audit_events", "reason")
    op.drop_column("audit_events", "session_id")

    op.drop_index("ix_refresh_sessions_session", table_name="refresh_sessions")
    op.drop_constraint("fk_refresh_sessions_session_owner", "refresh_sessions", type_="foreignkey")
    op.drop_index("ix_refresh_sessions_replaced_by", table_name="refresh_sessions")
    op.drop_constraint(
        "fk_refresh_sessions_replaced_by_id_refresh_sessions", "refresh_sessions", type_="foreignkey",
    )
    op.drop_column("refresh_sessions", "replaced_by_id")
    op.drop_column("refresh_sessions", "consumed_at")
    op.drop_column("refresh_sessions", "session_id")

    op.drop_index("ix_auth_sessions_user_status", table_name="auth_sessions")
    op.drop_index("ix_auth_sessions_user_created", table_name="auth_sessions")
    op.drop_table("auth_sessions")