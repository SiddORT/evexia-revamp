# CI managed API startup: source-only repair

## Evidence and cause status

The supplied GitHub Actions screenshot shows both parameter cases of
`test_actual_managed_startup_without_preflight_and_security_failure` failing at
the liveness assertion: the child launcher returned 1 before health was observed.
Docker initialization passed; deployment was skipped. The screenshot contains no
child exception, because the fixture discarded both output streams.

Source inspection establishes an environment mismatch:

- `.github/workflows/release-validation.yml` installs frozen `uv.lock`
  dependencies into `.pythonlibs` and supplies its Python 3.13 `site-packages`
  through `PYTHONPATH`.
- `scripts/test-api-foundation.sh` adds the original backend to that path and
  runs pytest with `python3`.
- The managed-startup fixture previously deleted the entire `PYTHONPATH`,
  including the installed dependencies.
- `scripts/start-development-api.sh` restores the **clone's backend**, not the
  dependency path, and uses bare `python` for source review, database sync and
  Uvicorn. Database sync imports SQLAlchemy and Alembic; both it and the API need
  the installed packages. Explicit diagnostics use `sys.executable` in a child.

This mismatch is confirmed in source. A missing dependency at runtime is the
**probable, not confirmed**, explanation for the original exit. No existing
exception log was available, and no launcher or test has been executed for this
repair.

## Scoped changes

The fixture now supplies only existing `site-packages` / `dist-packages`
directories from the harness interpreter's search path. It never forwards the
original `PYTHONPATH` wholesale, the original backend, pytest's test directory,
or the current-directory entry. A private `python` shim invokes the exact
`sys.executable` running the tests, without resolving venv executable symlinks.
Thus the shell and Python diagnostic children use the harness interpreter and
its installed dependencies. The real shell launcher still adds the cloned
backend, starts in the artifact directory, reviews source independently, and
synchronizes only against the existing private disposable-database binding.

Output capture drains stdout and stderr together into an in-memory tail bounded
to 16 KiB; no raw log file is written. Failure reports include exit status (or
`running` at the health deadline), known stage markers, known exception types,
allowlisted missing modules, and selected source-frame locations. Unknown
messages, connection strings, environment dumps, source-code lines and exception
inputs are withheld rather than scrubbed by best-effort secret replacement.
At most 40 sanitized lines are reported. A sticky listener marker preserves the
negative signing assertion even if earlier output rolls out of the bounded tail.

Each launch owns a new process group. Cleanup signals only that group, including
descendants when the shell has already exited, escalates to kill as needed,
reaps the direct child, and joins the output reader. A cleanup exception is
attached to an existing failure without replacing it.

Both diagnostic parameter cases, health, authentication before and after manual
diagnostics, identity, and the missing-signing negative case remain enforced.
The negative case now also starts in the managed artifact directory.

No production code, launcher, CI workflow, dependencies, migration, database
binding, release policy, Docker check or authorization safeguard was changed.
No reviewed-source metadata update is required: the changed test files and this
note are not entries in either source-integrity manifest. Historical schema
evidence is untouched; no metadata refresh command was executed.

## Not verified

Only source and diff inspection were performed. Tests, builds, validation and
refresh scripts, launchers, migrations, browser checks, service restarts, live
database access, CI reruns, pushes and deployments were not performed. Added
plumbing tests are unexecuted. There is no green-CI or deployment claim.

## Narrow verification proposal — separate approval required

With the existing locked dependencies and PostgreSQL prerequisites installed,
approve just the following disposable fixture command:

```sh
nix-shell -p postgresql_17 --run 'sh scripts/test-api-foundation.sh tests/test_managed_startup_support.py tests/test_development_gate.py::test_actual_managed_startup_without_preflight_and_security_failure'
```

This would initialize/migrate a private socket-only synthetic database and run
the five plumbing tests plus both managed-startup parameter cases, including
their missing-signing launches. The existing fixture refreshes metadata **inside
its temporary source clone**. It does not authorize a shared-database probe,
managed workflow restart, full release suite, CI dispatch, push or deployment.
If startup still fails, the new sanitized diagnostics should identify the
failing stage or dependency class; retain the cause as provisional until that
evidence exists. Complete exact-commit CI validation remains a separate required
release step and needs separate authorization to execute.
