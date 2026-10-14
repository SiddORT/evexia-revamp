---
name: Development recovery custody
description: Approved storage boundary for original-development recovery evidence.
---

The user approved private Replit App Storage for original-development recovery
backups and actual independent restoration checks. This does not authorize UAT
or production operations.

**Why:** The user initially requested a project backup folder, but the reviewed
recovery tooling rejects workspace paths. They then explicitly approved private
App Storage instead.

**How to apply:** Keep durable archives and rehearsal evidence in the private
storage namespace, never public assets, Git, or downloadable Library cards.
Verify authenticated readback and rejected anonymous access. Local working files
must remain outside the repository with private operator-owned directories/files
(0700/0600). Restoration must actually run against a distinct disposable cluster.
Retain separate reports for archive integrity, successful restoration, and
independent encryption/signing-key recovery; none proves the others. Reconfirm
the execution scope before applying guarded migrations.
