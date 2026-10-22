---
name: Document date preference boundary
description: Why pure document rendering needs caller-owned display preference snapshots.
---

Keep browser preference subscriptions outside pure renderers and pass a validated,
immutable display snapshot into each document operation. The rendered SVG pages
and accessible summary must use that same snapshot; an asynchronous download
must not reread browser preferences midway through generation.

**Why:** Browser preference modules also import activity/authentication code.
Importing them into otherwise pure document services introduces browser lifecycle
effects in service tests. Separately formatting summary text at render time can
make it disagree with already-generated PDF pages after a preference change.

**How to apply:** Subscribe at the React document boundary and regenerate from the
unchanged canonical model on preference updates. Capture the displayed document
when starting an export. Keep calendar dates distinct from instants and never
apply display preferences to persisted values or ordinary JSON.

Human-facing CSV/XLSX exports intentionally follow General settings, even when
they double as backups. Re-importable calendar values must carry explicit format
context; never infer numeric day/month order from the importer's preferences.
Keep accepting historical ISO backups, and keep informational audit cells
non-authoritative on import. Resolve Browser default once per export, before
asynchronous work; do not assume the server's zone matches the browser's zone.

**Why:** The user explicitly expanded the former transfer exclusion. Backup
recoverability and unchanged canonical business/storage values remain required.
