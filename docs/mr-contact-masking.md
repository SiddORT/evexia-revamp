# MR person-contact presentation

Doctor and Patient contacts are masked on authenticated MR responses, not in
storage or by hiding raw values in the browser. Names, record IDs, demographics,
registration identifiers, amounts and workflow permissions are unchanged.
The signed-in MR's own details remain visible.

## Response boundaries reviewed

- Doctor directory list, detail and create responses use the same MR read
  projection. Phone/alternate phone and email use the existing display fields.
  Address lines, landmark, postal code, country, state and city contain masks.
  Existing CSV/XLSX Doctor exports apply the same contact projection while
  retaining their column layout. Import review returns its existing limited
  name/registration/amount/error fields, not contact snapshots.
- Immunotherapy, Kits & Consumables, SPT and Lupin apply the role-aware contact
  projection at the end of their authorized service transaction. This includes
  list/detail, mutation and recovered retry results, existing structured
  exports, and import-review/commit envelopes containing previous/saved orders.
  Doctor, Patient, patient-list, doctor-billing and Doctor/Patient-recipient
  snapshots are projected recursively through those envelopes.
- Shared reference lookups project Doctor and Patient choices, including one
  selected-reference hydration, after internal matching. MR reference choices
  retain the MR's own details. SPT patient references are also projected.
- The MR-only Immunotherapy Patient registration response has a presentation
  contract independent of Patient write validation. It includes masked contacts
  and the same usable identity, assignment and demographic details needed to
  select the newly created Patient.

Phone displays retain only the final two ASCII digits when there are more than
two digits. One- and two-digit legacy values get stars only. Nonempty emails
display `***@***`. Nonempty personal address components display `Address masked`;
empty components remain empty. Entire structured address objects are projected,
so extra historical address components cannot reconstruct the address.

## Storage and input separation

The projections copy response dictionaries. Encrypted order snapshots and retry
records retain authoritative contact data. Order resolution continues to use
internal, unmasked snapshots; unchanged references retain their historical
contacts. Order forms submit reference IDs, not Doctor/Patient display contacts.
New Doctor and Patient forms retain actual typed values until validation/save.
After MR Patient registration the browser remembers the masked server reference,
not an address reconstructed from the registration draft.

The saved shipping choice determines recipient provenance. MR shipping retains
the MR's own contacts; manually entered Other shipping is not assumed to be a
Doctor/Patient Master snapshot and remains subject to its existing write rules.
MR editing of saved Kits orders remains unavailable.

## Browser state

Directory/order request and export guards distinguish account, identity kind and
MR assignment in addition to the existing login generation. The MR workspace is
keyed to this identity/assignment boundary. Reference caches reject late responses
after identity changes and do not reuse records fetched for another role/scope.
Doctor/Patient renderers consume these server-projected strings; they do not
receive raw contacts to conceal in tooltips, links or accessibility attributes.
The redundant hidden Kits address copy was removed.

Uploaded bytes, filenames, free-text remarks, territory catalogues and document
contents are not anonymized by this feature. Authorized attachment viewing is
unchanged. No export permission or new document action is added.

## Verification limit

This implementation was reviewed from source only. No tests were added or run;
no browser automation, screenshots, builds, typechecks, release checks,
validation commands, workflow restarts, migrations or deployment were performed.
OpenAPI and client/validator files were regenerated as source artifacts without
running the code-generation wrapper's typecheck. Regeneration also synchronizes
previously stale generated order pricing/audit contracts with existing backend
schemas; it does not change their stored data or business rules.
Runtime behavior remains unverified.
