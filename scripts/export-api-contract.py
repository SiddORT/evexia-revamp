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
        "SESSION_REFRESH_HOURS": "12",
        "SUPER_ADMIN_INITIAL_PASSWORD": "",
        "STAFF_ENCRYPTION_KEYS": "",
        "STAFF_EMAIL_INDEX_KEY": "",
        "STAFF_ENCRYPTION_KEY_ID": "primary",
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
    ("get", "/v1/admin/staff"): "listStaff",
    ("post", "/v1/admin/staff"): "createStaff",
    ("post", "/v1/admin/staff/search"): "searchStaffDirectory",
    ("get", "/v1/admin/staff/{staff_id}"): "getStaff",
    ("post", "/v1/admin/staff/{staff_id}/edit"): "editStaff",
    ("post", "/v1/admin/staff/{staff_id}/status"): "setStaffStatus",
    ("get", "/healthz"): "getHealthCheck",
    ("get", "/v1/health"): "getHealthStatus",
    ("get", "/v1/version"): "getVersion",
    ("get", "/v1/health/readiness"): "getReadiness",
    ("post", "/v1/auth/register"): "register",
    ("post", "/v1/auth/login"): "login",
    ("post", "/v1/auth/refresh"): "refresh",
    ("post", "/v1/auth/logout"): "logout",
    ("get", "/v1/auth/me"): "getCurrentUser",
    ("get", "/v1/auth/session"): "getCurrentSession",
    ("get", "/v1/auth/sessions"): "listOwnSessions",
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
    # FastAPI/Pydantic can omit nullable defaults from the exported schema.
    # Retain the existing procurement validator's null-default contract when
    # regenerating an unrelated order feature; omission must not change its
    # parsed payload shape.
    for schema_name, fields in (
        ("POLineInput", ("gst", "lineId", "unitPrice")),
        ("POLineResponse", ("concentration",)),
    ):
        for field in fields:
            schemas[schema_name]["properties"][field]["default"] = None
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
    parser.add_argument("--scope", choices=["low-stock", "languages", "hsn-allergens"], help="Merge only the selected contract, retaining unrelated refinements.")
    parser.add_argument("--base-contract", type=Path, help="Existing contract to retain for a scoped export.")
    args = parser.parse_args()

    contract = normalize_spec(app.openapi())
    if args.scope:
        original = (args.base_contract or args.output).read_text(encoding="utf-8")
        existing = json.loads(original)
        selected = {path: item for path, item in contract["paths"].items()
                    if (args.scope == "low-stock" and
                        (path.startswith("/v1/admin/low-stock-settings") or path.endswith("/low-stock-alerts")))
                    or (args.scope == "languages" and
                        (path == "/v1/admin/languages" or path.startswith("/v1/admin/languages/")))
                    or (args.scope == "hsn-allergens" and
                        (path == "/v1/admin/hsn" or path.startswith("/v1/admin/hsn/")
                         or path == "/v1/admin/allergens" or path.startswith("/v1/admin/allergens/")))}
        needed = set()

        def collect(value):
            if isinstance(value, dict):
                ref = value.get("$ref", "")
                if ref.startswith("#/components/schemas/"):
                    name = ref.rsplit("/", 1)[1]
                    if name not in needed:
                        needed.add(name)
                        collect(contract["components"]["schemas"][name])
                for item in value.values():
                    collect(item)
            elif isinstance(value, list):
                for item in value:
                    collect(item)

        collect(selected)
        schema_updates = {}
        for name in needed:
            prefixes = (("Allergen", "Hsn", "DilutionMaterialSetup") if args.scope == "hsn-allergens"
                        else ("Language",) if args.scope == "languages" else ("LowStock",))
            if name.startswith(prefixes) or name not in existing["components"]["schemas"]:
                schema_updates[name] = contract["components"]["schemas"][name]
        # Preserve handwritten contract formatting and unrelated refinements,
        # not just their parsed values. Only scoped member values are replaced.
        decoder = json.JSONDecoder()

        def members(source, start):
            pos = start + 1
            result = {}
            while True:
                while source[pos].isspace() or source[pos] == ",":
                    pos += 1
                if source[pos] == "}":
                    return result, pos
                key, end = decoder.raw_decode(source, pos)
                pos = end
                while source[pos].isspace() or source[pos] == ":":
                    pos += 1
                _, end = decoder.raw_decode(source, pos)
                result[key] = (pos, end)
                pos = end

        def merge(source, keys, updates):
            start = source.index("{")
            for key in keys:
                entries, _ = members(source, start)
                start = entries[key][0]
            entries, closing = members(source, start)
            edits, additions = [], []
            indent = "  " * (len(keys) + 1)

            def encoded(value):
                return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True).replace("\n", "\n" + indent)

            for name, value in sorted(updates.items()):
                if name in entries:
                    begin, end = entries[name]
                    if json.loads(source[begin:end]) != value:
                        edits.append((begin, end, encoded(value)))
                else:
                    additions.append(indent + json.dumps(name) + ": " + encoded(value))
            if additions:
                # Insert after the final member, before the original whitespace.
                at = max(end for _, end in entries.values()) if entries else start + 1
                edits.append((at, at, ("," if entries else "") + "\n" + ",\n".join(additions)))
            for begin, end, value in sorted(edits, reverse=True):
                source = source[:begin] + value + source[end:]
            return source

        content = merge(original, ["components", "schemas"], schema_updates)
        content = merge(content, ["paths"], selected)
    else:
        content = json.dumps(contract, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content, encoding="utf-8")


if __name__ == "__main__":
    main()