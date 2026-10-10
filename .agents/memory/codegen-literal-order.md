---
name: Generated validator literal order
description: Preserve validation constraints when generated Zod constants are emitted after their consumers.
---

Some Orval output places literal response bounds after the schemas that use
them. This is an initialization-order error, not a reason to change the API
schema or remove validation bounds.

**Why:** Reconciled directory contracts exposed TypeScript use-before-declaration
errors and would also fail module initialization. The OpenAPI contract was valid
and unchanged.

**How to apply:** Keep literal-order correction in the normal generation
pipeline. Hoist only side-effect-free scalar constants, never arbitrary
initializers or validators. Verify typechecks and actual generation results;
do not manually weaken generated validation to make a build pass.
