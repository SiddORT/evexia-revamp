# Fictional development master seed

The explicitly requested shared master samples are independent of Purchase
Orders activation. Run from the workspace root against the **confirmed
development database only**:

```sh
python scripts/seed-master-data.py --development-database-fingerprint 657aa853ec339b46b45717e1e0dbe45f
```

The fingerprint is a non-secret MD5 target identity check combining database
name, database OID and the protected administrator UUID. It is not a credential
or cryptographic authorization mechanism. Confirm it separately through the
development database connection before targeting a different database:

```sql
SELECT md5(current_database() || ':' ||
 (SELECT oid::text FROM pg_database WHERE datname=current_database()) || ':' ||
 (SELECT id::text FROM users WHERE is_protected_system_admin));
```

Do not substitute a disposable database, copy a target from production, or
change application environment settings to bypass the development restriction.
The command requires a ready supported master schema, an existing active
protected administrator, and matching account/directory encryption state and
keys. It does not migrate, bootstrap, reset, grant permissions, or change keys.

## Records

All names start with **Master Demo**. The dataset contains:

| Master | Records |
| --- | ---: |
| Zones | 3 |
| Storage Locations | 3 |
| Product Categories | 3 |
| Allergens | 8 |
| MRs | 3 |
| Doctors | 3 |
| Patients | 6 |
| Headquarters (MR dependency) | 3 |
| Designations (MR dependency) | 1 |
| Vendors | 3 |
| Sales Targets | 3 |
| Doctor Opening Balances | 3 |

All are active. Allergens reference the seeded categories/locations and include
different concentrations, prices, GST rates, mix flags and a zero-price sample.
MRs reference seeded zones/headquarters/designation; Doctors reference those
MRs; Patients reference those Doctors and have matching MR ownership.
Emails use reserved example.com addresses. Patient phones use UK
regulator-reserved drama numbers; MR/Doctor optional phone fields are blank.
Names, postal addresses and clinical details are fictional demonstrations.
Vendor names explicitly say Fictional; contacts use example.com and UK
regulator-reserved drama numbers. Their unique GST values are syntactically
valid demo identifiers, not verified business registrations.

Sales Targets and Doctor Opening Balances use the fixed **2026–2027**
financial year, never the current date. One target links to each existing demo
MR; one balance links to each existing demo Doctor. Exact decimal strings
pass through the current validators and service insertion helpers. The database
generates annual totals from the four quarters; the seed refuses a missing or
different generated expression.

| Demo suffix | Q1 | Q2 | Q3 | Q4 | Generated annual total | Doctor opening balance |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Alpha | 100000.25 | 125000.50 | 150000.75 | 175000.00 | 550001.50 | 12500.25 |
| Beta | 80000.00 | 90000.10 | 100000.20 | 110000.30 | 380000.60 | -3500.50 |
| Gamma | 0.00 | 25000.01 | 35000.02 | 45000.03 | 105000.06 | 0.00 |

Fresh MR accounts and Patient owner rows are created only to satisfy normal
master enrollment contracts. Existing identities are never linked/promoted or
modified. Initial MR passwords are random, hashed through the backend password
helper, and never printed or written to files. They are deliberately not
recoverable through this seed; use the existing Admin MR password-reset action
if demo MR sign-in is later needed. Rerunning never resets credentials.

## Safety and attribution

This is a privileged local operator command, analogous to the existing local
identity operator, not an API route or a fabricated authenticated web session.
It uses the existing protected administrator as the required record
ownership/attribution anchor. Per-master create audits have no session ID and
carry request marker `development-master-demo-seed`; a separate
`operator_master_demo_seed` event with no claimed web actor distinguishes the
operator execution. Normal HTTP authorization is unchanged.

The command uses current input validators, service insert/enrollment helpers,
assignment checks, encrypted ORM setters and account identifier reservation
checks. All mutations, dependency rows and audits commit in one transaction.
Concurrent master writes are excluded briefly with table/graph/policy locks;
lock waits are bounded. Normal reads remain available.

Existing exact matching fixtures are skipped. Name/identifier collisions,
changed values, inactive/deleted history or different identity/owner linkages
abort without modifying the saved records. Encrypted name preflight includes
deleted history and refuses directories above 10,000 records rather than
silently checking only a partial directory. No tables/data are deleted.
Vendor matching independently checks normalized name and GST across all
history (at most two matches per indexed query). Both must identify the same
single record or both be absent. Target and balance matching checks MR/year
and Doctor/year, respectively, including deleted history with a two-row
ambiguity bound. All new masters share the transaction's writer locks.
Inactive/deleted, changed or ambiguous matches abort rather than being restored.

The seed never creates Purchase Orders, receipts, stock movements, actual sales,
payment history, accounting ledgers, files or browser-local demo records.

## Actual execution evidence

Original baseline execution against the independently confirmed development database, schema
`0037_domain_admission`:

- First successful run: **33 inserted, 0 skipped**.
- Immediate rerun: **0 inserted, 33 skipped**.
- Separate development read-only counts confirmed 3 zones, 3 locations,
  3 categories, 8 linked allergens, 3 account-linked MRs, 3 linked Doctors
  and 6 owner-linked Patients.
- Earlier unsuccessful executions rolled back; none committed partial fixtures.
- **No tests, browser automation, builds, benchmarks or migrations were run.**

These are seed execution and persistence-read results, not UI or test-suite
verification. Purchase Orders activation remains a separate operation.

### Additional-master execution — 2026-10-16

The independent development database read and application connection both
returned fingerprint `657aa853ec339b46b45717e1e0dbe45f`. The installed revision
was `0038_purchase_orders`; the required masters and generated annual column
were already present. Exactly one active protected Super Admin and ready
account/directory encryption were confirmed without exposing secrets.
No schema activation or Purchase Order operation was needed.

| Requested master | Inserted | Skipped | Immediate rerun inserted / skipped |
| --- | ---: | ---: | ---: |
| Allergens | 0 | 8 | 0 / 8 |
| Vendors | 3 | 0 | 0 / 3 |
| Sales Targets | 3 | 0 | 0 / 3 |
| Doctor Opening Balances | 3 | 0 | 0 / 3 |

The remaining 25 existing dependency fixtures were skipped on both runs.
Total first extension run: **9 inserted, 33 skipped**; immediate rerun:
**0 inserted, 42 skipped**. Both runs performed bounded post-commit reads of
all 42 expected records in a read-only consistent snapshot, checking exact
business values, generated totals and the new financial references.
Separate read-only queries through the development database connection returned
the three expected active/non-deleted vendors, the three MR/year targets with
the quarterly/generated totals above, and the three Doctor/year signed balances.
This was the intended development database, not a disposable task database.

Use the command at the top for a safe rerun. Any changed, inactive, deleted or
conflicting fixture blocks the transaction; do not reset data to make it pass.
If commit succeeds but confirmation fails, the command explicitly reports that
the transaction committed and asks for a safe rerun, not a reset.

**No tests were added or run. No browser automation, builds, benchmarks,
migrations, production writes, key changes or permission changes were performed.**
