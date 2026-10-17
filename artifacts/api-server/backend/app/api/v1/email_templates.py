from uuid import UUID
from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.db.session import get_db
from app.schemas.email_templates import EmailTemplateCreate, EmailTemplateEdit, EmailTemplateVersion, EmailTemplateRecord, EmailTemplateList, EmailTemplateEvent
from app.services.auth import Identity
from app.services.email_templates import operation, EVENTS

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
