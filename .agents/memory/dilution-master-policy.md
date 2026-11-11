---
name: Dilution master policy
description: Clarified Mix and low-stock policy for the bound inventory/pricing Dilution material.
---

Dilution is always Mix and may have an explicitly entered low-stock threshold
in ml, including zero. Blank retains disabled-alert meaning; never invent a
threshold. This supersedes the earlier No Mix and blank-threshold restrictions.

**Why:** The user explicitly clarified these two setup requirements; they do not
authorize stock mixing or clinical formulation changes.

**How to apply:** Require Mix on new explicit setup and explicit bound-material
edits. Preserve original unchanged committed setup replays, including older
No Mix payloads, without backfills or digest rewrites. Binding is by stable
identity, never inferred from the name. Mix does not make Dilution a clinical
allergen or bottle-group member.
