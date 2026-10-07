import uuid

from sqlalchemy import CheckConstraint, Computed, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models import Timestamps


class CustomRole(Timestamps, Base):
    """Business metadata only: deliberately no identity or permission links."""
    __tablename__ = "custom_roles"
    __table_args__ = (
        UniqueConstraint("normalized_name", name="uq_custom_roles_name"),
        CheckConstraint("length(btrim(name)) BETWEEN 1 AND 100", name="ck_custom_roles_name"),
        CheckConstraint("length(description) <= 1000", name="ck_custom_roles_description"),
        CheckConstraint("version >= 1", name="ck_custom_roles_version"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(100), Computed("lower(btrim(name))", persisted=True))
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
