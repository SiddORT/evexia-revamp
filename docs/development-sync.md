# Coordinated development updates

## Routine development

`development-contract.json` is the **authoring source** for the schema target.
`app/core/schema.py` is generated as a literal for existing operator tools.
Fresh-install finalization uses that same requirement. Retirement still stops
at `0034_shared_phone_countries`; preparation still stops at `0031_role_hostnames`.

When adding a migration:

1. Author its revision and dependencies and explicitly classify it in
   `scripts/migration-policy.json`. Unknown revisions fail closed.
2. Add/test its exact fresh catalog projection. Additive catalog reviews may
   extend an earlier frozen projection; every added row must match exactly.
3. Set `development-contract.json`'s schema, then run:
   `python -B scripts/review-schema-release.py --refresh`.
   This updates source fingerprints/derived targets, **not** release signatures,
   recovery attestations, production approvals or migration classifications.
4. Run the affected migration/fresh-install tests and the release checks.
   CI checks the coordinated declaration before issuing signed release evidence.

After a merge, setup installs locked dependencies and runs
`scripts/development-sync.py`. The platform reconciles managed workflows.
The API launcher repeats the idempotent synchronization and runs preflight once;
the frontend launcher waits for and verifies the actual newly running services.
`pnpm verify:development` repeats the explicit, read-only running-version check.
There are no recurring browser compatibility probes or page-wide quarantine in
normal development. Existing authentication and operation-level checks remain.

## Automatic development migration boundary

The checked-in database binding identifies the approved **original development**
host, port, database, cluster ID and database OID. All must match; a task-copy,
standby, unexpected version state or production configuration is rejected.
Only a single, known applied revision on the reviewed single-head graph qualifies.

Every pending revision, including dependencies, must be classified `automatic`.
Any protected dependency returns **42 before applying anything**. An empty
database is not migrated through protected history by this runner; use the
supported reviewed fresh-install procedure.

Automatic code is additionally restricted to a conservative additive AST
allowlist: nullable columns without defaults, new tables and ordinary indexes.
SQL execution, arbitrary Python/helpers/imports, alterations, drops, backfills,
defaults and concurrent index operations are refused. This is not a replacement
for code review; deliberately keep the allowlist narrow.

The runner uses the existing migration advisory lock, bounded writer-drain/table
locks, one caller-owned transaction and the explicit reviewed target (never
`head`). Schema/runtime readiness is checked before commit. Failures roll back
DDL and revision changes. There is no automatic downgrade, stamping, reset,
bootstrap, retired-table approval or production fallback. Ordinary additive
development upgrades need no repeated human approval or full backup rehearsal.
Historical protected revisions retain their existing operator process.

## Running-version proof

`/api/v1/version` includes a backend fingerprint captured at process load, covering
the schema/contract, application Python and locked Python dependencies. It does
not relabel an old process from the current Git checkout.

Vite captures a frontend source/dependency identity at startup/build and serves
`release-runtime.json`. Production builds additionally list exact compiled asset
SHA-256 hashes. The explicit verifier checks live backend identity, actual DB
readiness, served frontend metadata, and, for builds, actual HTML/JS/CSS bytes.
Git equality, an HTTP 200 health socket, and container labels alone cannot pass.

Production CI still checks protected migration policy **before replacing any
service** and preserves exit-42 blocking. Once allowed, it deliberately recreates
only backend/frontend, compares actual running image IDs with candidate image IDs,
and verifies runtime identities and asset bytes before reporting promotion.
Expected frontend metadata comes from the built candidate image, never from
the active server. A post-promotion runtime failure is a deployment failure,
not an inferred safe database downgrade.

This does not grant production permission. Signed release/artifact-integrity
checks, pristine-target checks, independent recovery evidence, production
operator-only approvals, and PostgreSQL volumes are unchanged. Do not use the
development launcher on a VPS. No routine process forcibly reloads a draft tab;
open an updated tab when a frontend update requires a full page reload.
