"""Trusted client identity and real nginx rate-limit isolation; synthetic only."""
import http.client
import http.server
import json
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.core.config import get_settings
from app.core.host_policy import HostPolicy
from test_sessions import client, create_user, PASSWORD


def identity_app(settings):
    async def identity(request):
        return JSONResponse({
            "client": request.client.host, "scheme": request.url.scheme,
            "forwarded": [name for name in request.headers
                          if name.startswith("x-forwarded-") or name in ("forwarded", "x-real-ip")],
        })
    return HostPolicy(Starlette(routes=[Route("/", identity)]), settings)


@pytest.mark.parametrize("address", [
    None, "", "unknown", "192.0.2.1,192.0.2.2", "192.0.2.1:80", "[::1]",
    "::1%lo", " 192.0.2.1", "192.0.2.1 ", "999.0.0.1", "1" * 46, "unix:proxy",
])
def test_trusted_peer_requires_one_valid_client_ip(address):
    settings = get_settings().model_copy(update={"trusted_proxy_peers": "127.0.0.2"})
    headers = {} if address is None else {"X-Forwarded-For": address}
    with TestClient(identity_app(settings), client=("127.0.0.2", 123)) as api:
        assert api.get("/", headers=headers).status_code == 400
        assert api.get("/", headers=[("X-Forwarded-For", "192.0.2.1"),
                                     ("X-Forwarded-For", "192.0.2.2")]).status_code == 400


@pytest.mark.parametrize("address,canonical", [
    ("192.0.2.1", "192.0.2.1"), ("2001:DB8:0::1", "2001:db8::1"),
])
def test_client_identity_is_exact_peer_only_and_metadata_is_consumed(address, canonical):
    settings = get_settings().model_copy(update={"trusted_proxy_peers": "127.0.0.2"})
    headers = {"X-Forwarded-For": address, "X-Forwarded-Proto": "https",
               "X-Forwarded-Host": "evil.example", "Forwarded": "for=evil",
               "X-Real-IP": "198.51.100.9"}
    with TestClient(identity_app(settings), client=("127.0.0.1", 123)) as api:
        assert api.get("/", headers=headers).json() == {
            "client": "127.0.0.1", "scheme": "http", "forwarded": []}
    with TestClient(identity_app(settings), client=("127.0.0.2", 123)) as api:
        assert api.get("/", headers=headers).json() == {
            "client": canonical, "scheme": "https", "forwarded": []}


def test_nginx_client_identity_keeps_login_and_recovery_limits_separate(client, tmp_path, monkeypatch):
    """Real repository nginx -> host boundary -> actual API/DB rate limiters."""
    nginx = shutil.which("nginx")
    assert nginx, "nginx is required for the proxy rate-limit check"
    api, db, settings = client
    create_user(db, "proxy-healthy@example.com")
    from app.services import recovery_mail, password_recovery
    delivered = []
    # No SMTP or real mail. Keep the actual database-backed quota logic.
    monkeypatch.setattr(recovery_mail, "validate_configuration", lambda settings: None)
    monkeypatch.setattr(password_recovery, "deliver", lambda *args: delivered.append(args[2]))
    production = settings.model_copy(update={
        "app_env": "production", "portal_bootstrap_hosts": "recovery.allergyevexia.com",
        "trusted_proxy_peers": "127.0.0.1",
    })
    identities = []

    async def inspect(scope, receive, send):
        if scope["type"] == "http":
            identities.append(scope["client"][0])
        await api.app(scope, receive, send)

    guarded = TestClient(HostPolicy(inspect, production), client=("127.0.0.1", 123))

    class Upstream(http.server.BaseHTTPRequestHandler):
        def handle_request(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            response = guarded.request(self.command, self.path, content=body,
                                       headers=list(self.headers.items()))
            self.send_response(response.status_code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(response.content)

        do_GET = handle_request
        do_POST = handle_request

        def log_message(self, *args):
            pass

    upstream = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()
    with socket.socket() as available:
        available.bind(("127.0.0.1", 0))
        port = available.getsockname()[1]
    (tmp_path / "trusted-client").mkdir()
    (tmp_path / "trusted-client/ingress.conf").write_text("127.0.0.4 1;\n")
    source = Path(__file__).resolve().parents[3] / "evexia-portal/nginx.conf"
    template = source.read_text().replace("listen 80;", f"listen 127.0.0.1:{port};").replace(
        "backend:8080", f"127.0.0.1:{upstream.server_port}").replace(
        "/etc/nginx/trusted-proto", str(tmp_path / "trusted-proto")).replace(
        "/etc/nginx/trusted-client", str(tmp_path / "trusted-client"))
    config = tmp_path / "nginx.conf"
    config.write_text(f"daemon off;\nmaster_process off;\npid {tmp_path}/nginx.pid;\n"
                      f"error_log {tmp_path}/nginx.log;\nevents {{}}\nhttp {{ access_log off;\n{template}\n}}")
    subprocess.run([nginx, "-t", "-p", str(tmp_path), "-c", str(config)], check=True, capture_output=True)
    process = subprocess.Popen([nginx, "-p", str(tmp_path), "-c", str(config)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def request(address, path="/api/v1/auth/me", data=None, extra=None):
        connection = http.client.HTTPConnection(
            "127.0.0.1", port, timeout=10, source_address=(address, 0))
        headers = {"Host": "recovery.allergyevexia.com", "Origin": "http://recovery.allergyevexia.com",
                   "Content-Type": "application/json", **(extra or {})}
        connection.request("POST" if data is not None else "GET", path,
                           body=json.dumps(data) if data is not None else None, headers=headers)
        response = connection.getresponse()
        status = response.status
        response.read()
        connection.close()
        return status

    try:
        for _ in range(50):
            try:
                assert request("127.0.0.2") == 401
                break
            except OSError:
                time.sleep(.05)
        else:
            pytest.fail("disposable nginx did not start")
        # Caller-controlled metadata cannot replace the actual socket client.
        assert request("127.0.0.2", extra={"X-Forwarded-For": "203.0.113.9",
                       "X-Real-IP": "203.0.113.9", "X-Forwarded-Proto": "https"}) == 401
        assert identities[-1] == "127.0.0.2"
        assert request("127.0.0.4", extra={"X-Real-IP": "198.51.100.7"}) == 401
        assert identities[-1] == "198.51.100.7"
        before = len(identities)
        assert request("127.0.0.4", extra={"X-Real-IP": "198.51.100.7,203.0.113.9"}) == 400
        assert len(identities) == before
        for i in range(30):
            assert request("127.0.0.2", "/api/v1/auth/login", {
                "identifier": f"unknown-proxy-{i}", "password": "synthetic-incorrect",
            }) == 401
        valid = {"identifier": "proxy-healthy@example.com", "password": PASSWORD, "identity_kind": "mr"}
        assert request("127.0.0.2", "/api/v1/auth/login", valid) == 429
        assert request("127.0.0.3", "/api/v1/auth/login", valid) == 200
        for i in range(31):
            assert request("127.0.0.2", "/api/v1/auth/forgot-password", {
                "identifier": f"missing-recovery-{i}", "identity_kind": "admin",
            }) == 202
        assert len(delivered) == 30
        assert request("127.0.0.3", "/api/v1/auth/forgot-password", {
            "identifier": "other-missing-recovery", "identity_kind": "admin",
        }) == 202
        assert len(delivered) == 31
    finally:
        process.terminate()
        process.wait(timeout=5)
        upstream.shutdown()
        upstream.server_close()
        guarded.close()
