---
name: Browser download gestures
description: Model a separately clicked download action in browser regressions, not a burst of script-only handoffs.
---

Each expected browser file handoff should follow a fresh trusted click that
calls the application's actual download service.

**Why:** Chromium's automatic-download protection can block consecutive
script-only downloads independently of successful file preparation and durable
server acceptance. Firefox and WebKit permitting the same burst is not evidence
that it represents the real button-driven workflow.

**How to apply:** Click the real control, or a test-only native control invoking
the same service. Keep ledger acceptance, denial, identity guards, actual
download events and file-content assertions. Do not relax production guards or
grant broad automatic-download permissions to hide a fixture mismatch.
