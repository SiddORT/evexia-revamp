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
