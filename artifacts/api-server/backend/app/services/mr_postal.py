"""Fixed public-PIN adapter. Never sends directory data or follows redirects."""
import json
import re
import threading
import time
from collections import OrderedDict
from datetime import timedelta

import httpx
from sqlalchemy import func, select
from app.core.security import utcnow
from app.db.models import AuditEvent
from app.services import mrs

_cache = OrderedDict()
_mutex = threading.Lock()
_network = threading.BoundedSemaphore(4)
MAX_RESPONSE = 128 * 1024
MAX_CACHE = 512
CACHE_SECONDS = 3600


def provider(pin):
    choices = set()
    started = time.monotonic()
    # Fixed scheme, host and path. TLS verification is mandatory; no environment
    # proxy, redirect, caller URL, MR identity or address is forwarded.
    with httpx.Client(timeout=httpx.Timeout(5, connect=2), follow_redirects=False,
                      trust_env=False) as client:
        with client.stream("GET", "https://api.postalpincode.in/pincode/" + pin,
                           headers={"Accept": "application/json", "Accept-Encoding": "identity"}) as response:
            response.raise_for_status()
            if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                raise ValueError("compressed postal response")
            payload = bytearray()
            for chunk in response.iter_raw(chunk_size=16384):
                if time.monotonic() - started > 6:
                    raise ValueError("postal total timeout")
                payload.extend(chunk)
                if len(payload) > MAX_RESPONSE:
                    raise ValueError("postal response bound")
            data = json.loads(payload)
    if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
        raise ValueError("postal shape")
    offices = data[0].get("PostOffice") or []
    if data[0].get("Status") != "Success":
        return []
    if not isinstance(offices, list) or len(offices) > 250:
        raise ValueError("postal offices bound")
    for office in offices:
        if not isinstance(office, dict):
            raise ValueError("postal shape")
        city = office.get("City") or office.get("District") or office.get("Name")
        state, country = office.get("State"), office.get("Country") or "India"
        if all(isinstance(v, str) and 0 < len(v.strip()) <= 100 and
               not any(ord(c) < 32 for c in v) for v in (city, state, country)):
            choices.add((city.strip(), state.strip(), country.strip()))
    return [dict(city=city, state=state, country=country) for city, state, country in sorted(choices)]


def lookup(db, actor, pin, fetcher=provider, *, resource="mr", action="add"):
    if not re.fullmatch(r"[1-9][0-9]{5}", pin):
        raise mrs.MRError("Enter a complete six-digit Indian PIN. Manual entry remains available.", 422, "mr_pin_invalid")
    def quota():
        from app.services.master_policy import authorize_master
        current = authorize_master(db, actor, resource, action)
        count = db.scalar(select(func.count()).select_from(AuditEvent).where(
            AuditEvent.actor_id == current.user.id, AuditEvent.action == "mr_postal_lookup",
            AuditEvent.created_at > utcnow() - timedelta(minutes=1)))
        if count >= 30:
            raise mrs.MRError("PIN lookup limit reached. Enter the address manually or retry later.", 429, "mr_pin_rate")
        db.add(AuditEvent(actor_id=current.user.id, session_id=current.session_id, action="mr_postal_lookup",
                          outcome="success", request_id=db.info.get("request_id")))
        db.commit()
    mrs.transaction(db, quota)
    now = time.monotonic()
    with _mutex:
        cached = _cache.get(pin)
        if cached and cached[0] > now:
            _cache.move_to_end(pin)
            choices = cached[1]
        else:
            choices = None
            _cache.pop(pin, None)
    message = "District is the city suggestion when the provider supplies no city."
    if choices is None:
        if not _network.acquire(blocking=False):
            raise mrs.MRError("PIN lookup is busy. Enter the address manually.", 429, "mr_pin_busy")
        try:
            try:
                choices = fetcher(pin)
            except Exception:
                choices = []
                message = "Postal provider is unavailable. Enter the address manually."
            else:
                with _mutex:
                    _cache[pin] = (now + CACHE_SECONDS, choices)
                    _cache.move_to_end(pin)
                    while len(_cache) > MAX_CACHE:
                        _cache.popitem(last=False)
        finally:
            _network.release()
    # Network work held no transaction or row locks. Reauthorize after slow I/O.
    def finish():
        from app.services.master_policy import authorize_master
        authorize_master(db, actor, resource, action, lock=False)
        db.commit()
    mrs.transaction(db, finish)
    return dict(pincode=pin, choices=choices, message=message if choices else
                (message if "unavailable" in message else "No matching location. Enter the address manually."))
