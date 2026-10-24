---
name: Development upload storage
description: User-approved local storage boundary and a ClamAV download diagnostic caveat.
---

For now, the user wants uploads stored in S3-compatible folders inside the project,
not in App Storage.

**Why:** The user explicitly said, “we have to store in s3 compatible folders in
the project folder for now.”

**How to apply:** Preserve backend-neutral object keys and private local storage;
do not interpret this as permission to move existing upload bytes to a cloud bucket.

Use the official `freshclam` updater to establish whether virus definitions can
be downloaded; a generic `curl -I` request is not conclusive.

**Why:** The official database URL returned HTTP 403 to a generic HEAD request,
but `freshclam` successfully downloaded and validated the signed databases.

**How to apply:** Diagnose failures through the actual updater before considering
mirrors, and never substitute empty databases or fake clean scan results.
