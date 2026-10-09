---
name: Vendor phone compatibility
description: International Vendor metadata must preserve legacy acceptance without expanding other master contracts.
---
Keep the established IN/US/GB/AE Vendor acceptance rules when refreshing international phone metadata. Apply full country-specific validity to newly supported regions.

**Why:** Previously saved supported numbers were accepted under fixed-length rules, not full numbering-plan validity. Revalidating response records under stricter metadata would make historical contacts unreadable.

**How to apply:** Treat legacy acceptance as a compatibility boundary. International support is Vendor-only; do not expose additional countries in Doctor, Patient, MR or Staff without separate backend scope approval. Check frontend/server region parity and update the database country snapshot through a new non-destructive migration when metadata adds regions.
