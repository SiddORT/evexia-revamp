# Shared encrypted Communication configuration

## Email template storage is separate from transport

Settings → Email templates uses its own PostgreSQL `email_templates` table and
Super Admin APIs, described in [Email templates](email-templates.md). Eligible
password recovery reads the protected `password_recovery` template automatically,
but still sends through the existing environment-configured verified-TLS SMTP
transport. Neither template edits nor Communication defaults change the recovery
SMTP provider, sender, credentials or trusted recovery origin.
Explicit template test sends and Staff/MR invitations use only the saved default
Email SMTP configuration, including its encrypted credential and sender, with
verified STARTTLS or implicit TLS. Missing/unreadable/invalid settings, API/Platform
defaults and security `none` prevent those sends without environment fallback.
Invitations retain trusted recovery-URL validation independently of saved SMTP;
template tests remain fictional and token-free.
See [template test transport](email-templates.md#explicit-saved-version-test-emails).
SMS templates retain their local
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

Development compatibility diagnostics are manual-only; they do not run on preview
access or normal API startup. Mandatory security configuration and operation-level
integrity remain enforced. See
[development release compatibility](development-release-gate.md).

Settings → Communication is restricted to the protected system Super Admin.
It manages Email (SMTP, API and Platform), SMS and WABA records centrally.
Saving or selecting a default does **not** send messages, probe providers, onboard
OAuth accounts or verify credentials. The separate, explicitly submitted template
test and Staff/MR invitation actions read the default Email SMTP configuration.
API/Platform, SMS and WhatsApp delivery are not activated. Password recovery's
environment-configured SMTP transport and validation remain unchanged.

## Current migration and key-provisioning policy

The historical activation above describes the policy at that time. The current
standing policy in `replit.md` and [migration automation](migration-automation.md)
makes migrations automatic in development and VPS startup, retaining target,
locking and historical integrity guards. Migration `0039_communication` is the
historical introduction, not the current schema head. Automatic migration does
not provision, replace or recover encryption keys, authorize destructive data
repair, or grant permission to access production. Missing keys must not be
bypassed to make readiness green.

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

### Development recovery investigation — 22 October 2026

**Final status: development access restored by explicitly approved reset, not
decryption recovery.** See the final verification below. Initially, a bounded read-only transaction
against the selected development database confirmed revision
`0053_email_invitations`, all three structural channels and one saved configuration.
The current shell keyring passes `CommunicationCrypto` validation. Both ciphertext
envelopes have valid version/encoding/minimum length, and both stored key IDs
are present and select the active key. Both fail AES-GCM authentication with the
current record UUID/channel/type/purpose binding. No configuration values,
credentials, key material, connection strings or ciphertext were recorded.

This rules out absent tables, malformed envelopes and a missing key ID for this
observation. It does **not** distinguish changed key bytes from changed binding
metadata or damaged ciphertext. The available Git history shows no change to the
Communication encryption/binding implementation since its introduction; that
does not prove the stored metadata or keys never changed. Keyring validation and
readiness alone do not prove existing ciphertext is decryptable.

All managed workflows were stopped in the task workspace at investigation time;
no API process was available to compare effective loaded settings or reproduce
an authenticated live request. The shell observation is not evidence of the
original running portal's configuration. No services, migrations, save/reload,
provider checks or delivery were run. No stored records or secrets were changed.
Invitation/recovery SMTP selection and write-only credential behavior are unchanged.

The separately held original keyring and active ID confirmed in the historical
activation are the next recovery source. The listed private archive predates
Communication storage and is not a backup of the subsequently saved configuration;
its reports contain no encryption keys. Do not search source, chat or logs for keys
or treat a database archive as key custody.

The custodian subsequently confirmed an original recovery copy was available and
supplied a separate `COMMUNICATION_RECOVERY_CANDIDATE_KEYS` secret, leaving the
active keyring unchanged. Its JSON structure, key IDs and base64 encoding passed
bounded checks, but at least one decoded key was not 32 bytes. The candidate
therefore failed `CommunicationCrypto` validation and was not used at that stage
to decrypt or repair records.

The custodian then identified `openssl rand -hex 32` as the generation command.
A read-only diagnostic confirmed every candidate value was a 64-character hex
representation. Converting those values to base64 **in memory only** produced a
valid independent keyring, different from the current keyring, but neither saved
field authenticated with it under the current binding. Thus encoding explains
the candidate's validation failure, but correcting that encoding does not recover
the record. No secret was rewritten. The custodian subsequently confirmed the
command was run again to create this candidate: it is newly generated material,
not a recovered historical key. Its failed authentication is therefore not
evidence about the original key or ciphertext integrity. Recovery remains blocked
pending the actual original material; changed binding or damaged ciphertext also
remain unresolved. Re-running a random generation command cannot reproduce an
earlier key. Do not install this candidate as a recovery fix.

The user initially chose to leave the configuration unchanged. That pause did not
authorize a reset. The subsequent explicit reset authorization and its execution
are recorded below; it does not grant permission for future resets.

On resumption after secret entry, managed services and several release-check
workflows were observed running without being launched by this investigation.
The running release checks were stopped; their incidental startup is not focused
Communication verification and no passing-suite claim is made. The earlier
stopped-runtime observation remains time-specific, not a current runtime finding.

Recover through workspace Secrets, never chat: first compare the original
operator-held keyring against a read-only copy of the affected ciphertext and
its exact binding metadata. Do not overwrite an existing key ID with newly
generated material. If original material authenticates the records, reconcile
the runtime keyring with the custodian while preserving every historical version
needed by other live records and backups. Settings are process-cached; a confirmed
secret correction requires restarting the actual managed API. Check its effective
configuration and selected development target, then verify an authenticated
Communication load and a controlled same-values edit/reload with the credential
omitted. Assert credential retention privately and write-only API responses;
do not print decrypted fields or send messages. If original material still fails,
compare trusted historical ciphertext and binding metadata before proposing any
repair. If original material is unavailable, retain the failure and records:
reset/re-entry requires separate explicit authorization and preservation planning.

### Explicitly approved development reset and verification — 22 October 2026

The user subsequently stated the old data was unused and explicitly requested
deleting it and confirming development with the new keys. After explaining that
the old saved fields and credential would be permanently discarded, the operation:

- Confirmed the selected database matched the configured development fingerprint,
  remained at `0053_email_invitations`, contained exactly one unreadable
  configuration, and retained the three expected channel rows.
- Confirmed the actual managed API's inherited Communication keyring and database
  matched the shell configuration. The active keyring passed validation. It was
  used unchanged; the separately supplied hex recovery candidate was **not**
  installed, converted into a saved secret, or used as an active key.
- Deleted only the one unreadable configuration in a transaction, locking the
  three channel rows and affected record, advancing the affected channel's version,
  and retaining a metadata-only `communication_delete` audit with
  `operator_approved_reset`. The maintenance audit has no fabricated application
  actor/session. No tables, historical audits, other configuration domains or
  invitation/recovery SMTP settings were deleted or changed.
- Added only the independently observed current development preview origin to the
  development sign-in allowlist, retaining prior origins and restarting the managed
  API once. Startup required no new schema migration.

An initial login using the configured bootstrap email returned **401**. A private
read-only comparison established that the saved protected administrator's current
email differs from that bootstrap value, while the configured initial password
still matches. Verification used the saved identifier internally with the normal
login API; neither account data nor credentials were changed or printed, and
authentication was not bypassed.

Actual HTTPS development-preview requests then verified:

- Health/readiness: **200**; protected Super Admin login/current identity: **200**.
- Communication empty list: **200**.
- Temporary synthetic SMTP configuration create: **201**; list reload and detail:
  **200**, with the expected saved values and write-only credential indicator.
- Same-values edit omitting the credential, followed by list reload: **200**.
  A private read-only check verified both ciphertext fields use the active key,
  decrypt correctly, and the omitted credential was retained. No decrypted values,
  credentials or key material appear in the recorded results.
- Temporary record deletion: **200**; final list: **200**; final database counts:
  **zero configurations, three channels**. No synthetic provider configuration
  remains. Verification logout: **204**.

The public login screen also rendered; this screenshot is not claimed as an
authenticated Communication UI test. The managed HTTPS API roundtrip is the
save/reload evidence. No provider connections, messages, transport activation,
production access, deployment, Git push, key rotation or broad diagnostic suite
was intentionally run. Earlier incidental release-check startup is disclosed
above and is not part of this acceptance evidence.

The task-completion gate subsequently invoked the project's configured broad
release commands and rejected completion. Failures included
`python3 -B scripts/local-release-checks.py run services`, `api-password-recovery`,
`api-role-urls`, `api-shared-phone` and multiple directory suites. Observed
failures include historical fixtures missing current `users.password_setup_required`
or Headquarter zone columns, outdated MR constructor fields, and current catalogue
validation rejecting older fixtures. These results are not a passing release
certification and were not bypassed. Fixing unrelated suites or changing the
configured completion checks requires a separate scope decision; it does not
invalidate the successful focused live Communication roundtrip recorded above.

Original ciphertext recovery remains unproven and was superseded by the
user-approved deletion. The evidence does not establish whether original key
replacement, binding changes or ciphertext corruption caused the old record's
authentication failures. There is no demonstrated application encryption defect,
so encryption validation and application behavior were not weakened or patched.
Keep the valid active keyring in independent private custody before saving real
replacement configurations.

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
