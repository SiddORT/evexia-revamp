---
name: Browser test cleanup evidence
description: Preserve the primary browser failure instead of replacing it with cleanup errors.
---
Cleanup failures must not replace the original assertion or browser failure.
Capture the page involved in the failing flow, not merely Playwright's default
page when separate actor contexts are involved.

**Why:** A large authorization matrix lost its browser while the default page
belonged to the administrator; cleanup then replaced the original error with
“Target page, context or browser has been closed,” obscuring the staff step.

**How to apply:** Use independent resource cases for large matrices, named action
steps and best-effort failing-actor screenshots. Preserve the original exception
when cleanup also fails, and wait for the intended view before success captures.
