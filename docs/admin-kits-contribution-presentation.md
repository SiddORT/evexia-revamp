# Admin saved contribution presentation

Admin Kits & Consumables saved-order review and the saved contribution display
inside its editor omit the contribution heading, explanatory paragraphs,
deduction-policy paragraph, saved contribution metadata and historical
unavailable message. Available contributions retain all six financial rows.
Unavailable or missing contributions render no contribution section.

The opt-in applies only to Admin saved displays. MR displays retain the existing
notes, and an editor change to pricing or Parking still shows the unchanged
unsaved contribution preview. Parking and PO controls, financial calculations,
saved values, invoice totals and approval protections are unchanged.

## Focused layout evidence

The actual pricing-summary, contribution-summary and order-editor components
were compiled into a disposable static presentation harness. It used an
unregistered, ephemeral loopback listener and local Chromium, not a managed
preview service. Surrounding editor authorization, reference controls and
approval UI were substituted with static boundaries; synthetic order data and
GST evidence were supplied locally. The harness denied external requests and
all non-GET requests; mutation service functions threw instead of writing.

At **390, 768 and 1440 CSS pixels**, inspection covered available, unavailable
and absent historical contributions in priced saved summaries, unpriced saved
summaries and the editor (27 layout combinations). It confirmed:

- Available contribution displays retained six rows and no visible notes.
- Missing/unavailable displays left no contribution wrapper or empty note space.
- Parking, PO and contribution rows stayed within viewport bounds, with no page
  overflow or clipped contribution content; item tables retained internal
  horizontal scrolling.
- MR saved notes and both available/unavailable unsaved preview notes remained.
- Changing Parking in the real editor exposed the original preview notes.
- The completed inspection recorded no browser errors or attempted external/API
  requests. No additional layout changes were necessary.

Disposable captures and measurements were written under the ignored
`generated-artifacts/admin-contribution-layout/` directory. This is synthetic
presentation evidence, **not live server, authorization or persistence
verification**.

No regression suites, release checks, automatic release workflows, backend
functional checks, approval operations, managed service starts/restarts,
migrations or deployments were run.

## Why Approve order can remain disabled

The approval reason must contain non-whitespace text (up to 2,000 characters).
A blank reason alone is sufficient to disable approval, independently of the
financial review. Providing a reason does not bypass permissions, saved-order
eligibility, valid/current pricing and version, required current financial
review evidence, unsaved-change restrictions, or pending/conflicting operations.
This presentation change does not remove or weaken any of those requirements.
