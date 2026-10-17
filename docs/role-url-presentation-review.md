# Role URL presentation review

## Scope

Presentation-only changes to Settings → Role URLs. Shared Settings categories,
server requests, permissions, drafts, conflict handling, removal-dialog behavior,
DNS semantics and domain configuration are unchanged.

The panel now owns its padding and heading typography instead of inheriting the
generic `admin-settings__section` selectors. Operational text uses the existing
sans-serif family at 14px (with a default 16px root), section headings use 18px,
and the title uses 20px. Supporting text and DNS monospace values use 13px.
Relative font sizes accommodate text enlargement. All colors use existing theme
tokens, including the primary-action tokens for Classic and Modern.

Mapping actions use aligned columns. DNS actions sit below each record rather
than competing with long names and TXT values for horizontal space. Sections use
dividers; setup steps and secondary disclosures no longer add nested boxes.
Responsive changes follow the available panel width, including when desktop
navigation reduces the content space. Hostnames and TXT values wrap without
ellipsis. Existing visible safety warnings and native disclosures remain.

## Manual browser access — 2026-10-17

The existing frontend workflow starts successfully. A fresh direct visit to
`/admin/settings?tab=role-urls` stops at **Portal could not be determined**,
with a 502 response on portal lookup. The API workflow is not running.
Its configured startup invokes development schema synchronization, so it was
not started: database and infrastructure changes are outside this work.
No authentication bypass, synthetic session, test harness or domain mutation
was used.

| Viewport | Result |
| --- | --- |
| Desktop, 1440 × 1000 | Blocked before sign-in |
| Tablet, 768 × 1024 | Blocked before sign-in |
| Mobile, 390 × 844 | Blocked before sign-in |

Screenshots of the blocker are available in the workspace's ignored
`generated-artifacts/role-urls/` directory:

- `desktop-access-before.jpg`
- `tablet-access-after.jpg`
- `mobile-access-after.jpg`

These captures **do not verify the protected Role URLs layout**. The uploaded
screenshot predates the currently authored presentation (for example it lacks
the section icons and numbered setup guidance now in source). Its exact served
version, runtime assets and computed cascade could not be established.
Source inspection establishes the shared-selector dependency, not the cause
of every difference in that screenshot.

No tests, automated browser checks, build commands, release checks or development
diagnostic suites were run or added, as requested.

## Remaining access-dependent review

Once an operator provides a healthy, already-configured API and an authorized
Super Admin browser session, manually review fresh direct access and navigation
from another Settings category. Inspect computed font family, heading sizes and
padding; review mobile, tablet and desktop layouts, 200% text enlargement, and
Classic/Modern in light/dark appearance. Include long hostnames and existing TXT
records where available, without creating challenges or exercising mutations.
Dialog/editor, draft/conflict and keyboard behavior were preserved in source,
but not exercised in this session.
