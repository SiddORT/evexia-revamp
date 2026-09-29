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
from app.core.config import get_settings

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("evexia.api")


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
    )
    app.add_middleware(
        CORSMiddleware, allow_origins=origins, allow_credentials=True,
        allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        try:
            content_length = request.headers.get("content-length")
            if content_length and (not content_length.isdigit() or int(content_length) > 1_048_576):
                response = JSONResponse({"detail": "Request too large"}, status_code=413)
            else:
                response = await call_next(request)
        except Exception:
            logger.exception(json.dumps({"event": "unhandled_error", "request_id": request_id}))
            response = JSONResponse({"detail": "Internal server error"}, status_code=500)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Cache-Control"] = "no-store"
        if settings.app_env == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        logger.info(json.dumps({
            "event": "http_request", "request_id": request_id,
            "method": request.method, "path": request.url.path, "status": response.status_code,
        }))
        return response

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        return JSONResponse(
            {"detail": exc.detail if exc.status_code < 500 else "Internal server error"},
            status_code=exc.status_code, headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Do not echo invalid bodies: they may contain passwords or other sensitive values.
        return JSONResponse({"detail": "Invalid request"}, status_code=422)

    app.include_router(system_router, prefix="/api/v1")
    app.include_router(auth_router, prefix="/api/v1")
    app.add_api_route("/api/healthz", lambda: {"status": "ok"}, methods=["GET"], include_in_schema=False)
    return app


app = create_app()