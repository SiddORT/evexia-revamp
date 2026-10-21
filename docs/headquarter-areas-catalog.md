# Headquarter zones/areas schema metadata

The full PostgreSQL 17.5 catalog at `0051_headquarter_areas` was generated
from the unchanged migration ancestry through `0050_opening_stock`, followed by
the new forward migration, in a private Unix-socket-only disposable cluster.
No production migration or deployment was performed.

The existing `app.services.fresh_catalog.digest` projection produced
`1435d1825b687f211b41c25a03bbd3077cb08837cea7482be4a10ef50be090a9`.
The complete observed public table list is recorded alongside that digest in
`scripts/fresh-install-catalog.json`. Historical catalog entries were retained.

During synchronization with main, the independently merged `0051_mr_zones`
revision introduced a second source head. Both applied revision files were
preserved unchanged. No-op `0052_hq_mr_zones_merge` reconciles the two branches
and is the final coordinated declaration. Applying the incoming MR migration
and no-op merge to the same isolated cluster produced catalog digest
`ea5f0d620cc5178afd5d044960307c652387f796e8f415d3ff548ffe2dc8d44b`.
Its observed table list includes both `headquarter_areas` and
`mr_zone_assignments`; the narrow catalog entry and release metadata were
regenerated without automated verification. Earlier manual HQ CRUD observations
below remain evidence for the HQ branch, not a new MR acceptance run.

This is schema-metadata generation, not a fresh-install acceptance run,
automated test result, CI signature, release approval or deployment evidence.

## Manual CRUD observations (2026-10-21)

All feature CRUD used the isolated cluster, a synthetic protected account and
records explicitly named `DISPOSABLE HQ CRUD …`; no original business records
or real accounts were changed by these requests. Individual authenticated HTTP
requests, with responses inspected directly, confirmed:

- Creating two active disposable Zones and reading HQ-authorized choices.
- Creating one HQ with three areas allocated MU1/MU2/MU3; a separate read
  returned the same identities, Zone and codes.
- Changing Zone, editing an area name and a trimmed manual code (`CUSTOM-7`),
  removing MU2 and adding MU4; a separate read preserved the saved result.
- Renaming the HQ and changing its State Code to NX without changing any saved
  codes; manual NX9 caused a new automatic area to receive NX10.
- A stale version status write returned 409; duplicate normalized area names
  returned 422. Neither advanced the parent version.
- Inactivating only the disposable assigned Zone, retaining that association
  on full edit, removing saved NX10 and adding NX11 without reuse.
- Active choices excluded the inactive Zone. HQ status change and soft deletion
  succeeded; subsequent detail returned 404 and ordinary listing returned no HQ.

No scripted assertions, test harnesses, builds or benchmarks were invoked for
these operations. Protected form interactions, browser suggestion behavior,
staff-only sessions, deleted-Zone retention, transfer round-trips and concurrency
were not exercised in a browser. The static preview capture reached sign-in,
not the changed protected form, and is not feature-verification evidence.

When the managed preview was restored, the environment unexpectedly started
its preconfigured release workflows. Logs showed `release-policy-02` launching
`sh scripts/test-fresh-install.sh` and `release-coverage` reporting registration
coverage. All running `release*` workflows were stopped on discovery; their
results are not used as verification. No configured completion validation should
be run for this manual-only task.

The same automatic service startup reported applying `0051_headquarter_areas`
to its bound development target. That was not an explicit migration command
against the original database. This observation does not establish post-merge
original API/frontend/schema alignment, production readiness or release acceptance.
