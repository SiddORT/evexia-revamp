"""Authored email source only: never rendered recovery tokens or recipients."""
import uuid
from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.models import Timestamps

RECOVERY_TEMPLATE_ID = uuid.UUID("e7e80000-0000-4000-8000-000000000001")
RECOVERY_EVENT = "password_recovery"
INVITATION_TEMPLATE_ID = uuid.UUID("e7e80000-0000-4000-8000-000000000002")
INVITATION_EVENT = "account_invitation"
MR_INVITATION_TEMPLATE_ID = uuid.UUID("e7e80000-0000-4000-8000-000000000003")
MR_INVITATION_EVENT = "mr_invitation"
REQUIRED_TEMPLATES = {RECOVERY_TEMPLATE_ID: RECOVERY_EVENT, INVITATION_TEMPLATE_ID: INVITATION_EVENT,
                      MR_INVITATION_TEMPLATE_ID: MR_INVITATION_EVENT}


class EmailTemplate(Timestamps, Base):
    __tablename__ = "email_templates"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    html: Mapped[str] = mapped_column(Text, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    event_key: Mapped[str | None] = mapped_column(String(60), unique=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    provenance: Mapped[str] = mapped_column(String(20), nullable=False)
    __table_args__ = (
        CheckConstraint("version BETWEEN 1 AND 2147483647", name="ck_email_template_version"),
        CheckConstraint("length(trim(name)) BETWEEN 1 AND 100 AND length(description) <= 500 "
                        "AND length(trim(subject)) BETWEEN 1 AND 200 "
                        "AND length(trim(html)) BETWEEN 1 AND 100000 "
                        "AND length(trim(text)) BETWEEN 1 AND 20000", name="ck_email_template_bounds"),
        CheckConstraint("(id = 'e7e80000-0000-4000-8000-000000000001' AND event_key IS NOT NULL AND event_key = 'password_recovery') "
                        "OR (id = 'e7e80000-0000-4000-8000-000000000002' AND event_key IS NOT NULL AND event_key = 'account_invitation') "
                        "OR (id = 'e7e80000-0000-4000-8000-000000000003' AND event_key IS NOT NULL AND event_key = 'mr_invitation') "
                        "OR (id NOT IN ('e7e80000-0000-4000-8000-000000000001','e7e80000-0000-4000-8000-000000000002','e7e80000-0000-4000-8000-000000000003') AND event_key IS NULL)",
                        name="ck_email_template_assignment"),
        CheckConstraint("(provenance = 'migration_seed' AND id = 'e7e80000-0000-4000-8000-000000000001' "
                        "AND created_by IS NULL) OR (provenance = 'migration_seed' AND id = 'e7e80000-0000-4000-8000-000000000002' "
                        "AND created_by IS NULL) OR (provenance = 'migration_seed' AND id = 'e7e80000-0000-4000-8000-000000000003' "
                        "AND created_by IS NULL) OR (provenance = 'administrator' AND created_by IS NOT NULL)",
                        name="ck_email_template_provenance"),
        Index("uq_email_template_name", func.lower(name), unique=True),
    )
