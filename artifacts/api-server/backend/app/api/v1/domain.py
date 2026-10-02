import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import require_permissions
from app.db.session import get_db
from app.schemas.domain import (
    AssignPatientRequest, CreatePatientRequest, DomainError, MRResponse, PatientResponse,
    ProvisionMRRequest,
)
from app.services.auth import Identity
from app.services import domain as service

router = APIRouter(prefix="/domain", tags=["domain administration"])
super_admin = require_permissions("domain.provision")
assignment_admin = require_permissions("domain.assign_patient")


def _raise_domain_error(error: DomainError) -> None:
    raise HTTPException(status_code=error.status_code, detail=error.message) from None


@router.post("/mrs", response_model=MRResponse, status_code=status.HTTP_201_CREATED)
def provision_mr(
    body: ProvisionMRRequest,
    actor: Identity = Depends(super_admin),
    db: Session = Depends(get_db),
):
    try:
        return service.provision_mr(db, actor, str(body.email), body.username, body.password)
    except DomainError as error:
        _raise_domain_error(error)


@router.post("/mrs/{user_id}/mapping", response_model=MRResponse)
def map_existing_user_to_mr(
    user_id: uuid.UUID,
    actor: Identity = Depends(super_admin),
    db: Session = Depends(get_db),
):
    try:
        return service.map_existing_user_to_mr(db, actor, user_id)
    except DomainError as error:
        _raise_domain_error(error)


@router.post("/patients", response_model=PatientResponse, status_code=status.HTTP_201_CREATED)
def create_patient(
    body: CreatePatientRequest,
    actor: Identity = Depends(super_admin),
    db: Session = Depends(get_db),
):
    try:
        return service.create_patient(db, actor, body.assigned_mr_id)
    except DomainError as error:
        _raise_domain_error(error)


@router.post("/patients/{patient_id}/assignment", response_model=PatientResponse)
def assign_patient(
    patient_id: uuid.UUID,
    body: AssignPatientRequest,
    actor: Identity = Depends(assignment_admin),
    db: Session = Depends(get_db),
):
    try:
        return service.assign_patient(db, actor, patient_id, body.assigned_mr_id)
    except DomainError as error:
        _raise_domain_error(error)