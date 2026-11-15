# Doctor Master loading incident — 15 November 2026

## Demonstrated cause and correction

The authorized `GET /api/v1/admin/doctors?limit=10&offset=0` returned HTTP 500
(`internal_error`). The separate `/filters` and `/references?limit=100&offset=0`
reads returned HTTP 200. The listing failure was therefore sufficient to make
the combined frontend load fail; neither successful reference read could hide it.

A narrow invocation of the same listing service, using an identity validated
from a real inspection-account login, located an `AttributeError` for `hq` in
`doctors.projection`. The listing supplies its MR data through
`patients.doctor_context`, whose bounded scalar query selected the MR's Zone
but omitted the HQ field consumed by the Doctor projection.

The correction adds `MRDirectory.hq` to that existing scalar selection. It
does not substitute the MR's HQ for the saved Doctor location, infer missing
assignments, bypass encryption/readiness, change permissions, or suppress errors.
There is no schema or business-data mutation in the correction.

## Serving process and schema

At inspection, Uvicorn PID 985 was the sole API listener on port 8080; the
portal's Vite listener was PID 835 on port 25965. Routed observations used the
shared proxy at `http://localhost`, not a second API or frontend listener.
The serving API's source identity was
`ccfe171de5a448f113a8659668e2d613590ea09b1839f211d66bf317e15829bf`;
the development database reported `0108_doctor_mr_mapping`.
The earlier duplicate-listener failures were not the demonstrated cause.

Only the API service was restarted to load the query correction. Its replacement
process was PID 3341; `/api/v1/version` reported source
`928b6ae27636c1ff1d84a3452e7297e172c92bc6cd310046add506c3c8ca2076`
and the same schema. Startup reported `"applied": []`; no migration was applied.

## Narrow observations performed

- Authorized HTTP reads after correction: listing HTTP 200 with four Doctors;
  filters HTTP 200; MR references HTTP 200 with five choices.
- Repeated the same three reads with the Refresh request parameters: all HTTP 200.
- One isolated local Chromium page observation through the shared proxy:
  signed in with the inspection account, opened Admin Doctor Master, observed
  “Showing 1–4 of 4 doctors” with no loading-error fallback, clicked the actual
  **Refresh records** button, and observed the same successful count.
  Listing, filters and MR references returned HTTP 200 on both page load and
  button refresh. No business-edit actions were taken.
- Checked existing workflow logs after the API restart. The API started cleanly;
  the release workflows remained stopped.

These observations cover the reported Admin listing and refresh only, not
cross-browser behavior, unrelated directories, editing, imports or production.
No screenshots, broad browser tests, regression/release commands, aggregate
workflow restarts, completion-validation commands or deployments were requested
or launched by the executor.

## Pre-existing release execution

The initial process/workflow inspection found release runners already active,
with start times preceding the inspection commands. They were stopped immediately
after discovery. Existing logs nevertheless show that some checks had executed
and failed before they were stopped. Those failures were not investigated,
repaired or rerun. Thus this incident must not be described as evidence that no
release checks ran anywhere in the environment.
