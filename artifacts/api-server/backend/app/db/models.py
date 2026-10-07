import secrets
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer, String,
    UniqueConstraint, func, text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Organization(Timestamps, Base):
    __tablename__ = "organizations"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160), nullable=False)


class User(Timestamps, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("system_role IS NULL OR system_role IN ('super_admin', 'mr')", name="ck_users_system_role"),
        CheckConstraint("identity_version >= 0", name="ck_users_identity_version"),
        CheckConstraint(
            "coalesce(system_role = 'super_admin', false) = is_protected_system_admin",
            name="ck_users_protected_super_admin",
        ),
        CheckConstraint(
            "NOT is_protected_system_admin OR (email = 'crm-admin@allergyevexia.in' AND is_active)",
            name="ck_users_protected_super_admin_identity",
        ),
        Index(
            "uq_users_protected_system_admin", "is_protected_system_admin",
            unique=True, postgresql_where=text("is_protected_system_admin"),
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str | None] = mapped_column(String(320), unique=True, index=True, nullable=True)
    username: Mapped[str | None] = mapped_column(String(32), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    token_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Old organization-scoped accounts remain unmapped until an operator explicitly
    # assigns one of the system roles.
    system_role: Mapped[str | None] = mapped_column(String(20))
    identity_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_protected_system_admin: Mapped[bool] = mapped_column(default=False, nullable=False)


class Membership(Timestamps, Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("user_id", "organization_id"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    __table_args__ = (
        UniqueConstraint("family_id", name="uq_auth_sessions_family"),
        UniqueConstraint("id", "user_id", name="uq_auth_sessions_id_user"),
        CheckConstraint("status IN ('ACTIVE', 'EXPIRED', 'REVOKED')", name="ck_auth_sessions_status"),
        CheckConstraint("token_version >= 0", name="ck_auth_sessions_token_version"),
        CheckConstraint("identity_version >= 0", name="ck_auth_sessions_identity_version"),
        CheckConstraint("expires_at > created_at", name="ck_auth_sessions_expiry"),
        CheckConstraint(
            "(status = 'REVOKED' AND revoked_at IS NOT NULL) OR "
            "(status <> 'REVOKED' AND revoked_at IS NULL)",
            name="ck_auth_sessions_revoked_timestamp",
        ),
        CheckConstraint(
            "last_refreshed_at IS NULL OR last_refreshed_at >= created_at",
            name="ck_auth_sessions_refresh_timestamp",
        ),
        Index("ix_auth_sessions_user_created", "user_id", "created_at"),
        Index("ix_auth_sessions_user_status", "user_id", "status"),
        Index("ix_auth_sessions_created_id", "created_at", "id"),
        Index("ix_auth_sessions_user_created_id", "user_id", "created_at", "id"),
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: secrets.token_urlsafe(32))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    family_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), default=uuid.uuid4, nullable=False)
    status: Mapped[str] = mapped_column(String(8), default="ACTIVE", nullable=False)
    token_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    identity_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_refreshed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    persistent: Mapped[bool] = mapped_column(default=False, nullable=False)


class RefreshSession(Base):
    __tablename__ = "refresh_sessions"
    __table_args__ = (
        Index("ix_refresh_sessions_user", "user_id", "revoked_at"),
        Index("ix_refresh_sessions_session", "session_id"),
        Index("ix_refresh_sessions_replaced_by", "replaced_by_id"),
        ForeignKeyConstraint(
            ["session_id", "user_id"], ["auth_sessions.id", "auth_sessions.user_id"],
            name="fk_refresh_sessions_session_owner",
        ),
        CheckConstraint("identity_version >= 0", name="ck_refresh_sessions_identity_version"),
        CheckConstraint("family_expires_at >= expires_at", name="ck_refresh_family_expiry"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    session_id: Mapped[str] = mapped_column(String(64), nullable=False)
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("refresh_sessions.id"))
    # Kept only as legacy history. New identity sessions are not organization-scoped.
    organization_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("organizations.id"))
    identity_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    family_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    family_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    persistent: Mapped[bool] = mapped_column(default=False, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    identifier_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    organization_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    resource_type: Mapped[str | None] = mapped_column(String(60))
    resource_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    request_id: Mapped[str | None] = mapped_column(String(64))
    session_id: Mapped[str | None] = mapped_column(ForeignKey("auth_sessions.id"))
    reason: Mapped[str | None] = mapped_column(String(40))
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        Index("ix_audit_events_organization_created", "organization_id", "created_at"),
        Index("ix_audit_events_session_created", "session_id", "created_at"),
        Index("ix_audit_events_created_id", "created_at", "id"),
        Index("ix_audit_events_actor_created_id", "actor_id", "created_at", "id"),
        Index("ix_audit_events_action_created_id", "action", "created_at", "id"),
        Index("ix_audit_events_resource_created_id", "resource_type", "created_at", "id"),
        # The function-backed GIN index and expression statistics are managed
        # by Alembic, not create_all (which cannot provision their prerequisites).
    )


class MRProfile(Timestamps, Base):
    __tablename__ = "mr_profiles"
    __table_args__ = (UniqueConstraint("user_id", name="uq_mr_profiles_user"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)


class Patient(Timestamps, Base):
    __tablename__ = "patients"
    __table_args__ = (CheckConstraint("version >= 1", name="ck_patients_version"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    assigned_mr_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mr_profiles.id"), index=True)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
# File metadata is maintained independently from identity/domain models, but its
# tables must be registered before Alembic evaluates Base.metadata.
from app.db import file_models as _file_models  # noqa: E402,F401
from app.db import staff_models as _staff_models  # noqa: E402,F401
from app.db import zone_models as _zone_models  # noqa: E402,F401
from app.db import role_models as _role_models  # noqa: E402,F401
from app.db import courier_models as _courier_models  # noqa: E402,F401
from app.db import location_models as _location_models  # noqa: E402,F401
