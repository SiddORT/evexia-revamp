# Staff and MR email invitations

## Eligibility and credentials

Only the authenticated protected Super Admin can invite or read Email Logs.
Staff business Role/Designation labels, including “Super Admin”, confer no
permission. An invitation never assigns a custom role, enables workspace access,
changes a directory's active status, or creates/converts an MR identity.

Save first, then explicitly choose **Invite by email** on the saved record.
Staff must be active, not deleted, have a valid saved email, and have both an
assigned custom role and workspace login enabled through Access. MRs require
an active saved server directory entry and its explicitly provisioned active
MR account. Browser-local legacy rows are never bound by matching labels.
Missing email/access, stale records, ineligible accounts and a current send have
actionable messages. Failed delivery never undoes a successful record save.

Add Staff accepts Password and Confirm password, visibility controls and Auto
generate using the MR policy: 12–128 characters, no trimming or extra complexity
rules. Generation uses browser cryptographic randomness and fills both inputs.
Only the initial save result can reveal a credential; stored hashes cannot be
redisplayed. Leaving the password absent creates an unguessable server-generated
credential and marks the new account as requiring password setup. The same
rule applies to newly provisioned MRs without an initial password. Recovery can
also complete that setup. Direct MR credential reset explicitly completes it.
Staff access must still be assigned separately.

Accounts created with an entered/generated initial password remain usable when
otherwise eligible. Inviting an existing usable account does not disable it,
change its password, or revoke its sessions before successful acceptance.

## Set-password links

The server owns the HTTPS recovery origin/path from `PASSWORD_RECOVERY_URL`.
Invitation links add only `invitation=1&portal=admin|mr` outside the fragment.
Their fragment carries a purpose-separated signed credential, bound to account,
portal, identity version, credential version, recipient and a random nonce.
The link expires after exactly **15 minutes**. Emails never contain passwords.

`POST /api/v1/auth/set-password` accepts the same bounded token/new-password
shape as recovery; it cannot accept a recovery-purpose link. Origin protection
and IP rate limiting apply. The browser immediately replaces the token-bearing
fragment, keeps the credential only in component memory, and does not report it
to analytics or persist it in browser storage. The correct login portal comes
from the successfully validated credential, not from an editable query string.

Acceptance locks and revalidates the account/directory/access and recipient,
hashes the password, clears setup-required state, increments the credential
version and revokes existing sessions in one transaction. Concurrent use cannot
succeed twice. Changed, expired, wrong-purpose, consumed or now-ineligible links
fail with a neutral message asking for a new invitation. Issuing another invite
does not revoke a previous still-valid link; successful acceptance invalidates
all links bound to the old credential version.

MR Forgot password continues to use the existing recovery event, generic public
responses, eligibility checks and 15-minute version-bound single-use mechanism.
There is no public Super Admin recovery or public arbitrary-recipient send
endpoint. The protected Super Admin saved-template test action is separate from
account workflows and cannot create tokens; see [email templates](email-templates.md).

## SMTP outcomes and Email Logs

Explicit Staff/MR invitations use only the saved default Email SMTP configuration
in Settings → Communication. Password recovery retains environment-configured
TLS SMTP. Recovery resolves `password_recovery`;
the verified invitation identity resolves `account_invitation` for staff/Admin
and `mr_invitation` for MR. Both live invitation kinds retain the existing signed
token/delivery purpose. No hardcoded-content or cross-role fallback is used.
See [email templates](email-templates.md) and [recovery](password-recovery.md).

`POST /api/v1/admin/reporting/invitations/{staff|mr}/{record-id}` requires the
record's `expected_version` and explicit administrator confirmation. It records
an encrypted attempt before SMTP work. A recent pending/sending attempt blocks
another send; issuance is bounded to five attempts per account per 15 minutes.
There is no automatic replay on authentication renewal, request timeout, crash
or uncertain submission. If the browser loses the response, inspect Email Logs
before explicitly reopening an invitation action.

The profile dropdown's **Email Logs** report uses a POST filter body (not URL
history) with UTC date range, purpose, status and exact case-insensitive recipient
email, plus bounded limit/offset. It displays historical encrypted recipient,
purpose/portal, template identity/version, actor or self-service origin,
timestamps, correlation reference and safe failure category. Pagination and
summary counts use one SQL snapshot of the same filtered set. Recipient search
uses a purpose-separated keyed equality index; it is deliberately not substring
search. Staff/MR and unauthenticated callers cannot read this report.

Saved-template test sends use the distinct `template_test` purpose/filter and
retain the selected ID/version before SMTP, with fictional role-appropriate
samples and a nonfunctional reserved-domain action URL. Historical invitation
records keep their existing purpose and selected shared-template ID/version;
they are not rewritten to imply the new MR template was used historically.
Template tests and explicit invitations share one server-only per-attempt
snapshot of the saved default Email SMTP configuration in Settings → Communication:
host, port, verified STARTTLS or implicit TLS, username, encrypted credential,
sender address and sender name. Invitations require the existing trusted
`PASSWORD_RECOVERY_URL` shape independently of SMTP selection, but do not
require environment SMTP values. There is no fallback to environment SMTP or
another saved server, and no decrypted transport cache beyond the attempt.
Password recovery retains its existing environment SMTP and full recovery-URL
validation. Saving/selecting a default never sends on its own.

Missing defaults (`saved_smtp_missing`), API/Platform defaults
(`saved_smtp_unsupported`), security `none` (`saved_smtp_insecure`), invalid
configuration/credentials (`saved_smtp_invalid`) and unreadable encrypted data
(`saved_smtp_unavailable`) fail before SMTP handoff. Invitation responses and
protected Email Logs show fixed Settings → Communication guidance; no credential,
saved field value or internal exception is exposed. Correct the configuration
or restore encrypted storage access as appropriate, inspect Email Logs, then
explicitly request another invitation if needed. No automatic retries occur.

Statuses mean:

| Status | Meaning |
| --- | --- |
| Pending | Persisted before preparation/dispatch |
| Sending | Dispatch started; outcome not yet confirmed |
| SMTP accepted | The SMTP server accepted submission, **not inbox delivery** |
| Failed | Definite rejection or pre-handoff configuration/template/preparation failure |
| Unknown / interrupted | Submission may have occurred; never automatically replay |

Pending/sending records older than two minutes are presented as
unknown/interrupted. SMTP DATA acceptance remains accepted if subsequent QUIT
cleanup fails. If terminal persistence fails after handoff, the record is never
relabeled as a definite preparation failure. No open/click/bounce metrics or
“delivered” status are invented. Public recovery configuration failures create
an anonymous failed/configuration record without looking up or recording the
submitted identifier. Requests for unknown accounts remain generic and do not
invent a recipient delivery attempt.

Only metadata and fixed categories enter audit/operational events. Passwords,
tokens, token URLs, SMTP credentials, rendered bodies and raw exception messages
are excluded. Recipient snapshots use existing directory key custody with new
mail-specific AAD and equality-index domains. Keep all historical decryption keys:
existing directory/account rotation inventories do not rewrite Email Logs.

### Saved invitation SMTP handoff — source only

The invitation transport change was inspected in source only. No tests, builds,
browser/manual scenarios, runtime requests, workflow restarts, migrations,
credential/default changes, deployments or email sends were performed. Existing
historical verification below does not validate this changed path.
No retention deletion or general-purpose queue/retry service is introduced.

## Schema and focused acceptance

`0053_email_invitations` follows the merged `0052_hq_mr_zones_merge` head.
It adds setup state and the encrypted delivery ledger and seeds exactly one
protected invitation assignment without changing edited recovery content.
Existing unassigned template names are preserved even on a seed-name collision.
The bounded template library grows to 101 to accommodate the additional required
record without discarding an already-full library.

The development contract, generated schema declaration, source-integrity review,
automatic-migration policy, fresh-install catalog/review and release target are
coordinated. The fresh catalog digest is an actual PostgreSQL 17.5 disposable
catalog observation, not guessed ORM metadata. This is not release approval.

Focused verification commands only:

```sh
sh scripts/test-api-foundation.sh tests/test_email_invitations.py
sh scripts/run-authenticated-previews.sh artifacts/evexia-portal/tests/email-invitations.preview.spec.mjs
```

The first command passed **17 focused cases**, including staff chosen/generated
passwords, staff/MR invitations and sign-in, MR recovery and sign-in, invalid and
reused credentials, concurrent committed consumption, template edits, real MIME/
TLS construction with a fake SMTP socket, failure logging, protected assignments,
recovery-edit preservation and report counts/authorization. The second used
private synthetic API/Vite/PostgreSQL listeners and captured mail: all positive
onboarding/logging assertions passed. Its final staff-denial text locator failed
because the existing boundary redirects to `/admin` instead; the assertion was
corrected to that observed code contract, not rerun. Backend access denial passed.
No broad suites, release gates, engine matrices, real SMTP or inbox delivery were
verified.

**Managed-runtime acceptance remains a separate post-merge requirement.**
The task fork's disposable database/application both declared and ran 0053.
That does not prove the original development database or running API is current.
Do not point a fork at the original database or bypass its target identity checks.
After merge, use the existing automatic `scripts/post-merge.sh` /
`scripts/start-development-api.sh` lifecycle in the bound original workspace.
Then obtain the actual database revision and successful API readiness response,
verify they equal the running API schema declaration and development contract,
and confirm actual frontend readiness/revision at the normal same-origin ingress.
Use the existing `verify-running-release.py --development` read-only report when
appropriate; it is not a replacement for the database identity/revision evidence.
If migration or readiness fails, report that blocker instead of replaying an
uncertain migration or calling a successful source build acceptance. No original
development migration, activation or after-merge runtime evidence is claimed by
this fork, and no production access or operational real-recipient test was made.
