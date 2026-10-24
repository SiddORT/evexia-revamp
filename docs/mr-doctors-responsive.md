# MR Doctors: responsive presentation and scoped reads

The MR shell retains the five existing destinations. Above 960px they appear
in the top bar; at 960px and below they appear in a fixed icon-and-label bottom
bar with device safe-area spacing. The same navigation elements are reused
at both sizes. Orders retains all four live routes and opens upward on small
screens. Profile Settings/Logout and the existing navigation guards remain.
Only the exact My Doctors listing uses full viewport width.

## Read boundary

Doctor GET list/detail responses are role-dependent: Admin uses the unchanged
`DoctorResponse`/`DoctorPage`; MR uses `MRDoctorRead`/`MRDoctorReadPage`.
MR responses omit `phone`, `alternatePhone`, and `email`, returning only
`phoneDisplay`, `alternatePhoneDisplay`, and `emailDisplay`. Phone displays
retain at most two final digits after eight asterisks; legacy values of two
digits or less are entirely masked. Nonempty emails display `***@***`.
List, cards, and read-only detail consume these presentation fields as text,
never links, titles or unmasked accessible labels. Storage, write validators,
Admin reads, imports, exports, and order contracts are unchanged.

All authorization still uses the current MR's own identity and saved Doctor
ownership. No Staff reporting links, MR-manager relationships or team scope
are inferred. MR-head mapping remains deferred.

## Filters and numbering

MR Zone options come from that MR's ordered saved multi-zone memberships,
excluding deleted zones. MR headquarters contain only the saved, nondeleted
headquarter. Options do not download the broader MR/headquarter directories.
Filtering runs on the server before counts, bounded encrypted scans, and
pagination. Shared ownership predicates and writable assignment choices are
unchanged. Selecting an unrelated assignment cannot reveal unrelated doctors.
Admin's existing primary-zone filter semantics are unchanged.

The collapsed Filters disclosure includes Zone, Headquarter, Status, and
non-editable self-only MR information, with a filter count and clear action.
Changes reset page and continuation scope. Clear also clears search.
Ordinary pages use their normal global offset for Sr. No.; bounded encrypted
search sections restart numbering at one and explain this in the table caption.

## Verification limits

Per the request, no test suites, automated browser tests, release validation
wrappers, builds, managed service restarts, migrations or live writes ran.
OpenAPI was generated and client codegen completed, including its chained
library TypeScript compilation.

Manual screenshot inspection used an isolated frontend-only Vite listener,
real MR components and styles, and explicitly synthetic long display values.
Application API access and non-GET requests were denied. Auth, Doctor loading,
and initial expanded states were substituted only in the ignored disposable
review fixture, not in shipped application code.

Inspected widths: 360px and 390px phones, 768px tablet, 1280px and 1440px
desktop. Expanded Filters, Orders and Profile surfaces were viewed; the
390px table was also viewed at its right edge and document bottom, showing
pagination above the bottom navigation. Long names and missing contacts were
included. The review found and corrected the oversized inherited brand
container and cramped phone search field.

This is presentation evidence, not live authentication, filter accuracy,
contact-privacy transport, persistence, interactive keyboard, or cross-engine
evidence. Screenshot inspection used the capture browser only, not native
Safari/Firefox or physical devices. No real saved Doctor data was edited.
