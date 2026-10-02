"""Count actual ASGI bytes, retaining the existing 1 MiB JSON boundary."""
from starlette.exceptions import HTTPException


class RequestTooLarge(HTTPException):
    def __init__(self):
        super().__init__(413, "Request too large")


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
        limit = self.max_upload_bytes if is_upload else 1_048_576
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