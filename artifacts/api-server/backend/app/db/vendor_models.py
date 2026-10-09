import uuid
from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps
from app.schemas.vendor_phone import VENDOR_COUNTRIES

COUNTRY_SQL = ",".join(f"'{country}'" for country in VENDOR_COUNTRIES)

LENGTHS = {"vendorName": 200, "gstNo": 15, "registeredAddress": 2000,
           "contactPersonName": 200, "emailId": 320, "phoneNo": 15, "dialCountry": 2}
CONSTRAINTS = (
    CheckConstraint("version >= 1", name="ck_vendor_version"),
    CheckConstraint("status IN ('active', 'inactive')", name="ck_vendor_status"),
    CheckConstraint("(deleted_at IS NULL) = (deleted_by IS NULL)", name="ck_vendor_deletion"),
    *(CheckConstraint(f'length("{field}") BETWEEN 1 AND {length} AND "{field}" = btrim("{field}")',
                      name=f"ck_vendor_{field}_length") for field, length in LENGTHS.items()),
    CheckConstraint('"gstNo" ~ \'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$\'', name="ck_vendor_gst"),
    CheckConstraint(f'"dialCountry" IN ({COUNTRY_SQL})', name="ck_vendor_country"),
    CheckConstraint(
        '("dialCountry" = \'IN\' AND "phoneNo" ~ \'^[6-9][0-9]{9}$\') OR '
        '("dialCountry" IN (\'US\', \'GB\') AND "phoneNo" ~ \'^[0-9]{10}$\') OR '
        '("dialCountry" = \'AE\' AND "phoneNo" ~ \'^[0-9]{9}$\') OR '
        '("dialCountry" NOT IN (\'IN\',\'US\',\'GB\',\'AE\') AND "phoneNo" ~ \'^[0-9]{4,15}$\')', name="ck_vendor_phone"),
)


class Vendor(Timestamps, Base):
    __tablename__ = "vendors"
    __table_args__ = CONSTRAINTS
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    vendorName: Mapped[str] = mapped_column(String(200), nullable=False)
    gstNo: Mapped[str] = mapped_column(String(15), nullable=False)
    registeredAddress: Mapped[str] = mapped_column(String(2000), nullable=False)
    contactPersonName: Mapped[str] = mapped_column(String(200), nullable=False)
    emailId: Mapped[str] = mapped_column(String(320), nullable=False)
    phoneNo: Mapped[str] = mapped_column(String(15), nullable=False)
    dialCountry: Mapped[str] = mapped_column(String(2), nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    updated_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


def normalized_name(column):
    return func.lower(func.btrim(func.regexp_replace(column, r"\s+", " ", "g")))


Index("uq_vendor_live_name", normalized_name(Vendor.vendorName), unique=True,
      postgresql_where=Vendor.deleted_at.is_(None))
Index("uq_vendor_live_gst", Vendor.gstNo, unique=True, postgresql_where=Vendor.deleted_at.is_(None))
Index("ix_vendor_live_created", Vendor.created_at.desc(), Vendor.id.desc(),
      postgresql_where=Vendor.deleted_at.is_(None))
