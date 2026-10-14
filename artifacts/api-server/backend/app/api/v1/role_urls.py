import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, Response, Request
from sqlalchemy import select, text, func
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session
from app.api.deps import require_permissions
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.db.role_url_models import RoleHostname
from app.db.domain_models import DomainPolicy
from app.core.config import get_settings
from app.services import domain_policy as policy
from app.db.session import get_db
from app.schemas.role_urls import (
    RoleUrlFields, RoleUrlEdit, RoleUrlVersion, RoleUrlResponse, RoleUrlPage,
    PortalResolution, canonical_hostname,
    DomainResponse, DomainAction, PrimaryDomainFields,
)
from app.services.auth import Identity, revalidate_identity

router = APIRouter(tags=["portal hostnames"])
manager = require_permissions("admin.access")


def authorize(db, actor):
    current = revalidate_identity(db, actor, lock=True)
    if current.role != "super_admin" or "admin.access" not in current.permissions:
        raise HTTPException(403, "Access denied")
    return current


@router.get("/portal/resolve", response_model=PortalResolution, operation_id="resolvePortalHostname")
def resolve(request: Request, response: Response, hostname: str = Query(max_length=253), db: Session = Depends(get_db)):
    # Browser supplies location.hostname; proxy headers never decide identity or routing.
    response.headers["Cache-Control"] = "no-store"
    try:
        host = canonical_hostname(hostname)
        if "://" in hostname:
            raise ValueError()
    except ValueError:
        # Local preview hosts are explicitly unmapped, never configurable.
        if (get_settings().app_env != "production" and
                hostname in ("localhost", "127.0.0.1", "::1") and
                hostname == request.state.accepted_hostname):
            return {"role": None}
        raise HTTPException(422, "Invalid current hostname") from None
    try:
        settings = get_settings()
        accepted = request.state.accepted_hostname
        db.execute(select(DomainPolicy.hostname).limit(0))
        if settings.app_env == "production":
            if host != accepted:
                raise HTTPException(421, "Current hostname does not match request")
            return {"role": policy.admitted(db, host, settings.bootstrap_hosts)}
        # Development permits ordinary path entry, never privileged mapping
        # selected by a query for a different host.
        if host != accepted:
            raise HTTPException(421, "Current hostname does not match request")
        try:
            return {"role": policy.admitted(db, host, settings.bootstrap_hosts)}
        except PermissionError:
            if db.get(DomainPolicy, host) or db.scalar(select(RoleHostname.id).where(RoleHostname.hostname == host)):
                raise HTTPException(421, "Hostname requires verification and activation") from None
            return {"role": None}
    except PermissionError:
        raise HTTPException(421, "Hostname is not admitted") from None
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(503, "Portal resolution unavailable") from None


@router.get("/admin/role-urls", response_model=RoleUrlPage, operation_id="listRoleHostnames")
def listing(response: Response, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    try:
        authorize(db, actor)
        result = {"items": [RoleUrlResponse.model_validate(r) for r in db.scalars(select(RoleHostname).order_by(RoleHostname.hostname))],
                  "domains": [policy.public(r) for r in db.scalars(select(DomainPolicy).order_by(DomainPolicy.hostname))],
                  "bootstrap_hosts": list(get_settings().bootstrap_hosts)}
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(503, "Role URL service unavailable") from None


def mutate(db, actor, body, row_id=None, deleting=False):
    try:
        current = authorize(db, actor)
        domain_lock(db)
        if row_id:
            row = db.scalar(select(RoleHostname).where(RoleHostname.id == row_id).execution_options(populate_existing=True).with_for_update())
            if not row:
                raise HTTPException(409, "Mapping was removed; reload and review")
            if row.version != body.version:
                raise HTTPException(409, "Mapping changed; reload and review")
            row.version += 1
            row.updated_at, row.updated_by = utcnow(), current.user.id
            if not deleting:
                if row.hostname != body.hostname or row.role != body.role or row.enabled != body.enabled:
                    old = db.get(DomainPolicy, row.hostname)
                    if old and old.kind == "role":
                        db.delete(old)
                row.hostname, row.role, row.enabled = body.hostname, body.role, body.enabled
        else:
            row = RoleHostname(**body.model_dump(), created_by=current.user.id, updated_by=current.user.id)
            db.add(row)
        if not deleting:
            primary = db.scalar(select(DomainPolicy).where(DomainPolicy.kind == "primary", DomainPolicy.hostname == row.hostname))
            if primary and row.enabled:
                raise HTTPException(409, "Primary domain cannot have an enabled role mapping; disable it first")
            if row.hostname in get_settings().bootstrap_hosts:
                raise HTTPException(409, "Recovery hosts cannot be assigned a role")
        db.flush()
        result = RoleUrlResponse.model_validate(row)
        db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id,
                         action="role_url_delete" if deleting else "role_url_update" if row_id else "role_url_create",
                         resource_type="role_hostname", resource_id=row.id, outcome="success",
                         request_id=db.info.get("request_id")))
        if deleting:
            old = db.get(DomainPolicy, row.hostname)
            if old and old.kind == "role":
                db.delete(old)
            db.delete(row)
        db.commit()
        return result
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Hostname already assigned; reload and review") from None
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(503, "Save outcome unconfirmed; reload before retrying") from None
    except Exception:
        db.rollback()
        raise


@router.post("/admin/role-urls", response_model=RoleUrlResponse, status_code=201, operation_id="createRoleHostname")
def create(body: RoleUrlFields, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return mutate(db, actor, body)


@router.post("/admin/role-urls/{row_id}/edit", response_model=RoleUrlResponse, operation_id="editRoleHostname")
def edit(row_id: uuid.UUID, body: RoleUrlEdit, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return mutate(db, actor, body, row_id)


@router.post("/admin/role-urls/{row_id}/delete", response_model=RoleUrlResponse, operation_id="deleteRoleHostname")
def remove(row_id: uuid.UUID, body: RoleUrlVersion, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    return mutate(db, actor, body, row_id, deleting=True)


def domain_lock(db):
    # One short transaction lock covers primary/role cross-table conflicts.
    db.execute(text("SELECT pg_advisory_xact_lock(3940037)"))


def audit_domain(db, actor, action, row):
    # Never log hostname TXT tokens or DNS response payloads.
    db.add(AuditEvent(actor_id=actor.user.id, session_id=actor.session_id,
                     action="domain_" + action, resource_type="domain_policy",
                     resource_id=row.id,
                     outcome="failure" if action == "verify" and row.status != "verified" else "success",
                     reason=row.status if action == "verify" else None,
                     request_id=db.info.get("request_id")))


@router.post("/admin/role-urls/primary", response_model=DomainResponse, operation_id="savePrimaryDomain")
def primary(body: PrimaryDomainFields, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    try:
        current = authorize(db, actor)
        domain_lock(db)
        old = db.scalar(select(DomainPolicy).where(DomainPolicy.kind == "primary").with_for_update())
        if (old and (old.version != body.version or old.hostname != body.previous_hostname)) or (not old and (body.version != 0 or body.previous_hostname)):
            raise HTTPException(409, "Primary domain changed; reload and review")
        mapping = db.scalar(select(RoleHostname).where(RoleHostname.hostname == body.hostname, RoleHostname.enabled.is_(True)))
        if mapping:
            raise HTTPException(409, "Disable the conflicting role mapping before configuring the primary domain")
        existing = db.get(DomainPolicy, body.hostname)
        if existing and existing is not old:
            raise HTTPException(409, "Hostname already configured; revoke and remove its role mapping first")
        if old and old.hostname == body.hostname:
            return policy.public(old)
        if old:
            db.delete(old)
            db.flush()
        row = DomainPolicy(hostname=body.hostname, kind="primary", version=(body.version + 1),
                           created_by=current.user.id, updated_by=current.user.id)
        db.add(row)
        db.flush()
        audit_domain(db, current, "primary_replace", row)
        result = policy.public(row)
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(503, "Save outcome unconfirmed; reload before retrying") from None
    except Exception:
        db.rollback()
        raise


@router.post("/admin/role-urls/domain-action", response_model=DomainResponse, operation_id="manageDomainAdmission")
def domain_action(body: DomainAction, actor: Identity = Depends(manager), db: Session = Depends(get_db)):
    from datetime import timedelta
    try:
        current = authorize(db, actor)
        domain_lock(db)
        if body.action in ("challenge", "verify"):
            attempts = db.scalar(select(func.count()).select_from(AuditEvent).where(
                AuditEvent.actor_id == current.user.id,
                AuditEvent.action.in_(("domain_challenge", "domain_verify_start")),
                AuditEvent.created_at > utcnow() - timedelta(minutes=15)))
            if attempts >= 30:
                raise HTTPException(429, "DNS action limit reached; retry in 15 minutes")
        row = db.get(DomainPolicy, body.hostname, populate_existing=True)
        if not row:
            mapping = db.scalar(select(RoleHostname).where(RoleHostname.hostname == body.hostname))
            if not mapping or body.version != 0 or body.action != "challenge":
                raise HTTPException(409, "Configuration changed; reload and review")
            row = DomainPolicy(hostname=body.hostname, kind="role", created_by=current.user.id,
                               updated_by=current.user.id)
            db.add(row)
            db.flush()
        elif row.version != body.version:
            raise HTTPException(409, "Domain state changed; reload and review")
        if body.action in ("challenge", "verify") and row.last_checked_at and row.last_checked_at > utcnow() - timedelta(seconds=30):
            raise HTTPException(429, "Wait 30 seconds before another DNS action")
        if body.action == "challenge":
            if len(f"_evexia-verification.{body.hostname}") > 253:
                raise HTTPException(422, "Hostname is too long for the exact DNS TXT challenge name")
            policy.rotate(row)
            row.last_checked_at = utcnow()
        elif body.action == "verify":
            if not row.challenge or not row.challenge_expires_at or row.challenge_expires_at <= utcnow():
                raise HTTPException(409, "Challenge missing or expired; create a new challenge")
            row.last_checked_at = utcnow()
            row.version += 1
            version, challenge = row.version, row.challenge
            audit_domain(db, current, "verify_start", row)
            db.commit()  # No database/user locks held over network I/O.
            try:
                values = policy.lookup_txt(f"_evexia-verification.{body.hostname}")
                status = "verified" if challenge in values else "failed"
            except Exception:
                status = "unavailable"
            current = authorize(db, actor)
            domain_lock(db)
            row = db.get(DomainPolicy, body.hostname, populate_existing=True)
            if not row or row.version != version or row.challenge != challenge or row.challenge_expires_at <= utcnow():
                raise HTTPException(409, "Domain changed during DNS lookup; reload and review")
            row.status = status
            row.active = False
            row.verified_at = utcnow() if status == "verified" else None
            row.verification_expires_at = utcnow() + timedelta(days=30) if status == "verified" else None
        elif body.action == "activate":
            if row.status != "verified" or not row.verification_expires_at or row.verification_expires_at <= utcnow():
                raise HTTPException(409, "Fresh DNS ownership verification required before activation")
            mapping = db.scalar(select(RoleHostname).where(RoleHostname.hostname == row.hostname))
            if row.kind == "role" and (not mapping or not mapping.enabled):
                raise HTTPException(409, "Enable the role mapping before activation")
            if row.kind == "role" and row.hostname in get_settings().bootstrap_hosts:
                raise HTTPException(409, "Recovery hosts cannot assign a role")
            row.active = True
        else:
            row.active = False
            row.status = "revoked"
            row.challenge = row.challenge_expires_at = None
            row.verified_at = row.verification_expires_at = None
        row.version += 1
        row.updated_by, row.updated_at = current.user.id, utcnow()
        audit_domain(db, current, body.action, row)
        result = policy.public(row)
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(503, "Outcome unconfirmed; reload before retrying") from None
    except Exception:
        db.rollback()
        raise
