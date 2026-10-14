"""Execute the repository nginx policy against a disposable policy upstream."""
import http.client
import http.server
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path
import pytest


def test_nginx_checks_every_static_delivery_and_revocation(tmp_path):
    nginx = shutil.which("nginx")
    if not nginx:
        pytest.fail("nginx is required for the portal-serving policy check")
    allowed = {"recovery.allergyevexia.com", "active.allergyevexia.com"}
    observed = []
    class Upstream(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            observed.append((self.path, self.headers.get("Host"), self.headers.get("Cookie"), self.headers.get("Authorization")))
            self.send_response(204 if self.headers.get("Host") in allowed else 421)
            self.end_headers()
        def log_message(self, *args):
            pass
    upstream = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    root = tmp_path / "public"
    root.mkdir()
    (root / "index.html").write_text("Synthetic portal")
    (root / "asset.js").write_text("Synthetic script")
    (tmp_path / "trusted").mkdir()
    # tests -> backend -> api-server -> artifacts; sibling portal.
    source = Path(__file__).resolve().parents[3] / "evexia-portal/nginx.conf"
    template = source.read_text().replace("listen 80;", f"listen 127.0.0.1:{port};").replace(
        "backend:8080", f"127.0.0.1:{upstream.server_port}").replace(
        "/usr/share/nginx/html", str(root)).replace("/etc/nginx/trusted-proto", str(tmp_path / "trusted")).replace(
        "/etc/nginx/trusted-client", str(tmp_path / "trusted-client"))
    config = tmp_path / "nginx.conf"
    config.write_text(f"daemon off;\nmaster_process off;\npid {tmp_path}/nginx.pid;\n"
                      f"error_log {tmp_path}/nginx.log;\nevents {{}}\nhttp {{ access_log off;\n{template}\n}}")
    subprocess.run([nginx, "-t", "-p", str(tmp_path), "-c", str(config)], check=True, capture_output=True)
    process = subprocess.Popen([nginx, "-p", str(tmp_path), "-c", str(config)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    def request(host, path="/admin/settings"):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        connection.request("GET", path, headers={"Host": host, "Cookie": "fixture=only", "Authorization": "Bearer synthetic-only"})
        response = connection.getresponse()
        status, data = response.status, response.read()
        connection.close()
        return status, data
    try:
        for _ in range(50):
            try:
                request("recovery.allergyevexia.com")
                break
            except OSError:
                time.sleep(.05)
        assert request("recovery.allergyevexia.com") == (200, b"Synthetic portal")
        assert request("active.allergyevexia.com", "/asset.js") == (200, b"Synthetic script")
        assert request("evil.allergyevexia.com")[0] != 200
        assert request("active.allergyevexia.com.evil.com", "/asset.js")[0] != 200
        allowed.remove("active.allergyevexia.com")
        assert request("active.allergyevexia.com", "/asset.js")[0] != 200
        assert all(cookie is None and auth is None for path, host, cookie, auth in observed if path.endswith("/admission"))
        assert request("recovery.allergyevexia.com", "/_host_admission")[0] == 404
        # nginx itself rejects duplicate raw Host headers.
        with socket.create_connection(("127.0.0.1", port), timeout=3) as raw:
            raw.sendall(b"GET / HTTP/1.1\r\nHost: recovery.allergyevexia.com\r\nHost: evil.com\r\nConnection: close\r\n\r\n")
            assert b" 400 " in raw.recv(1024).split(b"\r\n", 1)[0]
    finally:
        process.terminate()
        process.wait(timeout=5)
        upstream.shutdown()
        upstream.server_close()
