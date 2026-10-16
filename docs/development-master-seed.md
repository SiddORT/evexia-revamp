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

All are active. Allergens reference the seeded categories/locations and include
different concentrations, prices, GST rates, mix flags and a zero-price sample.
MRs reference seeded zones/headquarters/designation; Doctors reference those
MRs; Patients reference those Doctors and have matching MR ownership.
Emails use reserved example.com addresses. Patient phones use UK
regulator-reserved drama numbers; MR/Doctor optional phone fields are blank.
Names, postal addresses and clinical details are fictional demonstrations.

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

The seed never creates Vendors, Purchase Orders, receipts, stock movements,
opening balances, sales, files or browser-local demo records.

## Actual execution evidence

Executed against the independently confirmed development database, schema
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
