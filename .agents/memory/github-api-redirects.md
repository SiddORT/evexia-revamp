---
name: GitHub API redirects
description: Canonical repository paths, Git authentication, and byte-exact API delivery.
---

Resolve a repository's canonical API path before treating a proxy's plain-text
`Forbidden` response as an expired credential.

**Why:** During release verification, the old repository path redirected.
The connector reported healthy credentials, and the canonical repository's
authenticated job-log endpoint worked without reconnecting.

**How to apply:** Check read-only redirect/repository metadata, then retry the
canonical API path. Do not change Git remotes or request fresh credentials just
to work around a repository rename.

Native HTTPS Git authentication must be checked separately from connector API
access, even when the API reports repository push permission.

**Why:** Both canonical and legacy Git push URLs rejected authentication while
the connector's canonical repository API succeeded with push permission.

**How to apply:** Report the push failure honestly; do not infer remote delivery
from API access. Consult Replit's Git Providers/Git pane reconnection guidance,
without reading credentials or unnecessarily reconnecting a healthy API integration.

An authorized Git Data API push can preserve the exact local commit without
extracting credentials. Require matching blob, tree and commit hashes before
a non-forced reference update, and verify the expected remote parent.

**Why:** A bounded tool response truncated an embedded file while leaving the
outer JSON parseable. The blob hash check prevented publishing corrupted content.

**How to apply:** Check the tool's truncation flag before consuming payloads;
successful JSON parsing is not proof of completeness. Read committed Git objects,
retain byte/hash verification, and never force-update a concurrently changed branch.
