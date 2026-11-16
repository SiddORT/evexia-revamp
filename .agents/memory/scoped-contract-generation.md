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

Generation can also relocate hand-maintained exports or emit helpers for
pre-existing unrelated contracts that had not previously been generated.
Keep those additions out of a narrow feature unless separately requested.

**How to apply:** Keep the new endpoint's exported schemas and generated helpers,
but compare unrelated output against the prior source and retain its behavior.
Do not run the package codegen wrapper when checks are prohibited: it chains a
library typecheck. Use the direct generator and its constant-hoisting step only.

Keep a JSON-formatted OpenAPI document in JSON syntax even when its filename
ends in `.yaml`; format generated TypeScript separately, not with a YAML formatter.

**Why:** A formatter selected by the filename converted JSON to YAML flow syntax
with trailing commas and changed the whole document. The scoped exporter reads
JSON and could no longer consume that output. Regenerating from the original
JSON base preserves unrelated contracts and avoids this formatting-only failure.

**How to apply:** Pass the original JSON base to the scoped offline exporter
when recovering; do not include the OpenAPI file in a broad Prettier glob.
