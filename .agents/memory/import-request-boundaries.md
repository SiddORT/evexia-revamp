---
name: Import request and file boundaries
description: Verify valid large imports across both the request guard and the file parser.
---

An advertised file limit must be honored by the earliest request-size guard as
well as the import handler. Allow bounded multipart envelope overhead at the
request layer, while enforcing the exact file limit in the handler. Keep
ordinary JSON request limits unchanged.

**Why:** Rejecting an oversized upload is not sufficient evidence: that test
also passes when an upstream guard incorrectly applies a smaller default limit.
A missing route allowance rejected valid files between 1 and 2 MiB before their
import handlers could review them.

**How to apply:** For each newly server-backed import, test valid files above
the ordinary request limit, exactly at the file limit, and just beyond it.
Cover raw and multipart review/commit through the full authenticated API,
including actual imported counts and unchanged records on rejection.
