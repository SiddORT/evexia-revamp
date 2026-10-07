---
name: API schema name stability
description: Prevent unrelated shared-client renames when adding directory extensions.
---

Give new directory-extension response schemas distinct names from existing domain identity response schemas, even when their wire payloads intentionally overlap.

**Why:** FastAPI disambiguates duplicate class names by module, which can rename both OpenAPI components and existing Orval-generated type files. Orval cleans generated files but does not repair handwritten barrel exports; an unchanged domain contract can otherwise break shared-client imports.

**How to apply:** Before adding an extension response, check existing schema names. After contract regeneration, run shared-library type checking and check that older domain exports retained their names.
