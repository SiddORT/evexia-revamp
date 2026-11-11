# Previous-order dosage lookup: original-workspace recovery handoff

## Current result

Recovery of the original development preview **has not been verified**.
This handoff is the fallback requested when the assigned task environment cannot
control that preview. No application code or dosage policy was changed.

Read-only observations on 2026-11-11:

- The task environment has no Uvicorn process, development API launcher, or
  listener on port 8080. Every configured workflow is `not_started`.
- The original development origin recorded in `.replit` returned HTTP 200 with
  `text/html`, not API JSON, for `/api/openapi.json`,
  `/api/v1/health/readiness`, and the next-dosage route using a zero UUID.
  These responses do not establish API readiness, endpoint registration, or
  authorized patient access. The origin may be inaccessible from this environment;
  the HTML response is not evidence that the API itself is missing the route.
- Current source registers
  `GET /api/v1/admin/immunotherapy-orders/patients/{patient_id}/next-dosage`
  with operation ID `getImmunotherapyNextDosage`.
- No original-workspace PID, supervisor, or occupied-port log is visible here.
  The stale listener and port conflict were reported in the task assignment,
  but could not be independently reconfirmed from this isolated environment.
- No authenticated MR session is available here. No login, password reset,
  order save, database write, or clinical-data change was attempted.

## Recover in the original development workspace only

Keep the user's existing order tab open. Do not reload it, clear storage, or
alter its patient, manual dosage, prescription selections, or draft values.

1. Inspect workflow states without starting anything. Do **not** press the
   Project run button: `.replit` wires it to release suites. Do not start
   frontend, Canvas, regression, release, or completion-check workflows.
2. Identify the process actually listening on 8080 and trace its parent chain.
   For example, use `lsof -nP -iTCP:8080 -sTCP:LISTEN` if available, then
   `ps -p <confirmed-pid> -o pid,ppid,lstart,args` and inspect its parent.
   Confirm its working directory belongs to this original checkout.
   Inspect recent output of the API workflow for the reported
   address-already-in-use error. Do not rely on process name alone.
3. Read the serving API's `/api/openapi.json`, requiring JSON, and check for
   the exact route above. Compare with the current checkout. If the endpoint
   is already present and readiness is healthy, do not restart unnecessarily.
4. If the confirmed stale listener belongs to
   `artifacts/api-server: API Server`, restart **only that managed service**.
   If an orphan listener is blocking its replacement, gracefully terminate
   only the individually confirmed stale API PID with SIGTERM, wait for it
   to release 8080, then start/restart only the managed API service.
   Never use `pkill`, `killall`, broad process groups, or guessed PIDs.
   If ownership cannot be established, stop and report it rather than killing.
5. Retain `scripts/start-development-api.sh` as the managed startup command.
   It sets the development environment and backend import path, refreshes
   source integrity metadata, and runs guarded automatic database sync before
   Uvicorn. Do not bypass these protections by launching Uvicorn directly,
   changing database targets or keys, or stamping a migration.
   With local uploads enabled, the launcher owns a scanner child and an API
   child and cleans them up when it exits. Limit any supervisor replacement
   to this API launcher; do not disturb independent scanner/services.
6. Inspect only this API's startup output. Require successful startup without
   port conflict, then require JSON readiness at
   `/api/v1/health/readiness` and the next-dosage route in live OpenAPI.
   Record the replaced and serving PIDs/start times and endpoint evidence.
   Check workflow states again to ensure no unrelated service or check started.

## Specific read-only verification

Use an existing authorized MR session in the original preview. Do not extract
or paste session cookies/tokens into logs, and do not create an account or reset
a password to obtain evidence.

- If a patient is already selected in an open new-order draft and lookup failed,
  use **Retry previous-order lookup** without changing the patient or dosage.
  Do not force a reload or overwrite a manual choice.
- Otherwise use a permitted patient only in an already available clean entry
  screen, without saving an order or draft.
- Inspect that GET request's response in the browser network panel:
  require HTTP 200 and a valid `suggested`, `no_history`, `end_of_series`, or
  `unsupported_dosage` result. Do not export patient details into the handoff.
- Confirm the existing dosage controls remain available when the form is not
  otherwise locked. Source keeps manual choices independent of lookup failure;
  this task did not change that behavior.
- A 401/403 proves neither authorized functionality nor recovery of MR access.
  A protected-route response is not a substitute for successful authorized
  lookup. If no authorized session is available, report this limitation.
- Do not save an order, infer clinical administration, widen MR scope, or
  modify progression to make the check pass.

## Checks deliberately not run

No regression/release suites, builds, typechecks, completion validation commands,
umbrella workflows, browser test runs, or app-preview screenshots were run.
No separate task API was started as a substitute for original-preview recovery.
