# Private storage verification

## Checks performed

- `sh scripts/test-api-foundation.sh`: 81 passing Python tests against a newly
  initialized, private Unix-socket PostgreSQL instance; no application or
  production database is used by this command.
- `sh scripts/check-api-contract.sh`: exported FastAPI contract matches the
  shared specification.
- Orval generation and `pnpm run typecheck:libs`: shared React Query and Zod
  libraries compile; existing health names remain compatible.
- Python compilation: application and Alembic modules compile.
- Forward migrations applied to development only, preserving historical
  organizational rows and explicitly revoking legacy session semantics.

Coverage includes local filesystem/S3 mock conformance, missing deletes,
immutable keys, actual-byte bounds, traversal/symlinks/hardlinks, ancestor-mode
safety, maintained parser bounds, unavailable/error/infected scanner outcomes,
authentication lifecycle, legacy privilege rejection, JWT issuer/audience/
algorithm/expiry/version checks, ownership denials with zero adapter calls,
patient reassignment during a write, independent-connection concurrent
replacement and deletion, identity-bound grant expiry and redemption, metadata
constraints, forward/rollback migration behavior, partial object failures,
publication commit failure both before and after an ambiguous successful commit,
pending-delete reconciliation, safe response headers, and response/audit/log
allowlisting.

Existing warnings: Starlette's httpx test-client deprecation and Alembic's
configuration path-separator deprecation. They do not fail the checks and are
not changed as part of this foundation.

## Security and operational boundaries

OWASP BOLA/function-access control, path traversal, upload validation, and
resource-exhaustion risks are addressed by live identity/action/object checks,
generated keys and private adapters, format/parser/scanner gates, actual byte
limits, bounded concurrent operation slots, and authenticated-attempt quotas.
Metadata is never an authorization credential. Patient reassignment changes
database access immediately for subsequent checks; it does not move objects.
Already-issued S3 URLs remain bearer capabilities until their bounded expiry.

No real patient/staff data, public registration, tenant abstraction, frontend
connection, live AWS operation, production migration/deployment, production
scan, or VAPT certification was introduced. Mocked S3 and test-injected clean
scanners do not establish a production provider/scanner deployment.

Before real-data production use, operators must provide durable private storage,
a trusted updated malware scanner with protected transport/network reachability,
capacity and retention policies, reconciliation monitoring, consistent database/
object backups and tested restore/cutover procedures. Review deployment/proxy
limits, IAM/bucket policy, signing-secret rotation, audit retention and access
provisioning. Perform dependency/security scanning and independent VAPT/DAST;
the automated checks are not a certification of security.