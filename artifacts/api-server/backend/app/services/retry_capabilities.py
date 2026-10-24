"""Bind new durable responses to their originating operation, not any write grant."""
from app.services.capability_policy import allowed, is_super_admin
from app.services.purchase_received_crypto import PRError


def envelope(resource, action, result):
    return {"authorization": f"{resource}.{action}" if action else "protected", "result": result}


def result(actor, resource, payload):
    if payload is None:
        return None
    wrapped = isinstance(payload, dict) and set(payload) == {"authorization", "result"}
    required = payload["authorization"] if wrapped else "protected"
    if not is_super_admin(actor):
        if not isinstance(required, str) or not required.startswith(resource + "."):
            raise PRError("This retained retry is protected; no result was released.", 403, "access_denied")
        action = required[len(resource) + 1:]
        if not allowed(actor, resource, action):
            raise PRError("The original operation's permission is required to reconcile this retry.", 403, "access_denied")
    return payload["result"] if wrapped else payload
