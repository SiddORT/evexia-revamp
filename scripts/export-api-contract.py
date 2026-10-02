#!/usr/bin/env python3
"""Export the FastAPI OpenAPI contract without loading deployment credentials."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "artifacts" / "api-server" / "backend"
OUTPUT = ROOT / "lib" / "api-spec" / "openapi.yaml"

# Pin every setting that can affect app construction to synthetic values. In
# particular, do not consult Replit Secrets or inherit live DB/signing values.
os.environ.update(
    {
        "APP_ENV": "development",
        "DATABASE_URL": "postgresql+psycopg://contract-export:contract-export-only@127.0.0.1/contract_export",
        "JWT_SECRET": "openapi-contract-export-only-not-a-deployment-secret",
        "SESSION_SECRET": "",
        "JWT_ISSUER": "evexia-contract-export",
        "JWT_AUDIENCE": "evexia-contract-export",
        "CORS_ORIGINS": "",
        "ALLOW_PUBLIC_REGISTRATION": "false",
        "STORAGE_BACKEND": "local",
        "LOCAL_STORAGE_ROOT": "/tmp/evexia-contract-export-unused",
        "SCANNER_BACKEND": "unavailable",
        "S3_BUCKET": "",
        "S3_ENDPOINT_URL": "",
        "S3_REGION": "",
        "AWS_ACCESS_KEY_ID": "",
        "AWS_SECRET_ACCESS_KEY": "",
    }
)
sys.path.insert(0, str(BACKEND))

from app.main import app  # noqa: E402


OPERATION_IDS = {
    ("get", "/healthz"): "getHealthCheck",
    ("get", "/v1/health"): "getHealthStatus",
    ("get", "/v1/version"): "getVersion",
    ("get", "/v1/health/readiness"): "getReadiness",
    ("post", "/v1/auth/register"): "register",
    ("post", "/v1/auth/login"): "login",
    ("post", "/v1/auth/refresh"): "refresh",
    ("post", "/v1/auth/logout"): "logout",
    ("get", "/v1/auth/me"): "getCurrentUser",
    ("post", "/v1/auth/change-password"): "changePassword",
    ("post", "/v1/domain/mrs"): "provisionMR",
    ("post", "/v1/domain/mrs/{user_id}/mapping"): "mapUserToMR",
    ("post", "/v1/domain/patients"): "createPatient",
    ("post", "/v1/domain/patients/{patient_id}/assignment"): "assignPatient",
    ("post", "/v1/files"): "uploadFile",
    ("get", "/v1/files/grants/{token}"): "redeemDownloadGrant",
    ("get", "/v1/files/{file_id}"): "getFileMetadata",
    ("get", "/v1/files/{file_id}/download"): "downloadFile",
    ("post", "/v1/files/{file_id}/download-url"): "createDownloadURL",
    ("delete", "/v1/files/{file_id}"): "deleteFile",
    ("post", "/v1/files/{file_id}/replacement"): "replaceFile",
    ("post", "/v1/files/{file_id}/reconcile"): "reconcileFile",
}

def normalize_spec(source: dict[str, Any]) -> dict[str, Any]:
    spec = source
    spec["info"]["title"] = "Api"
    spec["info"]["description"] = (
        "Generated from the FastAPI application. Paths are relative to the /api "
        "mount used by this workspace."
    )
    spec["servers"] = [{"url": "/api", "description": "API artifact mount"}]

    paths: dict[str, Any] = {}
    for original_path, path_item in spec["paths"].items():
        path = original_path.removeprefix("/api") if original_path.startswith("/api/") else original_path
        paths[path] = path_item
    spec["paths"] = paths

    schemas = spec.get("components", {}).get("schemas", {})
    missing_schemas = {"ErrorEnvelope", "HealthStatus"} - schemas.keys()
    if missing_schemas:
        missing = ", ".join(sorted(missing_schemas))
        raise RuntimeError(
            f"FastAPI OpenAPI is missing authoritative schema(s): {missing}; "
            "integrate backend response models before exporting."
        )

    for path, path_item in paths.items():
        for method, operation in path_item.items():
            if method not in {"get", "post", "put", "patch", "delete", "options", "head"}:
                continue
            operation_id = OPERATION_IDS.get((method, path))
            if operation_id:
                operation["operationId"] = operation_id
            responses = operation.setdefault("responses", {})
            response_headers = {
                "X-Request-ID": {
                    "description": "Server-generated request correlation ID.",
                    "schema": {"type": "string", "format": "uuid"},
                }
            }
            if operation_id in {"uploadFile", "replaceFile"}:
                response_headers["X-File-ID"] = {
                    "description": (
                        "New immutable file record ID, present after reservation even "
                        "when later upload processing fails."
                    ),
                    "schema": {"type": "string", "format": "uuid"},
                }
            for response in responses.values():
                if isinstance(response, dict):
                    response.setdefault("headers", {}).update(response_headers)

    return spec


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()

    contract = normalize_spec(app.openapi())
    content = json.dumps(contract, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()