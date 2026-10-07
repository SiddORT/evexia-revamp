---
name: Multi-format upload codegen
description: Orval cannot serialize raw binary and multipart union request bodies together.
---

When an authoritative upload endpoint accepts both raw bytes and multipart,
generate a client for one supported representation rather than both together.
Keep the full accepted contract in FastAPI/OpenAPI.

**Why:** Orval produces a Blob/object union but passes it directly as BodyInit,
which fails TypeScript and would send the multipart object without serialization.
Selecting multipart in the codegen-only transformer produces proper FormData.
The generated Zod package also needs DOM library types for Blob/File schemas.

**How to apply:** Narrow only the affected upload operation in the existing
codegen input transformer, never the authoritative exported contract or unrelated
upload endpoints. The memory-only portal request layer may continue sending raw
bytes. Regenerate clients and run shared typechecking after contract edits.
