"""Exact host admission and bounded, operator-resolver-only TXT checks."""
from datetime import timedelta
import secrets
import dns.resolver
from sqlalchemy import select
from app.core.security import utcnow
from app.db.domain_models import DomainPolicy
from app.db.role_url_models import RoleHostname


def admitted(db, hostname, bootstrap=()):
    # Recovery is only transport admission, never a role assignment.
    if hostname in bootstrap:
        return None
    policy = db.get(DomainPolicy, hostname)
    if (not policy or not policy.active or policy.status != "verified" or not policy.verified_at
            or not policy.verification_expires_at or policy.verification_expires_at <= utcnow()):
        raise PermissionError()
    if policy.kind == "primary":
        return None
    mapping = db.scalar(select(RoleHostname).where(
        RoleHostname.hostname == hostname, RoleHostname.enabled.is_(True)))
    if not mapping:
        raise PermissionError()
    return mapping.role


def public(policy):
    if not policy:
        return None
    now = utcnow()
    status = policy.status
    if policy.verification_expires_at and policy.verification_expires_at <= now:
        status = "expired"
    elif policy.challenge_expires_at and policy.challenge_expires_at <= now and status != "verified":
        status = "expired"
    return dict(hostname=policy.hostname, kind=policy.kind, version=policy.version,
                active=policy.active, status=status, verified_at=policy.verified_at,
                verification_expires_at=policy.verification_expires_at,
                last_checked_at=policy.last_checked_at,
                challenge_name=f"_evexia-verification.{policy.hostname}",
                challenge_value=policy.challenge, challenge_expires_at=policy.challenge_expires_at)


def rotate(policy):
    policy.challenge = "evexia-domain=" + secrets.token_urlsafe(32)
    policy.challenge_expires_at = utcnow() + timedelta(hours=24)
    policy.verified_at = policy.verification_expires_at = None
    policy.active = False
    policy.status = "pending"


def lookup_txt(name):
    # System resolver configuration is operator controlled, never request input.
    resolver = dns.resolver.Resolver()
    resolver.timeout = 1
    resolver.lifetime = 3
    try:
        answer = resolver.resolve(name + ".", "TXT", search=False, lifetime=3,
                                  raise_on_no_answer=False)
        if answer.canonical_name.to_text().lower() != name.lower() + ".":
            return []
        if not answer.rrset:
            return []
        if len(answer.rrset) > 32:
            raise RuntimeError("DNS response limit")
        values = []
        size = 0
        for record in answer:
            raw = b"".join(record.strings)
            size += len(raw)
            if size > 8192:
                raise RuntimeError("DNS response limit")
            values.append(raw.decode("ascii", errors="replace"))
        return values
    except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
        return []
