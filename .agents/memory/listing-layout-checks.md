---
name: Listing layout check scope
description: Separate notice-removal layout checks from existing populated-table geometry.
---
For text-only listing cleanup, assert viewport bounds for the changed headings,
guidance, actions, panels and pagination, plus the header-to-panel gap. Do not
use document-wide scroll width as a substitute for those measurements.

**Why:** A populated Doctor listing produced a larger document scroll width
while its header, panel, pagination and internal table scroll container all fit
the viewport. An empty isolated fixture hid that distinction. A global metric
would have expanded a notice-removal task into unrelated record-row layout work.

**How to apply:** Preserve exact absence and retained-guidance checks. Test
changed surfaces with both empty and populated directories when practical;
investigate table/record overflow separately when that behavior is in scope.
