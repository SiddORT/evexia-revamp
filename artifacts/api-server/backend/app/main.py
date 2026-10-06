import json
import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.auth import router as auth_router
from app.api.v1.system import router as system_router
from app.api.v1.domain import router as domain_router
from app.api.v1.files import router as files_router
from app.api.v1.reporting import router as reporting_router
from app.api.v1.staff import router as staff_router
from app.services.staff_crypto import StaffError
from app.core.config import get_settings
from app.core.request_limits import RequestSizeLimit, RequestTooLarge
from app.services.auth import AuthError
from app.services.file_policy import FileError
from app.schemas.errors import ErrorEnvelope
from app.schemas.system import HealthStatus

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("evexia.api")
# Uvicorn's default access line includes raw grant URLs. Our structured logger
# below emits only route templates and never query strings or grant tokens.
logging.getLogger("uvicorn.access").disabled = True


def error_body(request, status, message, code=None, fields=None):
    return {"error": {
        "code": code or {
            400: "invalid_request", 401: "authentication_required", 403: "access_denied",
            404: "not_found", 409: "conflict", 413: "request_too_large",
            422: "invalid_request", 429: "rate_limited", 503: "service_unavailable",
        }.get(status, "internal_error" if status >= 500 else "request_failed"),
        "message": message, "request_id": getattr(request.state, "request_id", None),
        "fields": fields or [],
    }}


def create_app() -> FastAPI:
    settings = get_settings()
    # Refuse to start with missing/weak signing configuration or unsafe CORS.
    settings.signing_key
    origins = settings.allowed_origins

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield

    app = FastAPI(
        title="EVEXIA API", version="1.0.0", lifespan=lifespan,
        docs_url="/api/docs" if settings.app_env != "production" else None,
        redoc_url=None, openapi_url="/api/openapi.json" if settings.app_env != "production" else None,
        responses={status: {"model": ErrorEnvelope} for status in
                   (400, 401, 403, 404, 408, 409, 413, 415, 422, 429, 500, 503)},
    )
    app.add_middleware(
        CORSMiddleware, allow_origins=origins, allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE"], allow_headers=["Authorization", "Content-Type"],
    )
    app.add_middleware(RequestSizeLimit, max_upload_bytes=settings.max_upload_bytes)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        try:
            content_length = request.headers.get("content-length")
            is_upload = request.method == "POST" and (
                request.url.path == "/api/v1/files" or (
                    request.url.path.startswith("/api/v1/files/") and request.url.path.endswith("/replacement")
                )
            )
            limit = settings.max_upload_bytes if is_upload else 1_048_576
            if content_length and (not content_length.isdigit() or int(content_length) > limit):
                response = JSONResponse(error_body(request, 413, "Request too large"), status_code=413)
            else:
                response = await call_next(request)
        except RequestTooLarge:
            response = JSONResponse(error_body(request, 413, "Request too large"), status_code=413)
        except Exception:
            # Tracebacks/provider exception strings can contain SQL parameters,
            # sensitive filenames or URLs; do not emit them in request logs.
            logger.error(json.dumps({"event": "unhandled_error", "request_id": request_id}))
            response = JSONResponse(error_body(request, 500, "Internal server error"), status_code=500)
        response.headers["X-Request-ID"] = request_id
        if getattr(request.state, "file_id", None):
            response.headers["X-File-ID"] = request.state.file_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Cache-Control"] = "no-store"
        if settings.app_env == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        logger.info(json.dumps({
            "event": "http_request", "request_id": request_id,
            "method": request.method,
            "path": ("/api/v1/files/grants/[redacted]" if "/files/grants/" in request.url.path else
                     getattr(request.scope.get("route"), "path", "[unmatched]")),
            "status": response.status_code,
        }))
        return response

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        return JSONResponse(
            error_body(request, exc.status_code, exc.detail if exc.status_code < 500 else "Service unavailable"),
            status_code=exc.status_code, headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Do not echo invalid bodies: they may contain passwords or other sensitive values.
        fields = [{"field": ".".join(str(part) for part in err["loc"] if isinstance(part, (str, int))),
                   "code": err["type"]} for err in exc.errors()[:20]]
        if request.url.path.startswith("/api/v1/admin/staff"):
            allowed = {"name", "email", "phone", "dialCountry", "role", "designation", "dateOfJoining", "status", "expected_version", "staff_id", "limit", "offset"}
            locations = {f"{scope}.{name}" for scope in ("body", "query", "path") for name in allowed}
            fields = [{"field": field["field"] if field["field"] in locations else "body",
                       "code": field["code"]} for field in fields]
        return JSONResponse(error_body(request, 422, "Invalid request", fields=fields), status_code=422)

    @app.exception_handler(FileError)
    async def file_error(request: Request, exc: FileError):
        return JSONResponse(error_body(request, exc.status, exc.message, exc.code), status_code=exc.status)

    @app.exception_handler(StaffError)
    async def staff_error(request: Request, exc: StaffError):
        return JSONResponse(error_body(request, exc.status, exc.message, exc.code), status_code=exc.status)

    @app.exception_handler(AuthError)
    async def revoked_identity(request: Request, exc: AuthError):
        return JSONResponse(error_body(request, 401, "Authentication required"), status_code=401,
                            headers={"WWW-Authenticate": "Bearer"})

    @app.exception_handler(RequestTooLarge)
    async def too_large(request: Request, exc: RequestTooLarge):
        return JSONResponse(error_body(request, 413, "Request too large"), status_code=413)

    app.include_router(system_router, prefix="/api/v1")
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(domain_router, prefix="/api/v1")
    app.include_router(files_router, prefix="/api/v1")
    app.include_router(reporting_router, prefix="/api/v1")
    app.include_router(staff_router, prefix="/api/v1")
    app.add_api_route("/api/healthz", lambda: {"status": "ok"}, methods=["GET"],
                      response_model=HealthStatus, operation_id="getHealthCheck", tags=["health"])
    original_openapi = app.openapi
    def openapi():
        spec = original_openapi()
        for path, item in spec["paths"].items():
            for method, operation_spec in item.items():
                if method not in ("get", "post", "delete"):
                    continue
                for response_spec in operation_spec["responses"].values():
                    headers = response_spec.setdefault("headers", {})
                    headers["X-Request-ID"] = {"schema": {"type": "string", "format": "uuid"},
                                               "description": "Server-generated request correlation ID"}
                    if method == "post" and (path == "/api/v1/files" or path.endswith("/replacement")):
                        headers["X-File-ID"] = {
                            "schema": {"type": "string", "format": "uuid"},
                            "description": "Present after a file reservation; use for metadata/recovery after a failure",
                        }
        return spec
    app.openapi = openapi
    return app


app = create_app()