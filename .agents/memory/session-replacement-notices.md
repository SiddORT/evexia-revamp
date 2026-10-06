---
name: Session replacement notices
description: Privacy and renewal boundaries for explaining a second login.
---

Replacement explanations must come from persisted new-login revocation evidence
bound to the presented credential's owner, with current security versions. Never
infer replacement from generic denial, arbitrary response text, or a URL.
Display the explanation only when that tab previously verified an Admin identity,
and keep it in memory rather than browser storage or redirect parameters.

**Why:** A fresh login page must not reveal account or session history. A known
replaced bearer must also not silently regain access through a newer shared
refresh cookie. The explanation is not permission to reactivate credentials.

**How to apply:** Treat verified replacement as a terminal denial, drop protected
content, and require explicit login. Preserve existing replay revocation and
cookie clearing. Ordinary access-token expiry still uses renewal, and transient
renewal failures still preserve hidden, non-interactive local drafts.
