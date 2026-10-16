from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.core.config import get_settings, Settings
from app.db.session import get_db
from app.schemas.communication import CommunicationInput, CommunicationEdit, CommunicationVersion, CommunicationDelete, CommunicationSnapshot, CommunicationRecord
from app.services.auth import Identity
from app.services.communication import operation, reject

router = APIRouter(prefix="/admin/communication", tags=["communication"])
manager = require_permissions("admin.access")


@router.get("", response_model=CommunicationSnapshot, operation_id="listCommunicationConfigurations")
def listing(actor: Identity = Depends(manager), db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return operation(db, actor, settings)


@router.get("/{configuration_id}", response_model=CommunicationRecord, operation_id="getCommunicationConfiguration")
def detail(configuration_id: UUID, actor: Identity = Depends(manager), db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    result = operation(db, actor, settings)
    for state in result["channels"].values():
        for row in state["configurations"]:
            if row["id"] == str(configuration_id):
                return row
    reject("Configuration no longer exists.", "communication_missing", 404)


@router.post("", response_model=CommunicationSnapshot, status_code=201, operation_id="createCommunicationConfiguration")
def create(body: CommunicationInput, actor: Identity = Depends(manager), db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return operation(db, actor, settings, body, action="create")


@router.post("/{configuration_id}/edit", response_model=CommunicationSnapshot, operation_id="editCommunicationConfiguration")
def edit(configuration_id: UUID, body: CommunicationEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return operation(db, actor, settings, body, configuration_id, "edit")


@router.post("/{configuration_id}/default", response_model=CommunicationSnapshot, operation_id="defaultCommunicationConfiguration")
def default(configuration_id: UUID, body: CommunicationVersion, actor: Identity = Depends(manager), db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return operation(db, actor, settings, body, configuration_id, "default")


@router.post("/{configuration_id}/delete", response_model=CommunicationSnapshot, operation_id="deleteCommunicationConfiguration")
def delete(configuration_id: UUID, body: CommunicationDelete, actor: Identity = Depends(manager), db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    return operation(db, actor, settings, body, configuration_id, "delete")
