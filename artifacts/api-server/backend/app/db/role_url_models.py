import uuid
from sqlalchemy import CheckConstraint, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps


class RoleHostname(Timestamps, Base):
    __tablename__ = "role_hostnames"
    __table_args__ = (
        CheckConstraint("role IN ('admin', 'mr', 'doctor')", name="ck_role_hostnames_role"),
        CheckConstraint("version >= 1", name="ck_role_hostnames_version"),
        CheckConstraint("hostname = lower(hostname)", name="ck_role_hostnames_canonical"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    hostname: Mapped[str] = mapped_column(String(253), unique=True, nullable=False)
    role: Mapped[str] = mapped_column(String(10), nullable=False)
    enabled: Mapped[bool] = mapped_column(default=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
