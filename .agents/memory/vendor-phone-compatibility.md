---
name: Phone legacy compatibility
description: Shared international metadata retains different historical phone policies for each master.
---
Use shared international metadata for MR, Doctor, Patient, Staff and Vendor. Preserve each master's historical acceptance when refreshing metadata: Doctor/Patient accept fixed-length IN/US/GB/AE numbers; Staff/Vendor additionally require Indian mobile prefixes; MR's legacy acceptance is India-only.

**Why:** Previously saved supported numbers were accepted under fixed-length rules, not full numbering-plan validity. Revalidating response records under stricter metadata would make historical contacts unreadable. The user explicitly expanded international support beyond Vendor-only.

**How to apply:** Treat legacy acceptance as a per-master boundary, not one global relaxed policy. Apply maintained country-specific validity to newly supported regions, preserve ISO identity for shared calling codes, and check frontend/server catalog parity on metadata upgrades.
