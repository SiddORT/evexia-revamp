"""Non-personal shared business configuration; never consumed by orders."""
from datetime import date
from decimal import Decimal
from sqlalchemy import CheckConstraint, Date, Integer, Numeric
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class GSTSettings(Base):
    __tablename__ = "gst_settings"
    __table_args__ = (
        CheckConstraint("id = 1 AND version >= 1", name="ck_gst_settings_singleton"),
        # Unconstrained NUMERIC rejects excess precision instead of rounding it
        # before the CHECK (as NUMERIC(5,2) would).
        CheckConstraint("before_rate BETWEEN 0 AND 100 AND before_rate = trunc(before_rate, 2)",
                        name="ck_gst_before_rate"),
        CheckConstraint("on_after_rate BETWEEN 0 AND 100 AND on_after_rate = trunc(on_after_rate, 2)",
                        name="ck_gst_on_after_rate"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[int] = mapped_column(Integer)
    cutoff_date: Mapped[date] = mapped_column(Date)
    before_rate: Mapped[Decimal] = mapped_column(Numeric())
    on_after_rate: Mapped[Decimal] = mapped_column(Numeric())
