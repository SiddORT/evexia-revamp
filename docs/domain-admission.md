# EVEXIA exact-host ownership and admission

## Release boundary — not production readiness

This code introduces coordinated schema `0037_domain_admission` after
`0036_reference_privacy`. It is **operator-only**, not an unattended migration.
No live DNS, TLS, ingress, VPS, managed database, deployment or production
account change is authorized by this implementation. Do not push `main` or any
deployment-triggering ref: the existing GitHub workflow deploys to the VPS.
The historical hostname-only approval ends at `0031_role_hostnames`; it does
not authorize this release or any intervening operator-only migration.

## Independent concepts

1. **Configuration:** Super Admin saves one primary hostname and exact
   Admin/MR/Doctor role mappings in Settings → Role URLs. Shared database state,
   server-attributed changes and optimistic versions apply across browsers.
   Primary is the chooser and existing path entry, not an Admin identity.
2. **Ownership:** a cryptographically random 256-bit TXT value is checked at
   `_evexia-verification.<exact-hostname>`. Neither a syntactically valid name,
   an old mapping, a working resolver, nor a recovery allowlist entry proves DNS
   ownership. The protected Settings API alone exposes challenge instructions.
3. **Admission:** after verification, Super Admin must explicitly Activate.
   A role host also requires its current mapping to be enabled. Revocation,
   disabled/removed/edited role mappings, primary replacement and expiration
   stop dynamic admission. No suffix, wildcard, parent-domain or inferred host
   approval exists.
4. **Infrastructure:** DNS binding, TLS certificates, HTTPS redirects,
   upstream connectivity and deployment readiness remain operator work.
   Verification/activation do not prove or perform these steps.

Doctor remains a mock preview. No new identity grants, SSO, parent-domain
cookies or tenant model are introduced. Authentication and permissions are
still enforced by the existing identity/session services.

## Recovery and deterministic precedence

Production startup requires nonempty `PORTAL_BOOTSTRAP_HOSTS`, a comma-separated
list of exact canonical public hostnames independently approved by the operator.
Keep at least one unchanged recovery hostname reachable with working HTTPS and
same-origin `/api` before changing primary or role admission. Preview metadata,
Origin and forwarding headers never add approved production hosts.

Recovery hosts admit transport and retain existing path routes, returning
`role: null`, even if a legacy role row exists for the same name. They never
assign a role or claim ownership. New role assignments to them are refused.
They do not skip resolver database/schema checks, identity checks or permissions.
The chooser shows an explicit retry error if resolution is unavailable; it does
not silently select Admin. Admission of recovery HTTP requests can work during
a database outage, but resolution and authentication still fail.

Next precedence is an active, unexpired verified primary (no role), then an
active, unexpired verified enabled role mapping. Anything else is denied in
production before resolver/authentication processing. Primary and enabled-role
configuration collisions return 409 without deleting the mapping. Disable the
conflicting mapping first; existing historical attribution is retained.

**Legacy transition:** the new table starts empty. Existing role rows, versions,
timestamps, creator/updater IDs and audits are unchanged but do not admit those
hosts. Plan recovery access first, then challenge, verify and explicitly activate
each required exact hostname. Simply enabling an old mapping does not activate
it. Mapping changes invalidate its ownership/admission record and require a new
challenge. Previously approved bootstrap access is not DNS verification.

## TXT lifecycle and limits

Challenges last 24 hours; rotation invalidates previous values and immediately
removes existing verification/admission. Verification lasts 30 days from the
successful server check. There is no background polling or implicit renewal:
plan manual renewal before expiry, retaining recovery access. Checking DNS again
requires a live challenge; renewal after its expiry requires a new challenge.
A verification check, including an unavailable/failed result, removes activation;
activate again only after successful verification. A revoke clears the challenge
and verification evidence and requires a new challenge.

The OS DNS resolver configuration is operator-controlled. Only exact validated
TXT names are queried, never arbitrary URL fetches, browser-provided resolvers or
DNS writes. Lookups have a 1-second attempt timeout and 3-second total lifetime,
no search expansion, at most 32 TXT records and 8 KiB of TXT payload. CNAME
redirection is not accepted as exact-name proof. The challenge name must fit DNS
length limits. Absent/wrong TXT is failed; resolver errors/limits are unavailable;
both preserve actionable Settings feedback and cannot activate a host.

DNS actions have a persistent 30-second per-host cooldown and 30 challenge/check
starts per actor in 15 minutes. Network I/O holds no database/user locks. Its
completion revalidates the actor and exact hostname/challenge/mutation version
and expiry under the cross-domain transaction lock. Changed/deleted/replaced
records cannot be verified by a late result. Audits retain actor/session/request
and stable domain-record IDs, safe outcomes/reasons, never TXT values, DNS payloads
or credentials.

## Host and proxy contract

All supported API entrypoints explicitly disable Uvicorn proxy processing
(`--no-proxy-headers`, or `python -m app.serve`). Do not replace that flag with
Uvicorn's default trust behavior or `FORWARDED_ALLOW_IPS=*`.
The outer raw ASGI boundary rejects missing/duplicate/malformed Host values,
lists, wildcards, trailing dots, userinfo and suffix bypasses before auth.
Valid ports do not extend hostname approval.

`TRUSTED_PROXY_PEERS` is empty by default. Only exact socket-peer IPs listed by
the operator may supply a **single** `X-Forwarded-Proto: http|https` and must
supply exactly one `X-Forwarded-For` containing a plain IPv4/IPv6 client address.
Missing, duplicate, chained, scoped or malformed client addresses from a trusted
peer return 400 before authentication. This address supplies the existing
per-client login/recovery quotas, not hostname admission or authority.
Forwarded, X-Forwarded-Host and X-Real-IP never affect the API's policy.
All forwarding metadata is removed after the trusted boundary consumes it;
untrusted peers cannot change client identity or scheme. Trusted peers must
overwrite, never append, client identity/proto and must not be directly
accessible to untrusted peers.
Do not globally trust a subnet, arbitrary container network, Origin or preview
metadata. Configure exact ingress peers and verify with the actual topology.
Keep existing production HTTPS-only CORS, Secure `__Host-` host-only HttpOnly
SameSite=Strict cookies, and same-origin auth. No cookie Domain attribute.

Dynamic admission performs no cached allowlist lookup; database query/lock
timeouts fail closed. Unknown hosts return 421; malformed Host returns 400;
policy failure returns 503 without authentication side effects or directory
disclosure. A query hostname must equal the current accepted request hostname;
the public resolver is not a challenge directory or arbitrary role lookup.
Health/readiness probes must use an exact bootstrap Host. There is no anonymous
arbitrary-host health exemption.

## Portal nginx and development servers

The repository nginx template requires the standard `http_auth_request_module`
(present in the nginx image) and connectivity to the existing `backend:8080`.
Every static asset/SPA deep link is checked by an internal, no-cache API
`/api/v1/portal/admission` subrequest with the original raw Host and no credentials.
Only production admission returns 204. Any denied or unavailable policy prevents
static delivery; nginx may render its generic 500 for a non-2xx auth subrequest.
The internal check is not externally callable. No generated/stale static
Settings allowlist can disagree with activation/revocation. `/api/` proxies to
the existing backend with original Host; the API independently guards it.

The nginx template ignores client proto by default. If the TLS ingress sends
traffic through this HTTP frontend, an operator may mount reviewed files in
`/etc/nginx/trusted-proto/*.conf` containing exact map entries, for example:

```nginx
"10.0.0.9:https" https;
```

This is an example private IP, not an approved actual ingress. Independently
set API `TRUSTED_PROXY_PEERS` to the exact frontend socket IP (and any directly
connected approved ingress IP). Alternatively retain ingress routing of `/api`
directly to the API with its own exact trusted-peer configuration. Verify
same-origin login/refresh/logout over real HTTPS. No Compose topology changes
are required or performed by this task. Do not pass through client proto by
default to make HTTPS appear to work.

The frontend always overwrites API `X-Forwarded-For` with its socket client's
address; caller-supplied XFF chains are never relayed. If another ingress sits
before nginx, configure it to overwrite **X-Real-IP with one actual client IP**
and separately mount an exact peer entry in `/etc/nginx/trusted-client/*.conf`:

```nginx
10.0.0.9 1;
```

The example is not actual operator approval. With no entries nginx ignores
X-Real-IP and uses its socket peer. A trusted ingress missing/invalid client
metadata fails closed at the API rather than silently sharing the ingress IP's
quota. Configure both trusted-client and trusted-proto maps as needed; neither
grants hostname approval. Any direct trusted API ingress must itself overwrite
the single-IP XFF. Do not mark end-user socket peers as trusted proxies. Verify
two distinct clients retain separate login and recovery quotas through the real
ingress before activation; no live ingress configuration is performed here.

Vite development accepts only loopback, explicitly configured `EVEXIA_DEV_HOSTS`
and the exact development `REPLIT_DEV_DOMAIN`; preview mode is loopback-only.
A raw-host development middleware also prevents Vite's implicit all-IP
allowance. Production must use the guarded nginx/API serving configuration,
not Vite preview. Private preview credential forwarding remains narrowly scoped
to the exact HTTPS development origin; production resolver credentials remain
omitted. No external redirects or mounted-editor polling redirects are added.
Mounted drafts survive failed reloads; uncertain/stale mutations require
explicit reload and review, never automatic replay.

## Separately approved rollout and rollback

Before any execution, an operator must review the exact release, pending
migration graph/policy, backups and restoration evidence, target database,
maintenance window and recovery host/TLS/proxy/ingress configuration. New
fresh-install metadata is source review, not approval to execute on a database.
No historical migration or historical encryption field inventory is changed.
Existing account/directory maintenance accepts only this reviewed storage-
compatible successor, not arbitrary future revisions.

Apply `0037_domain_admission` only through the separately authorized migration
procedure after all predecessor approvals. Readiness requires the coordinated
application head (currently `0038_purchase_orders`), not just 0037 and the
domain-policy table. The separately reviewed [fresh-install candidate](fresh-install.md)
includes empty-only finalization through 0038; it is not approval for any
populated production database or for domain admission. Then independently verify DNS TXT,
admission, TLS, exact proxy peers, same-origin API routing, health Host,
SPA deep links, role incompatibility, cookie isolation, and rejection/revocation
at every actual ingress, including any direct API/static listener.

The new migration can downgrade to `0036_reference_privacy`: this drops primary
configuration and all new DNS/admission evidence, not legacy role mappings or
audit history. Back up that state first. A code rollback to pre-admission
servers would remove these guards and could reactivate legacy routing: never
treat schema downgrade alone as a safe security rollback. Keep ingress fail-
closed, recovery access and a coordinated separately approved rollback plan.
