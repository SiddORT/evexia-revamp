import json
import uuid
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from app.db.communication_models import CommunicationChannel, CommunicationConfiguration
from app.db.models import AuditEvent
from app.services.auth import revalidate_identity
from app.services.communication_crypto import CommunicationCrypto, CommunicationError
from app.schemas.communication import CommunicationInput, CommunicationSnapshot


def reject(message, code="communication_stale", status=409):
    raise CommunicationError(message, status, code)


def authorize(db, actor):
    current = revalidate_identity(db, actor, lock=True)
    if current.role != "super_admin" or "admin.access" not in current.permissions:
        reject("Only Super Admin can manage Communication.", "access_denied", 403)
    return current


def locked_channels(db):
    # Stable, pre-seeded rows serialize first-create, defaults and last-delete.
    # Lock all three in order so a returned bounded snapshot is consistent.
    rows = list(db.scalars(select(CommunicationChannel).order_by(CommunicationChannel.channel)
                           .execution_options(populate_existing=True).with_for_update()))
    if [r.channel for r in rows] != ["email", "sms", "waba"]:
        raise CommunicationError()
    return {r.channel: r for r in rows}


def snapshot(db, channels, crypto):
    result = {c: {"version": r.version, "defaultId": None, "configurations": []} for c, r in channels.items()}
    rows = list(db.scalars(select(CommunicationConfiguration).order_by(CommunicationConfiguration.id).limit(301)
                           .execution_options(populate_existing=True)))
    if len(rows) > 300:
        raise CommunicationError()
    for row in rows:
        try:
            values = json.loads(crypto.decrypt(row, "payload", row.payload_ciphertext))
            secret = crypto.decrypt(row, "secret", row.secret_ciphertext)
            # Fail closed for unreadable/malformed stored data, even on writes.
            CommunicationInput(channel=row.channel, type=row.type, channelVersion=1, values=values, secret=secret)
        except Exception:
            raise CommunicationError() from None
        state = result[row.channel]
        if row.is_default:
            if state["defaultId"] is not None:
                raise CommunicationError()
            state["defaultId"] = str(row.id)
        state["configurations"].append(dict(id=str(row.id), type=row.type, version=row.version,
                                            values=values, credentialPresent=True))
    for state in result.values():
        if bool(state["configurations"]) != bool(state["defaultId"]) or len(state["configurations"]) > 100:
            raise CommunicationError()
    return CommunicationSnapshot(channels=result).model_dump()


def operation(db, actor, settings, body=None, row_id=None, action=None):
    try:
        current = authorize(db, actor)
        channels = locked_channels(db)
        crypto = CommunicationCrypto(settings)
        before = snapshot(db, channels, crypto)
        if action is None:
            db.commit()
            return before
        row = db.get(CommunicationConfiguration, row_id) if row_id else None
        if row_id and not row:
            reject("This configuration was removed. Reload and review.")
        channel = row.channel if row else body.channel
        state = channels[channel]
        if body.channelVersion != state.version or (row and body.version != row.version):
            reject("Communication changed. Your draft is kept. Reload and review before retrying.")
        if action in ("create", "edit"):
            if row and body.channel != row.channel:
                reject("Channel cannot change. Create a separate configuration.", "communication_invalid", 422)
            records = before["channels"][channel]["configurations"]
            if any(r["id"] != str(row_id) and r["values"]["name"].casefold() == body.values["name"].casefold() for r in records):
                reject("Use a unique configuration name within this channel.", "communication_duplicate")
            if not row and len(records) >= 100:
                reject("This channel supports at most 100 configurations.", "communication_limit", 422)
            secret = body.secret.get_secret_value() if body.secret else None
            if not secret and (not row or body.type != row.type):
                reject("Enter a credential for this configuration type.", "communication_credential_required", 422)
            if row:
                secret = secret or crypto.decrypt(row, "secret", row.secret_ciphertext)
                row.type = body.type
                row.version += 1
                row.updated_by = current.user.id
            else:
                row = CommunicationConfiguration(id=uuid.uuid4(), channel=channel, type=body.type,
                    is_default=not records, version=1, created_by=current.user.id, updated_by=current.user.id)
                db.add(row)
            row.payload_ciphertext = crypto.encrypt(row, "payload", json.dumps(body.values, separators=(",", ":")))
            row.secret_ciphertext = crypto.encrypt(row, "secret", secret)
        elif action in ("default", "delete"):
            others = list(db.scalars(select(CommunicationConfiguration).where(
                CommunicationConfiguration.channel == channel, CommunicationConfiguration.id != row.id)))
            if action == "delete" and row.is_default and others:
                replacement = next((r for r in others if str(r.id) == body.replacementId), None)
                if not replacement:
                    reject("Choose a same-channel replacement default.", "communication_replacement", 422)
            else:
                replacement = row if action == "default" else None
            if replacement:
                for candidate in [row, *others]:
                    if candidate.is_default and candidate.id != replacement.id:
                        candidate.is_default = False
                        candidate.version += 1
                        candidate.updated_by = current.user.id
                db.flush()  # release the partial unique index before setting new default
                if not replacement.is_default:
                    replacement.is_default = True
                    replacement.version += 1
                    replacement.updated_by = current.user.id
            if action == "delete":
                db.delete(row)
        else:
            raise CommunicationError()
        state.version += 1
        db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id, action=f"communication_{action}",
                         resource_type="communication", resource_id=row.id, outcome="success",
                         request_id=db.info.get("request_id")))
        db.flush()
        result = snapshot(db, channels, crypto)
        db.commit()
        return result
    except SQLAlchemyError:
        db.rollback()
        raise CommunicationError() from None
    except Exception:
        db.rollback()
        raise
