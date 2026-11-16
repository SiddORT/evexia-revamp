# Pricing scope loading — category-change crash repaired in source

## Evidence and limits

The Add Pricing Rule form sends scope generation to
`POST /api/v1/admin/pricing-rules/combinations/generate`.
For All Categories / PD / Individual the body contains:

```json
{
  "categoryId": null,
  "categoryScope": "all",
  "dosage": "PD",
  "size": 1,
  "allergenIds": null,
  "query": "",
  "offset": 0,
  "limit": 25
}
```

No price or date is required by `CombinationGenerate`. Those fields belong to
`CombinationSave`, not catalogue generation. The source service already forms
the complete eligible category-local singleton scope, including Mix and No Mix
members. The existing listener's previously reported OpenAPI advertisement of
all-category generation is not evidence that the endpoint is missing, nor does
it establish which validation or business rule rejected the screenshot request.

At source inspection time the API route file, exported OpenAPI and portal
already agreed on pathname category IDs for allergens and price history.
The earlier reported query/path drift was no longer present in this working
tree. Query-form compatibility readers have also been retained as hidden aliases
using required `category_id` query parameters, the same response models,
authorization dependencies and service functions. Canonical pathname readers
and their published operation IDs are unchanged; no generated contract changes
are required for these non-advertised compatibility aliases.

No running API process was present in the inspected process list. No original
failed generate response/status or correlated request record was available in
the initial supplied context. Therefore the original generic banner's runtime rejection
cannot honestly be classified as request validation, scope rejection, service
failure or response incompatibility from this inspection alone.

The subsequently supplied screenshot identifies a separate, concrete frontend
failure: `ReferenceError: setCountOpen is not defined` in `chooseCategory`.
Source inspection confirmed that category changes still called this obsolete
setter although the associated state/control no longer exists. Removing that
call lets the scope-change action finish without this ReferenceError, keeping
the existing selection, search and paging resets. It does not introduce new
state, skip generation or require an MRP/date. The screenshot proves this local
failure; it does not identify any earlier server rejection behind the generic
banner, and no such rejection has been reproduced.

## Prepared changes

- Removed the undefined legacy `setCountOpen` call from category changes.
- Read transport distinguishes bounds, invalid/changed selections, permission
  failures, throttling, unavailable services, route/version mismatches and
  invalid response contracts. It does not echo arbitrary error messages or
  submitted field values.
- Known validation field locations include combination scope fields; an API
  rejecting `categoryScope` as an extra field can be identified as incompatible.
- Loading errors are separate from save errors and displayed next to the scope
  controls. Smaller-scope guidance is emitted only for `combination_bound`,
  never added speculatively to every failure.
- Strict generation response validation remains mandatory. Invalid stored
  monetary response strings produce malformed-response errors rather than
  instructions to enter a price during catalogue loading.
- Retry uses the same scope and review page, retaining draft prices/date and
  the original eligibility baseline. Changed baseline evidence still blocks
  saving until explicit discard/reload.
- Frozen save bodies, idempotency keys, durable rejection handling and unknown
  save locks are unchanged.
- A valid empty response remains a visible zero-rule catalogue, not a transport
  failure. Category-local Mix-only pairs/triples, singleton Mix/No Mix semantics,
  complete-request limits, saved history, schema readiness and authorization
  are not relaxed. No order activation or historical repricing is introduced.

## Runtime limitations

If a service-side loading error persists after the source repair is loaded,
obtain the failed generate request's HTTP status, safe error code and
validation field locations (without credentials or submitted prices), or its
existing correlated server error. That is needed to determine whether any
additional repair is necessary beyond the prepared route/error handling changes.
An OpenAPI document alone cannot prove which runtime validator is executing.

The supplied affected-page address was used for one unauthenticated read-only
GET of `/api/openapi.json`. It returned HTTP 307 to Replit's access gate, not the
application's OpenAPI document. The redirect was not followed and no sign-in,
authenticated application request or scope-generation request was attempted.
This access response is not evidence about the original generation failure.

Verification was limited to source/diff inspection and that read-only GET.
No regression/release checks,
builds, typechecks, completion/validation wrappers, browser/registered preview
capture, live saves, migrations, service starts/restarts, deployments or
production writes were run. Changes have not been loaded into a running API
and this is not a verified live fix. Loading updated source into services and
any later runtime verification require a separately authorized operational step.
