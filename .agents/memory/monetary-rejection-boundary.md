---
name: Monetary rejection boundary
description: Reject excess monetary precision before database coercion instead of silently rounding financial targets.
---

Financial input described as “at most two decimals, without rounding” must be
rejected rather than normalized through a fixed-scale database cast.

**Why:** PostgreSQL fixed-scale NUMERIC rounds values before CHECK constraints
observe them. A two-decimal CHECK on NUMERIC(p,2) therefore cannot reject the
original three-decimal input. The API boundary alone does not protect direct or
future database writers.

**How to apply:** For exact rejection contracts, validate the original JSON/file
lexeme and retain an unconstrained numeric value until explicit finite, range
and fractional-precision checks run. Preserve exact string/Decimal/BigInt
arithmetic through previews and exports. Do not “simplify” this into a
fixed-scale column without changing the business contract.
