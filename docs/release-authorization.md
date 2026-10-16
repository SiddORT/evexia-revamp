# Release authorization: automatic safe cases, protected existing databases

This policy replaces the broad per-release human manifest-digest gate with
machine validation **only for the cases described below**. It does not approve
this release, assert that the VPS is empty, or activate anything.

| Case | Authorization |
|---|---|
| Routine migrations | Complete successful signed release validation, exact artifact integrity, and an entirely `automatic` pending path under the existing migration policy. |
| New dedicated database | The same validation, independent target/recovery evidence, live pristine check and an authenticated origin created by successful automatic preparation. |
| Existing/populated database | Pending `operator_only` revisions still return 42 before any migration. Destructive/encrypted changes and protected bootstrap retain explicit operator authorization. |

No historical migration or classification is changed. Prepare remains
`0031_role_hostnames`, retirement remains capped at
`0034_shared_phone_countries`, final/readiness target remains
`0039_communication`. No stamp, environment bypass or manual schema creation is
introduced.

## Trust setup (one-time, authorized infrastructure administration)

Two distinct Ed25519 authorities are required:

1. **Release validation authority.** Its private PEM key is the GitHub Actions
   secret `RELEASE_VALIDATION_PRIVATE_KEY`. It must be dedicated to this purpose,
   not an encryption/index/session key. The reusable validation workflow runs the
   complete release/browser gate, isolated production-mode fresh-install suite,
   and infrastructure unit suite. A failed command, dirty checkout, source
   change, or signing error produces **no usable certificate**.
2. **Independent recovery authority.** Its private key stays outside GitHub and
   the application. It attests actual target inspection, durable backup custody,
   successful independent restoration/path rehearsal and independent key
   recovery. It must not sign guessed/default claims or claim that a checksum
   establishes restoration.

Generate each key in its respective secure authority environment, never in the
repository or by displaying it in chat:

```sh
umask 077
openssl genpkey -algorithm Ed25519 -out AUTHORITY-PRIVATE.pem
openssl pkey -in AUTHORITY-PRIVATE.pem -pubout -out AUTHORITY-PUBLIC.pem
```

Convert only the public key to the required raw hexadecimal form:

```sh
python -B - AUTHORITY-PUBLIC.pem <<'PY'
import pathlib, sys
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
key = serialization.load_pem_public_key(pathlib.Path(sys.argv[1]).read_bytes())
assert isinstance(key, Ed25519PublicKey)
print(key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex())
PY
```

Install canonical, operator-owned mode-0600
`/restricted/operator/release/trust.json` in a directory not writable by other
users. This is outside both the active checkout and candidate release.
Public keys are the 32-byte raw Ed25519 public keys represented as 64 hex
characters (not PEM text). Trust is a separately controlled configuration, not
something automatically generated from `DATABASE_URL`.

Required structure (replace every placeholder from independently verified
records; do not copy the example as evidence):

```json
{
  "format": 1,
  "release_public_key": "<release-authority raw public key hex>",
  "recovery_public_key": "<different recovery-authority raw public key hex>",
  "database": "<approved database name>",
  "cluster": 123456789,
  "database_host": "<approved configured database host or Unix socket directory>",
  "database_port": 5432,
  "allow_initial_bootstrap": true,
  "admin_hostname": null
}
```

The example cluster number is deliberately NOT a production value. Initial
bootstrap permission and optional Admin hostname are explicit target policy,
not inferred from an email, browser hostname or connection.

The deployment SSH user must be able to read the trust file. No changes to
`.env`, Compose, storage, PostgreSQL volume or Nginx are required. CI keeps its
existing concurrency/flock and exit-42 classification; the new validation job
must succeed before the SSH deployment job can run. Validation infrastructure
has no database/VPS credentials.

## Signed release evidence

The trusted validation environment runs, on an exact clean committed checkout:

```sh
python -B scripts/validate-release-artifact.py \
  --signing-key /canonical/private/release-validation-key.pem \
  --output /canonical/private/release-validation.json
```

Use real canonical external paths and mode-0600 files. The tool does not accept
supplied “passed” values: it executes the fixed commands in
`scripts/release-authorization-policy.json`. It signs their successful exits,
exact commit, manifest SHA and tracked-file hashes only after completion.
CI transfers that signed output; the runner independently verifies it against
the installed public key and exact candidate bytes. A manifest status alone,
test log or completed development task cannot authorize execution.

## Independent fresh recovery evidence

Before unattended preparation, the recovery authority must inspect the intended
database independently and retain:

- Full pristine inventory, including non-table objects and other schemas.
- Durable full database backup, actually restored to a different independently
  identified PostgreSQL cluster. Merely lacking `alembic_version` is insufficient.
- Genuine historical-path rehearsal using the original migrations/guards, and
  the compatible organization recovery JSON produced at the rehearsal's
  `0031_role_hostnames` stage. Never label a recovery snapshot exported from the
  rehearsal as a full backup of the target.
- Separate restoration report and independent encryption/index/signing-key
  recovery evidence. Existing strict restored-CHECK/catalog safeguards remain;
  use the original runbook's original-migration replay when required.
- External-consumer/retention review and writer-drain arrangements.

The signed recovery envelope has exactly `payload` and `signature` fields.
`signature` is base64 Ed25519 over UTF-8 JSON encoded with sorted keys and
separators `(",", ":")`, without a trailing newline.

After the independent recovery authority has completed the checks and prepared
its factual payload, it can sign that payload in its own secure environment:

```sh
python -B - REVIEWED-PAYLOAD.json RECOVERY-PRIVATE.pem SIGNED-RECOVERY.json <<'PY'
import base64, json, os, pathlib, sys
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
key = serialization.load_pem_private_key(pathlib.Path(sys.argv[2]).read_bytes(), password=None)
assert isinstance(key, Ed25519PrivateKey)
assert payload["purpose"] == "evexia-fresh-recovery-v1"
message = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
envelope = {"payload": payload, "signature": base64.b64encode(key.sign(message)).decode()}
fd = os.open(sys.argv[3], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
with os.fdopen(fd, "w") as output:
    json.dump(envelope, output)
    output.flush()
    os.fsync(output.fileno())
PY
```

This signs an existing independent attestation; it does not inspect a backup or
turn supplied claims into verified facts. Do not place the recovery private key
on the application host or use the release signing key for this command.

The payload contains:

* `purpose`: `evexia-fresh-recovery-v1`;
* `database`, integer `cluster`, distinct integer `restored_cluster`;
* integer `observed_at` (Unix seconds; no older than 24 hours);
* `key_fingerprint`: `release_authorization.key_fingerprint(settings)` observed
  by the authorized recovery authority, never the keys themselves;
* **actual, separately verified** booleans `source_pristine_verified`,
  `durable_custody_verified`, `restoration_rehearsal_verified`,
  `independent_key_recovery_verified`, `external_consumers_reviewed`,
  `retention_resolved`, all true;
* nonempty `restoration_reference` and `key_recovery_reference`;
* canonical external `*_path` and matching `*_sha256` pairs for `backup`,
  `restoration_report`, `source_inventory`, and `organization_recovery`.

The authority is responsible for the truth of the separately signed
attestations. Runtime independently checks signatures, identity, freshness,
key binding, artifact integrity and live database contents. File integrity is
NEVER treated as proof of restoration or recovered keys. There is intentionally
no command to manufacture these attestations from hashes or defaults.

Pristine checks also reject public operator classes/families and text-search
objects, foreign-data wrappers, default ACLs and logical-replication
publications/subscriptions. A database without tables can still fail these
checks. Extension-owned objects remain narrowly allowed for the already
reviewed `plpgsql`/`pg_trgm` extensions.

## Exact fresh-phase commands (future operator use, NOT performed here)

First use the existing [fresh-install supervisor procedure](fresh-install.md#exact-vps-execution-pattern-operator-only-not-performed-by-agent).
Retain its verified target/image/network, maintenance marker, canonical shared
flock and genuine writer drain. Docker **does not inherit host FD9**: its
supervisor must acquire the same mounted lock inode and explicitly inherit its
descriptor to child processes, as documented there.

Mount the release read-only at `/operator-release`, and the existing restricted
recovery directory and `/restricted/operator/release` at the identical canonical
paths. Supply the existing production configuration securely. The trust,
signed release/recovery evidence and recovery files must already exist, owned
by the operator (or root where readable) and mode 0600.

Inside that persistent supervisor:

```sh
set -euo pipefail
RELEASE=/operator-release
EVIDENCE=/restricted/operator/retirement
TRUST=/restricted/operator/release/trust.json
: "${APPROVED_DB_NAME:?Independently verified database name required}"
: "${APPROVED_CLUSTER_ID:?Independently verified cluster identifier required}"

COMMON=(
  --writers-stopped
  --expected-database "$APPROVED_DB_NAME"
  --expected-system-identifier "$APPROVED_CLUSTER_ID"
  --validated-release "$EVIDENCE/release-validation.json"
  --trust-config "$TRUST"
  --recovery-evidence "$EVIDENCE/fresh-recovery-signed.json"
  --fresh-state "$EVIDENCE/pristine-origin.json"
)
sh "$RELEASE/scripts/initialize-api.sh" prepare "${COMMON[@]}"

# These retain the ORIGINAL attestations and original migration guards.
# They are permissible only when the real signed evidence covers their truth.
: "${RECOVERY_SHA:?Digest of the real organization recovery JSON required}"
bash "$RELEASE/scripts/operator-retirement.sh" "${COMMON[@]}" \
  --backup "$EVIDENCE/recovery.json" --sha256 "$RECOVERY_SHA" \
  --restore-verified "$RECOVERY_SHA" --attest-restoration-rehearsal \
  --approve-retirement --external-consumers-reviewed --backup-durable \
  --retention-resolved --approve-phone-continuation

sh "$RELEASE/scripts/initialize-api.sh" finalize "${COMMON[@]}"
```

If the trust configuration specifies `admin_hostname`, add that exact value
with `--admin-hostname` **only to finalize**. No additional per-release human
`--approve-release` digest is needed on this evidenced fresh path. Normal CI
never runs this initialization sequence.

Required application secrets remain the existing production signing key,
Staff keyring/active ID/email index key, Directory keyring/active ID/index key,
Communication keyring/active ID and valid `SUPER_ADMIN_INITIAL_PASSWORD`.
Retain independent private key recovery. Nothing generates/replaces keys or
enables public registration, provider delivery or existing-account bootstrap.

## Failures, recovery and retained approval boundaries

- Unknown graph/policy, invalid/missing certificate, tampered artifact, bad
  identity, failed configuration/recovery or non-pristine prepare: stop, no
  authorization. Keep active services/volume untouched.
- Preparation uses its existing outer transaction. After commit, a MAC-bound
  private origin receipt records its exact snapshot. If receipt custody fails,
  preparation may be committed but continuation is blocked: retain maintenance
  and use reviewed operator recovery. Never create or edit an origin manually.
- No origin, changed predecessor, replayed evidence for another release/target,
  or newly inserted business records cannot authorize automatic continuation.
- Retirement still accepts only its existing supported states and stops at
  `0034`; interruptions after intermediate commits require operator review.
- Finalization retains its exact catalog, empty-table, unused sequence,
  Communication rows, transactional bootstrap and readiness checks. Failure
  rolls back that phase, not earlier committed phases.
- Keep the marker/lock and writers stopped until separately verified promotion
  and reviewed reopening. No automatic marker deletion, container restart,
  data deletion or volume reset is introduced.
- Existing manual procedures retain `--approve-release` and all their original
  protected approvals. Machine evidence is not an alternative approval for an
  existing database without authentic pristine origin.
