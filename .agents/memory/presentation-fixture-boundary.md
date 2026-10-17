---
name: Presentation fixture boundary
description: Keep isolated layout evidence distinct from backend authentication and DNS evidence.
---

For presentation-only cross-browser work, a frontend-only synthetic session
fixture is acceptable when an unrelated coordinated-schema guard blocks the
backend fixture. Exercise the real client boundary and rendered components;
intercept all API requests and deny unknown endpoints and DNS mutations.

**Why:** Layout verification otherwise required expanding a typography task
into schema-release maintenance. Changing or bypassing that guard would exceed
the presentation scope.

**How to apply:** Explicitly report the evidence as synthetic presentation
testing, never as verified server authorization, persistence or live DNS
behavior. Keep backend functional suites and their existing guards intact.
