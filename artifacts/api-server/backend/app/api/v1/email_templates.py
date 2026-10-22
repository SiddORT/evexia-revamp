from uuid import UUID
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from app.api.deps import require_permissions, require_cookie_origin
from app.core.config import get_settings, Settings
from app.db.session import get_db
from app.schemas.email_templates import EmailTemplateCreate, EmailTemplateEdit, EmailTemplateVersion, EmailTemplateRecord, EmailTemplateList, EmailTemplateEvent
from app.services.auth import Identity
from app.services.email_templates import operation, EVENTS
from app.schemas.email_templates import EmailTemplateTest, EmailModernLayout
from app.schemas.email_delivery import InvitationResult

router = APIRouter(prefix="/admin/email-templates", tags=["email-templates"])
manager = require_permissions("admin.access")


def no_store(response: Response):
    response.headers["Cache-Control"] = "no-store"


router.dependencies.append(Depends(no_store))


@router.get("/events", response_model=list[EmailTemplateEvent], operation_id="listEmailTemplateEvents")
def events(actor: Identity = Depends(manager)):
    return EVENTS


@router.get("", response_model=EmailTemplateList, operation_id="listEmailTemplates")
def listing(actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return operation(db, actor)


@router.get("/{template_id}", response_model=EmailTemplateRecord, operation_id="getEmailTemplate")
def detail(template_id: UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return operation(db, actor, row_id=template_id)


@router.post("", response_model=EmailTemplateList, status_code=201, operation_id="createEmailTemplate")
def create(body: EmailTemplateCreate, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return operation(db, actor, body=body, action="create")


@router.post("/{template_id}/edit", response_model=EmailTemplateList, operation_id="editEmailTemplate")
def edit(template_id: UUID, body: EmailTemplateEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return operation(db, actor, body=body, row_id=template_id, action="edit")


@router.post("/{template_id}/delete", response_model=EmailTemplateList, operation_id="deleteEmailTemplate")
def delete(template_id: UUID, body: EmailTemplateVersion, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return operation(db, actor, body=body, row_id=template_id, action="delete")


@router.get("/{template_id}/modern-layout", response_model=EmailModernLayout, operation_id="getEmailModernLayout")
def modern_layout(template_id: UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    from app.services.modern_email import modern_html
    row = operation(db, actor, row_id=template_id)
    return dict(html=modern_html(row["event_key"]))


@router.post("/{template_id}/test", response_model=InvitationResult, operation_id="sendEmailTemplateTest",
             dependencies=[Depends(require_cookie_origin)])
def test_send(template_id: UUID, body: EmailTemplateTest, actor: Identity = Depends(manager),
              db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    from app.services.email_template_tests import send_test
    return send_test(db, actor, settings, template_id, body)
