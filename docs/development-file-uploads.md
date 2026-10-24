# Private order uploads in Replit

Immunotherapy prescriptions and Kits attachments, in both Admin and MR, use the
same private file service. Uploads require configured storage **and** a real clean
malware-scan result. A healthy API alone does not establish either prerequisite.

## Development configuration

The Replit development environment uses:

```text
STORAGE_BACKEND=local
LOCAL_STORAGE_ROOT=/home/runner/workspace/storage/private-files
SCANNER_BACKEND=clamd
CLAMD_HOST=127.0.0.1
CLAMD_PORT=3310
EVEXIA_DEVELOPMENT_LOCAL_UPLOADS=1
```

Use the actual absolute project path if the workspace is moved. The local adapter
creates application-owned 0700 directories and immutable 0600 files. Object keys
remain identical to the S3 adapter's logical layout:
`patients/<uuid>/documents/<uuid>.pdf` and
`kits/<uuid>/documents/<uuid>.pdf` (also the supported image extensions).
This is a filesystem adapter, **not** an S3-compatible HTTP server. Do not change
the backend to `s3` without configuring a real bucket and transferring existing
objects with their keys and metadata intact.

`storage/` is excluded from Git and Replit publishing. Both Vite servers explicitly
deny this directory and `.local/`, including `/@fs` access. Downloads still require
the existing authenticated ownership/permission checks. Never copy uploads into
`public/`, expose the directory through a web server, or publish the scanner port.

## Scanner lifecycle

With `EVEXIA_DEVELOPMENT_LOCAL_UPLOADS=1`, the existing API workflow owns and stops
both the API process and the scanner supervisor. No extra workflow is needed.
The scanner supervisor runs:

```sh
bash scripts/start-development-scanner.sh
```

The Replit Nix dependencies include `clamav`. The workflow fetches and verifies
official signed virus definitions into `.local/clamav/database`, then supervises
ClamAV and its periodic updater. ClamAV binds only to `127.0.0.1:3310`.
If either scanner child exits, the supervisor stops the other and reports failure.
The API continues serving unrelated features, but uploads fail closed. Restart
the API workflow to recover; never mark unscanned files clean.

Initial signature download requires network access and scanner startup requires
memory for the virus database. An initial update failure blocks scanner startup.
Restarted scanners reject definitions older than seven days. The API remains
fail-closed if scanning is unavailable or fails; only verified, clean-scanned files
may be attached. Retry failed selections explicitly; do not automatically resubmit
orders or delete previously saved attachments.

Restart the API after changing these development variables. Do not start a second
scanner manually while the API owns it; a nonblocking supervisor lock rejects that.
No schema migration or change to existing order ownership is required.
Already-uploaded quarantined files must follow the existing authorized recovery
flow; service activation does not retroactively mark them verified.

## Scope and portability

This configures **this Replit development workspace only**, not the VPS.
Local upload bytes are not a durable external backup and are intentionally absent
from deployments and Git. Preserve them before replacing or deleting the workspace.
A later VPS/S3 setup must deliberately configure private storage, a real scanner,
and preservation or transfer of existing objects; changing an environment variable
alone does not move them. Production defaults and Docker Compose are unchanged.
