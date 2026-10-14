"""Raw ASGI boundary runs before authentication and forwarded-header handling."""
import ipaddress
import re
from starlette.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool
from sqlalchemy import text
from app.db.session import session_factory
from app.services.domain_policy import admitted


def exact_host(value):
    if not value or value != value.strip() or not value.isascii():
        raise ValueError()
    # Accept a valid optional port, never lists, wildcards, userinfo or trailing dot.
    match = re.fullmatch(r"(\[[0-9a-fA-F:]+\]|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)(?::([0-9]{1,5}))?", value)
    if not match or (match[2] and not 1 <= int(match[2]) <= 65535):
        raise ValueError()
    host = match[1].lower()
    if host.startswith("["):
        ipaddress.IPv6Address(host[1:-1])
        return host[1:-1]
    if len(host) > 253 or any(len(x) > 63 or x.startswith("-") or x.endswith("-") for x in host.split(".")):
        raise ValueError()
    return host


class HostPolicy:
    def __init__(self, app, settings):
        self.app, self.settings = app, settings
        self.bootstrap = settings.bootstrap_hosts
        self.peers = settings.proxy_peers

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = scope["headers"]
        values = [v for k, v in headers if k.lower() == b"host"]
        try:
            if len(values) != 1:
                raise ValueError()
            host = exact_host(values[0].decode("ascii"))
        except (ValueError, UnicodeError):
            return await self.reject(400, scope, receive, send)
        # Uvicorn MUST start with --no-proxy-headers. Only this boundary trusts
        # single-value metadata from an exact configured socket peer. The
        # proxy must overwrite client identity, never append a caller's chain.
        peer = (scope.get("client") or ("",))[0]
        proto = [v for k, v in headers if k.lower() == b"x-forwarded-proto"]
        if peer in self.peers:
            clients = [v for k, v in headers if k.lower() == b"x-forwarded-for"]
            try:
                if len(clients) != 1 or len(clients[0]) > 45:
                    raise ValueError()
                address = clients[0].decode("ascii")
                if not re.fullmatch(r"[0-9A-Fa-f:.]+", address):
                    raise ValueError()
                address = str(ipaddress.ip_address(address))
            except (ValueError, UnicodeError):
                return await self.reject(400, scope, receive, send)
            scope["client"] = (address, 0)
            if len(proto) == 1 and proto[0] in (b"http", b"https"):
                scope["scheme"] = proto[0].decode()
        scope["headers"] = [(k, v) for k, v in headers if k.lower() not in (
            b"forwarded", b"x-forwarded-host", b"x-forwarded-proto", b"x-forwarded-for", b"x-real-ip")]
        scope.setdefault("state", {})["accepted_hostname"] = host
        if self.settings.app_env == "production":
            try:
                if host in self.bootstrap:
                    role = None
                else:
                    def check():
                        with session_factory()() as db:
                            db.execute(text("SET LOCAL statement_timeout = '1500ms'"))
                            db.execute(text("SET LOCAL lock_timeout = '500ms'"))
                            return admitted(db, host)
                    role = await run_in_threadpool(check)
                scope["state"]["accepted_role"] = role
            except PermissionError:
                return await self.reject(421, scope, receive, send)
            except Exception:
                return await self.reject(503, scope, receive, send)
        # nginx auth_request checks the actual external Host on every delivery.
        if scope["path"] == "/api/v1/portal/admission":
            if self.settings.app_env != "production":
                return await self.reject(403, scope, receive, send)
            return await Response(status_code=204, headers={"Cache-Control": "no-store"})(scope, receive, send)
        return await self.app(scope, receive, send)

    async def reject(self, status, scope, receive, send):
        response = JSONResponse({"error": {"code": "host_unavailable",
            "message": "Hostname unavailable; check configuration and retry.",
            "request_id": None, "fields": []}}, status_code=status,
            headers={"Cache-Control": "no-store"})
        await response(scope, receive, send)
