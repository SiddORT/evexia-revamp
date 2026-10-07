"""Count actual ASGI bytes, retaining the existing 1 MiB JSON boundary."""
from starlette.exceptions import HTTPException


class RequestTooLarge(HTTPException):
    def __init__(self):
        super().__init__(413, "Request too large")


def body_limit(method, path, max_upload_bytes):
    if method == "POST":
        if path in ("/api/v1/admin/courier-partners/import/review", "/api/v1/admin/courier-partners/import/commit",
                    "/api/v1/admin/storage-locations/import/review", "/api/v1/admin/storage-locations/import/commit"):
            return 2 * 1024 * 1024 + 64 * 1024
        if path in ("/api/v1/admin/zones/import/review", "/api/v1/admin/zones/import/commit"):
            return 2 * 1024 * 1024
        if path == "/api/v1/files" or (path.startswith("/api/v1/files/") and path.endswith("/replacement")):
            return max_upload_bytes
    return 1_048_576


class RequestSizeLimit:
    def __init__(self, app, max_upload_bytes):
        self.app, self.max_upload_bytes = app, max_upload_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope["path"]
        is_upload = scope["method"] == "POST" and (
            path == "/api/v1/files" or
            (path.startswith("/api/v1/files/") and path.endswith("/replacement"))
        )
        limit = body_limit(scope["method"], path, self.max_upload_bytes)
        total = 0
        async def bounded_receive():
            nonlocal total
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > limit:
                    raise RequestTooLarge()
            return message
        return await self.app(scope, bounded_receive, send)