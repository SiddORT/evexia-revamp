"""Category-keyed operational configuration; clinical values stay encrypted."""
import uuid
from sqlalchemy import CheckConstraint, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class ImmunotherapyExtractSettings(Base):
    __tablename__ = "immunotherapy_extract_settings"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_imm_extract_version"),
        CheckConstraint("payload_ciphertext LIKE 'v1:%'", name="ck_imm_extract_cipher"),
    )
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_categories.id"), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    payload_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
