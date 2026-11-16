# Live MR dashboard

## Scope and deferred definitions

The existing `/mr/home` route keeps the MR navigation shell, saved display
identity and financial-restriction feedback. It replaces only the old dashboard,
including its fictional activity feed. Settings, Targets and unrelated demo
workflows retain their behavior.

| Surface | Scope |
| --- | --- |
| Total Orders, six statuses, order-type distribution, recent orders | Selected April–March financial year or quarter; submitted, saved orders owned by authenticated MR |
| Currently Assigned Doctors | Current nondeleted MR-owned Doctor directory, including inactive Doctors as the ordinary directory does |
| Currently Assigned Patients | Current MR-visible active Patient references: active nondeleted Patient Directory and identity owner, active nondeleted assigned Doctor and saved MR ownership |
| Annual target and four quarterly panels | Entire selected financial year; explicit quarter date ranges |
| Monthly and quarterly achievement graphs | Entire selected financial year regardless of order-period selection |
| Total Sales, Gross Sales, Actual Sales, Due Amount | **Unconfigured**: em dash, “Definition pending” and type split pending |

Financial definitions must be supplied separately. None of those four cards
uses achievement, invoice totals, collections, Parking/contribution snapshots,
payment flags or inferred debt as a substitute. They remain visible even when
the reporting request fails. Directory counts do not change their meaning with
historical order periods or order types. MR does not gain generic Patient-master
access; the Patient total matches the existing eligible reference surface,
not Admin's broader Patient directory or historical order participants.

## Read-only contract

`GET /api/v1/mr/sales-achievement/dashboard`

- Inputs: optional `start_year` (1–9998; server's current Kolkata financial year
  when omitted) and `period=all|Q1|Q2|Q3|Q4`. No MR selector.
- Uses existing authenticated MR-self authorization, active saved identity,
  directory graph validation and financial/lifecycle locks. Admin and staff
  cannot use this endpoint.
- The dashboard database dependency initializes PostgreSQL repeatable-read
  **before** the token-identity dependency reads through the same cached request
  session. All widgets use one snapshot and one connection; no isolation change
  is attempted after authentication queries. A consumed initialization marker
  prevents the reporting service from silently running without this boundary.
  Concurrent changes that cause serialization failure produce an explicit
  unavailable response. Authorization locks require a normal read transaction,
  not PostgreSQL's `READ ONLY` mode. No business rows are inserted or changed.
- Response is `no-store` and includes authenticated `mrId`, resolved year,
  period and date bounds for client verification.
- `orders` and `statuses` have `label`, `total` and four `byType` rows (`IT`,
  `Kit`, `SPT`, `Lupin`), each with count and decimal-string percentage of that
  card's total. Zero denominators return `"0.00"` and all types remain present.
- `directory` contains only two scalar counts, computed in SQL using
  `doctors.predicates`/`owned_clauses` and `mr_orders.reference_scope` plus the
  reference endpoint's active/nondeleted Patient predicates. No directory is
  downloaded or decrypted to count people.
- `annual` and `quarters` include period bounds, target state and amount,
  approved-order total, known sales, unavailable-price count, completeness,
  remaining target and percentage.
- `monthly` contains all twelve chronological `YYYY-MM` entries with
  `knownSales`, `unavailableOrders` and `amount`; `amount=null` when incomplete.
- `recent` contains at most six own selected-period saved orders: source-qualified
  key, number, kind, date, normalized status. No amount, patient, contact,
  attachment, approval actor, contribution or server-provided URL is exposed.
  Order-list links are selected locally from a fixed four-type allowlist.

Period order counts and status splits are SQL aggregates over each of the four
saved order tables. `Draft` SPT rows and the separate incomplete-draft storage
are excluded. `Confirmed`/`Saved` display as **Pending**; legacy `Approved`
displays as **In process**. Shipped, delivered, rejected and returned states are
included wherever supported. Unexpected saved statuses fail rather than vanish.
Kits-to-MR orders are included: there is no Doctor join or recipient restriction.
The recent feed retrieves six candidates per type, then sorts by saved date and
source-qualified key descending and takes six globally. This bounded list does
not supply any report-wide aggregate.

## Achievement is unchanged

The dashboard shares the existing target-selection helper, approval whitelist,
`saved_total` extraction and exact Decimal/BigInt arithmetic used by Targets.
Eligible statuses are `Approved`, `In process`, `Shipped`, `Delivered`; saved owner
and order date govern attribution. Pending/draft/rejected/returned orders never
contribute. Saved authoritative payable amounts are not catalogue-repriced.
Kits continues using saved invoice pricing, not protected contribution evidence.

Annual/quarterly target state remains active, missing, inactive or deleted.
Active zero targets are genuine zero targets, not missing targets; their
percentages remain unavailable. An unavailable historical price contributes no
invented zero: known sales are labeled incomplete, definitive percentage and
remaining are null, monthly amount is null and incomplete chart series are not
plotted. Remaining is floored at zero. Percentages retain actual values over
100%, with only decorative progress fill capped.

Full-year approved-order decryption is capped at 20,000 orders across all types,
streamed in batches of 200, and has a 15-second application scan budget. Counts
are checked before decryption. SQL/lock timeouts are finite (the existing crypto
readiness policy may tighten SQL timeout further). Exceeding a bound is an error,
not a truncated report. Since achievement is full-year context, selecting an
order quarter cannot reduce that scan; the message directs the user to the
existing shorter-period Targets report instead. No performance claim is made.

## Client and accessibility

The portal uses the existing memory-only authenticated MR transport and session
renewal behavior. Strict dashboard validation binds the response to saved MR
identity and requested period, checks count/type/status partitions, target
arithmetic, annual/quarterly/monthly consistency and bounded recent records.
Failures never become zero. Abort signals, identity/session epoch and keyed
render guards hide old data immediately when identity, period or refresh changes.
Refresh/retry and focus/visibility/page-return reads provide freshness without
polling. During loading or failure, old reports are hidden rather than silently
reused.

Order disclosures use a separate MR component modeled on the Admin pattern;
there are no Admin fixtures/imports or Admin navigation. Hover, focus and touch
open four-type splits. Escape/outside press dismiss; fixed panels are clamped
and scroll within the visual viewport without shifting cards. Directory cards
are never split by order type; deferred financial splits remain pending.

Charts are local React/SVG, with chronological monthly columns, grouped quarterly
comparisons and selected-period order distribution. Monthly/quarterly tables are
available through keyboard-operable view switches; distribution has its table
alongside the graph. Money uses exact decimal strings in text and normalized
bounded ratios only for geometry. Semantic theme tokens preserve Classic/Modern
and light/dark support. Responsive grids and reduced-motion rules are scoped to
this dashboard.

## Offline contract maintenance

Only the new route and its referenced schemas are merged into the canonical
JSON-formatted OpenAPI file:

```sh
python3 -B scripts/export-api-contract.py --scope mr-dashboard
pnpm --filter @workspace/api-spec exec orval --config ./mr-dashboard.orval.config.ts
```

The dedicated generator emits additive client/Zod modules without rewriting
unrelated refined contracts or invoking the standard wrapper's typecheck.
The portal's transport remains the existing MR-specific authenticated transport,
not a second token store or an unguarded generic hook. Generated modules are
also available from the shared library barrels.

## Delivery verification boundary

Source inspection covered authorization/assignment predicates, all four order
types including Kits-to-MR, draft/status compatibility, exact saved amounts,
partial-price handling, fiscal boundaries, bounded reads, minimal projections,
period/session races, disclosure events, responsive CSS and theme tokens.

Only the scoped offline OpenAPI export and dedicated direct Orval generation
were executed. No tests, regression/release suites, builds, typechecks,
completion-validation commands, browser/runtime requests or screenshots,
managed preview activation, service starts/restarts, migrations, business writes
or deployment were run. Generated output is not validation evidence.

Authenticated API execution, PostgreSQL snapshot/locking behavior, encrypted
historical prices, real directory permissions/counts, session renewal, graphical
layout across sizes/themes and keyboard/touch behavior remain **unverified at
runtime** and require separately authorized verification.
