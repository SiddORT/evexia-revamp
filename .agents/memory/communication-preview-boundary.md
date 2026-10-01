---
name: Communication preview boundary
description: Why Communication metadata endpoints exclude every query string and fragment.
---

Communication remains demo-only; do not reinterpret a saved default or platform option as a connected provider. Endpoint metadata deliberately excludes all query strings and fragments, not just known secret parameter names.

**Why:** Provider credential names are not standardized. A denylist of names such as token or api_key would permit secrets under arbitrary aliases. The user explicitly excluded real integrations and any persistence of dummy or real credentials.

**How to apply:** Keep credentials in separate transient preview inputs and never introduce arbitrary headers or JSON fields. If future work requires provider-specific URL parameters, revisit the boundary explicitly rather than weakening it with a short denylist.