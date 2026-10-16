---
name: Communication preview boundary
description: Why Communication metadata endpoints exclude every query string and fragment.
---

Communication configuration storage is shared, encrypted and Super Admin-only, including write-only credentials. This explicitly supersedes the former browser-local metadata-only preview boundary. Saved defaults and the Platform option still do not connect or activate a provider. Endpoint values exclude all query strings and fragments, not just known secret parameter names.

**Why:** The user explicitly approved encrypted credential storage but excluded sending, connection testing, provider activation and switching environment-configured password recovery. Provider credential names are not standardized; query-name denylists would allow credentials under unknown aliases.

**How to apply:** Keep credentials write-only through the dedicated encrypted configuration API, never in localStorage or returned to editors. Do not migrate or delete legacy browser demo records. Delivery, key rotation and shared migration execution require separate approval. Revisit URL requirements explicitly rather than weakening validation with a short denylist.