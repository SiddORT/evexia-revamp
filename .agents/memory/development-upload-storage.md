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

The user's intended Immunotherapy folder layout is
`private-files/mrs/<MR-id>/immunotherapy/<patient-id>/<file-id>.pdf`.
Do not insert a `patients` segment.

**Why:** The user explicitly corrected the proposed folder layout.

**How to apply:** Keep this as the desired layout when planning a compatible
storage-key change; do not silently move existing objects or bypass key constraints.

Verify the multipart request boundary separately from storage and scanner health.

**Why:** Dynamically parsed multipart requests can fail despite healthy startup,
storage round trips and real malware scans when the runtime parser dependency is
missing.

**How to apply:** Include a focused multipart parsing check; mocked storage or
direct storage/scanner probes do not establish that the upload endpoint works.

Use the official `freshclam` updater to establish whether virus definitions can
be downloaded; a generic `curl -I` request is not conclusive.

**Why:** The official database URL returned HTTP 403 to a generic HEAD request,
but `freshclam` successfully downloaded and validated the signed databases.

**How to apply:** Diagnose failures through the actual updater before considering
mirrors, and never substitute empty databases or fake clean scan results.
