import uuid
from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps


class CommunicationChannel(Base):
    __tablename__ = "communication_channels"
    channel: Mapped[str] = mapped_column(String(8), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    __table_args__ = (
        CheckConstraint("channel IN ('email','sms','waba')", name="ck_comm_channel"),
        CheckConstraint("version >= 1", name="ck_comm_channel_version"),
    )


class CommunicationConfiguration(Timestamps, Base):
    __tablename__ = "communication_configurations"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    channel: Mapped[str] = mapped_column(ForeignKey("communication_channels.channel"), nullable=False)
    type: Mapped[str] = mapped_column(String(8), nullable=False)
    is_default: Mapped[bool] = mapped_column(nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    payload_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    secret_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_comm_version"),
        CheckConstraint("(channel = 'email' AND type IN ('smtp','api','platform')) OR (channel IN ('sms','waba') AND type = 'api')", name="ck_comm_type"),
        CheckConstraint("payload_ciphertext LIKE 'v1:%' AND secret_ciphertext LIKE 'v1:%'", name="ck_comm_encrypted"),
        Index("uq_comm_default", "channel", unique=True, postgresql_where=text("is_default")),
    )
