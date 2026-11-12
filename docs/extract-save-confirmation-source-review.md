# Extract & Dilution save confirmation — source review

## Diagnosis and correction

The backend `ImmExtractWrite` validator runs `volume()` on each non-null
Extract/Dilution field. That uses exact decimal half-up rounding and emits two
decimal places. Both frontend confirmation boundaries previously compared those
saved strings with the raw submitted strings. A successful write could therefore
be reported as an invalid response because formatting or approved rounding differed.

Both boundaries now derive their expected rows through the same scoped,
side-effect-free helper before dispatch. The helper uses the existing BigInt
quantity normalizer with the backend volume maximum. Only expected input values
are normalized: returned quantities still require strict string/null equality.
Editing and backend persistence are unchanged.

## Static trace (not executed)

- Integer and short-decimal sources gain exactly two saved decimals.
- Three-to-six fractional digits follow the existing exact half-up rule, including
  carries into the whole part; no floating-point conversion or tolerance is used.
- The six-whole-digit/six-source-decimal grammar is checked before compatible
  leading zeroes are removed, matching backend `Volume` followed by `volume()`.
- Explicit null stays null. The editor maps blank to null before submitting.
  Explicit zero becomes `0.00`, never null.
- Negative, signed, exponent, whitespace, non-string and over-precision sources
  are rejected. Original and rounded quantities must both remain within
  `999999.999999`; a carry to `1000000.00` is rejected. Positive sources rounding
  to zero remain rejected.
- Every Extract and Dilution field is checked independently at Single rank 1,
  Double ranks 1–2 and Triple ranks 1–3. Missing, extra or reordered positions
  cannot be confirmed.
- Both layers retain category, dosage, policy and next-version checks. The
  service also retains its response and legacy-evidence shape validation.
  Noncanonical response strings and genuinely different quantities remain
  unconfirmed, even if rounding them would produce the expected amount.
- On confirmed success the existing editor adopts the authoritative response
  for both saved state and editable rows, clearing dirty state.
- Delivery uncertainty, malformed success responses and conflicts continue to
  retain edits and block another save until explicit reload-and-compare.
  Reload retains edits and displays authoritative saved values alongside them.
- HTTP 422 guidance now describes six source decimals, two saved decimals,
  half-up rounding, the minimum positive result and blank-versus-zero semantics.

## Limits

This was source/diff inspection only. No tests, builds, typechecks, release
checks, runtime/browser probes, service starts/restarts, migrations, deployments
or live settings writes were performed. No screenshot quantities were entered
or seeded. The particular live screenshot transaction's persistence and runtime
saving have **not** been verified. An HTTP 200 alone does not establish that
the exact intended values were persisted.
