---
name: Scoped contract generation
description: Preserve existing manually refined contracts when adding an unrelated endpoint.
---

For a narrow API addition, inspect regeneration drift outside the new endpoint
and preserve existing unrelated contract refinements.

**Why:** Full FastAPI export and Orval regeneration can change existing manually
refined Pricing Rules validators, optional/default semantics and repeated-array
query serialization, even when the task changes none of that backend behavior.
Generated output is not necessarily an innocuous formatting-only change.

**How to apply:** Keep the new endpoint's exported schemas and generated helpers,
but compare unrelated output against the prior source and retain its behavior.
Do not run the package codegen wrapper when checks are prohibited: it chains a
library typecheck. Use the direct generator and its constant-hoisting step only.
