# Shared encrypted Communication configuration

## Email template storage is separate from transport

Settings → Email templates uses its own PostgreSQL `email_templates` table and
Super Admin APIs, described in [Email templates](email-templates.md). Eligible
password recovery reads the protected `password_recovery` template automatically,
but still sends through the existing environment-configured verified-TLS SMTP
transport. Neither template edits nor Communication defaults change SMTP provider,
sender, credentials or trusted recovery origin. SMS templates retain their local
storage and preview-only behavior. No browser-local email records are imported
or erased.

## Original-development activation — 16 October 2026

Separately approved activation completed against the independently confirmed
original development database: `heliumdb` on `helium`, cluster
`7689828272860483604`, database OID `16384`. Only `0039_communication`
was applied from exact predecessor `0038_purchase_orders`; no migration
policy, existing migration, production/VPS database or transport was changed.

Before DDL, the migration advisory mutex and SHARE locks excluded concurrent
application writes. A fresh full archive was restored on a separate socket-only
PostgreSQL cluster; all **36 tables / 1,668 rows** matched. The exact pinned
migration was rehearsed there, preserving existing table contents, before
execution on the original locked connection. Existing table contents were
compared again before committing. The user separately confirmed a saved and
checked private recovery copy of the new dedicated Communication keyring and
active ID. Key contents were not printed or put in the backup reports.

Private App Storage retains the backup and separate recovery/activation evidence
under the existing operator recovery transport's historical namespace:

```
.private/operator-recovery/purchase-orders/evexia-communication-activation-kun1gqy8/
  before-0039.dump
  recovery.json
  activation.json
```

Archive SHA-256:
`1e6372785222e7a57af9a56d5062e1784e2a282300f45f41d81d6b15004d735c`.
Authenticated storage readback matched; anonymous access was denied.
Local `/tmp/evexia-communication-activation-kun1gqy8` working files are not the
durable backup location. The rehearsal cluster was stopped.

After restart, the managed launcher needed an explicit inherited backend import
path: Uvicorn's own `--app-dir` did not make `app` importable to the runtime
preflight child when launched from the artifact directory. The launcher now
exports that path; the existing real-process regression runs from the artifact
directory without inheriting the test harness's `PYTHONPATH`. No readiness or
authentication checks were bypassed.

Browser verification also exposed an integration gap in the new fetch wrapper:
portal lookup uses a `URL` object, whose address must be classified just like a
string or `Request` before attaching the development contract header. The
wrapper now handles all three standard input forms without changing same-origin
restrictions, failure blocking or credential handling.

Verification:

- Development gate unit checks: **6 passed**.
- Disposable backend gate and Communication tests: **36 passed**.
- Frontend compatibility, fetch-input regression, portal resolver and
  Communication service/form checks: **23 passed**.
- Shell syntax and `git diff --check`: passed.
- Post-merge setup, candidate schema/configuration checks, and actual running
  preview ingress/readiness verification: passed.
- Live preview health, readiness, compatibility, Super Admin login/current
  user, Communication listing and Purchase Order listing: **HTTP 200**;
  verification logout: **204**. Requests used the required development contract
  header, just as the frontend does. Its absence remains blocked.
- Public Admin login page rendered after the launcher and fetch-wrapper fixes,
  without a portal-resolution or development-setup error.

The three structural channels exist; there are no saved Communication
configurations. No provider calls, real emails, order mutations or new delivery
activation were performed. No full release gate or authenticated browser
interaction suite was run for this operation.

For managed development preview, missing or invalid Communication keys or the
required schema block the coordinated release gate. That gate does not activate
this storage or grant migration approval. See
[development release compatibility](development-release-gate.md).

Settings → Communication is restricted to the protected system Super Admin.
It manages Email (SMTP, API and Platform), SMS and WABA records centrally.
It does **not** send messages, probe providers, onboard OAuth accounts, verify
credentials, or activate delivery. Default means selected configuration only.
The existing environment-configured password-recovery SMTP transport is unchanged;
neither that sender nor any other sender reads these tables.

## Operator-controlled activation

This change supplies migration `0039_communication` after `0038_purchase_orders`.
It is classified `operator_only`. Do not run it on a managed/shared database
without separate approval, a database backup and a coordinated API/frontend rollout.
There is no startup migration or automatic key provisioning. The coordinated
schema head/readiness moves to this revision; older schemas are not ready for
this application release. Readiness additionally requires valid Communication
keys and the new storage projections. Missing keys must not be bypassed to
make readiness green.

Provision `COMMUNICATION_ENCRYPTION_KEYS` and
`COMMUNICATION_ENCRYPTION_KEY_ID` through workspace **Secrets**, separately for
each approved environment as appropriate. The first is a JSON object mapping
key IDs to base64-encoded, independently generated 32-byte AES keys. The second
selects an existing key ID (1–32 ASCII letters, digits, underscore or hyphen).
Use cryptographically random key material generated by the operator's approved
secret-management process. Do not put keys in source, chat, database rows, logs,
or migration files. Do not reuse signing, staff/directory encryption, SMTP or
provider credentials. There is no signing-key fallback. No existing secrets are
changed by this implementation.

Before approving activation, confirm that the required database revision,
key custody and deployment configuration agree. The focused disposable tests
do not activate or certify a shared/production installation.

## Storage and recovery

All user-entered values (including name, port/security selection, host/provider,
endpoint, sender/account identifiers and username) are serialized into an
authenticated randomized AES-256-GCM payload. The credential has its own
authenticated ciphertext. Each ciphertext carries format version and key ID;
associated data binds it to record UUID, channel, type and payload/secret purpose.
Ciphertext swaps and tampering fail closed. Business values have no plaintext
columns or equality indexes.

Only structural data remains plaintext: record UUID, channel/type, default flag,
optimistic versions, timestamps and creator/updater UUIDs. The channel-state
table contains three structural channel/version rows. Mutation audits contain
action, actor/session/resource UUIDs, request correlation, outcome and timestamp,
never configuration values, credentials, request bodies or plaintext snapshots.
Record ciphertext is hard-deleted on deletion; retained safe audit metadata
does not include a credential copy.

Keep every decryption key required by live data **and retained database backups**
in separately protected recovery custody. A database dump alone cannot recover
these records. Validate database-and-key recovery in a separately approved
isolated environment before depending on it operationally. Retiring a key,
rotating keys, deleting backups or changing retention requires separate work
and approval; this feature supplies no rotation/import/export tools.

List/detail responses decrypt non-secret configuration fields only for authorized
reads. Credentials are write-only: only `credentialPresent` is exposed. An omitted
or null edit credential retains the saved credential; a type change requires a new
one. Empty credentials are rejected by the API. The browser sends a nonempty
replacement once and never automatically retries a write. Edit inputs start
empty; transient credentials clear after submission/cancel/type change/unmount.
Non-secret drafts survive validation failures/conflict recovery.

## Consistency and failure handling

Up to 100 configurations per channel are read in bounded snapshots. Channel
versions plus record versions prevent stale writes. Mutations lock the three
pre-seeded channel rows in stable order, including first-create/last-delete,
and a partial unique database index enforces at most one default per channel.
The first create becomes default; replacing/deleting a default is transactional.
A default with other records cannot be deleted without an explicit same-channel
replacement. The last deletion leaves no default. Configuration changes and
safe audit entries commit or roll back together.

Conflicts and uncertain responses require an explicit reload and review. The
editor retains its non-secret draft and shows current saved details before
allowing another write. A missing edited record cannot be silently recreated.
Missing/invalid keys, unknown key IDs or corrupt ciphertext block CRUD without
fallback. Errors and logs never echo submitted field values or unknown property
names. Do not enable request-body/SQL parameter logging in surrounding infrastructure.

Legacy `evexia.admin.communication.v1` browser data is untouched and unused:
no automatic migration, upload, reset, mirroring or deletion occurs. New shared
configuration tables start empty.

## Focused verification

Run from workspace root:

```
sh scripts/test-communication-crud.sh
```

This invokes **only** `tests/test_communication.py` in a disposable PostgreSQL
cluster (via the existing fixture launcher), then the Communication service and
in-process JSX form CRUD tests. Synthetic keys/credentials are test fixtures only.
The PostgreSQL server uses a private temporary Unix socket and is removed afterward.
No shared services are started/restarted, no managed migration is executed, and no
live provider is contacted. No system, end-to-end, broad regression, delivery or
provider-connection tests are part of this command. Historical browser preview
tests describe the superseded local demo and must not be used to validate this
shared storage implementation.
