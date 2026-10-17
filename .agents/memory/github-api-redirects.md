---
name: GitHub API redirects
description: A renamed repository can make a healthy connector appear unauthorized.
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
