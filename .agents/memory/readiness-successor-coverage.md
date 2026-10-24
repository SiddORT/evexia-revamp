---
name: Readiness successor coverage
description: Additive schema successors must retain every inherited readiness probe.
---
New accepted schema heads must inherit the predecessor readiness capabilities,
not merely pass the top-level revision allowlist. Keep operator approval and
encryption compatibility boundaries explicitly reviewed rather than accepting
arbitrary future heads.

**Why:** Negative tests that deliberately removed predecessor tables exposed
false-ready responses after an additive successor skipped the older
revision-specific branches. A clean startup alone did not catch this.

**How to apply:** When adding a schema successor, trace the entire readiness
chain and retain missing-table/column probes for inherited features. Verify a
negative probe in a disposable database as well as normal startup.
