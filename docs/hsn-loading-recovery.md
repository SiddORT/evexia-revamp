# HSN list loading and original-preview recovery

## Source correction

HSN Master now uses a list-specific error explanation. A missing collection
endpoint, unreadable response, network failure or server failure describes an
HSN service/list-loading problem, not a deleted mapping or a retained draft.
Authentication and access-denial responses have their own list guidance.
Record mutations still use the existing missing-record, stale-write, conflict
and unknown-save explanations. The form and its draft state are unchanged.

## Initial observations from the task workspace

- Source registers `GET /api/v1/admin/hsn`.
- The coordinated declaration is `0096_hsn_master`, whose direct predecessor
  is `0092_quantity_hundredths`; unrelated staged branches are not its ancestry.
- A narrow read-only development database query returned
  `0092_quantity_hundredths`; `public.hsn_mappings` was absent.
- All configured workflows in this isolated task workspace were `not_started`.
  No Uvicorn process was available here to establish the original API's age.
- The previously reported original-preview HSN 404 and old API process were
  not independently re-observed from this fork.

During that initial investigation, no service was started or restarted, no migration or business write was
performed, and no production service was accessed. No tests, release or
regression workflows, compatibility/preflight commands, validation wrappers,
builds, typechecks or preview screenshots were run.

## Continuation: supplied preview was aligned

On continuation, the supplied preview was already running. Its HSN request
returned 401 `authentication_required`, not a route-level 404; Allergen returned
401 as well. Matching request IDs in the managed API logs connected those
external requests to the observed running API.

The existing startup lifecycle had emitted:

```json
{"result": "READY", "schema": "0096_hsn_master", "applied": ["0096_hsn_master"]}
```

Uvicorn reported successful application startup. A narrow read-only database
observation confirmed revision `0096_hsn_master`, the HSN table's presence and
zero saved mappings. The preview's served HSN page module returned HTTP 200 and
contained the list-specific error handler. No additional API restart or
migration invocation was needed or performed by the agent.

**Verification exception:** release workflows had also started automatically
before this continuation's first observation. The agent stopped all release
workflows it still observed running; others had already finished or failed.
None remained running at the subsequent workflow-state observation. Their
results were not used as verification, and no failed release checks were
investigated or repaired. Thus “no regression/release checks ran” cannot be
claimed for the whole task. No screenshot, build, typecheck, compatibility
command or new test invocation was performed by the agent.

No master records were created or changed for verification and no production
service was touched. The signed-in administrator list response and rendered
screen were **not** manually observed: access to the user's existing browser
session was unavailable. No replacement login, fabricated credential or
permission bypass was used. Zero saved mappings implies an expected empty
state, not direct evidence that an authenticated screen rendered it.

## Original-workspace recovery procedure if the issue recurs

This source change alone is **not** evidence of a repaired original preview.
After merging, perform the following only in the original development workspace:

1. Confirm `development-contract.json` still declares `0096_hsn_master`.
   If it has advanced, stop and review the newly reachable migration scope;
   this repair does not authorize unrelated staged activation.
2. Confirm the managed API workflow command remains
   `sh ../../scripts/start-development-api.sh`. Restart **only**
   `artifacts/api-server: API Server`; do not use Run All, restore all previews,
   invoke a screenshot tool, or start any release workflow.
3. The existing API lifecycle refreshes source-integrity metadata and runs
   the bound development synchronizer before importing the API. Retain its
   target binding, locks, transaction, integrity and historical guards.
   Never invoke that migration lifecycle from this task fork, stamp the
   revision, bypass a blocked guard or run compatibility/release checks.
4. Inspect the API startup output for committed `READY` at
   `0096_hsn_master` and successful Uvicorn startup. If synchronization fails,
   report the sanitized blocker rather than working around it. Confirm no
   release workflows were started.
5. Using narrow read-only requests against the original preview, confirm
   unauthenticated `GET /api/v1/admin/hsn` reaches authentication (normally 401),
   not a route-level 404. In an already authorized administrator session,
   open HSN Master and confirm the list GET returns a valid page and the
   screen displays existing mappings or its legitimate empty state.
   Do not create, edit, activate, inactivate or seed records for verification.

For this continuation, schema alignment and route registration were observed
at the supplied preview. Only the signed-in list/screen observation remains
unverified; the recovery procedure above is not a request to restart an
already aligned API again.
