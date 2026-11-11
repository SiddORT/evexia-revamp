# Configured Immunotherapy material pricing and consumption

## Authorized scope

New MR category/Mix Immunotherapy placements (including final submission of a
creator-private incomplete draft) use `configured_material_ml_v1`. Historical and
unrestricted Admin orders retain their prior pricing/approval path and receive
no retrospective consumption. Other order types, clinical defaults, dosage
suggestions, prescriptions, settlements, notifications and the separate in-house
concentrate dilution workflow are not extended.

## Prerequisites and explicit setup

Forward schema `0089_it_material_pricing` adds an empty singleton binding to a
real Allergen master UUID. It seeds no master, category, storage location,
rate, cutoff, formulation or stock. Apply through the existing automatic
migration lifecycle only when that lifecycle is separately run; this task has
not executed it.

Protected Super Admin opens Allergen Master → Add product and explicitly checks
the dummy Dilution setup option. Supply the actual name, active category and
storage reference, required master description and GST. Use Active, No Mix,
blank selling price and blank alert threshold for this setup. Required unknowns
stay blank until supplied. The description is not an inferred clinical
concentration. A similarly named record causes a conflict; setup never adopts
or overwrites it. Unchanged actor/request retries return the same bound identity.
The binding cannot be silently reassigned or replaced by rerunning setup.

The list identifies the bound material as inventory/pricing only even after a
rename. Clinical reference lists and submitted clinical references exclude its
UUID; it is never an extra child, skin-test rank, bottle, dosage or prescription
entry. Normal protected master/inventory management remains available.

Save a Pricing Rule explicitly targeting that material in its actual category,
and rules for every clinical allergen. Enter both cutoff branches, including
explicit zero if intended. Separately configure actual ml pairs for each
category/dosage/actual bottle membership/rank in Extract & Dilution settings.
No missing combination falls back to a larger bottle's values or a legacy table.

## Quote, confirmation and write

Preview resolves the same grouping and ranked assignments as placement, but
allocates no IT/SUB/batch numbers and persists no clinical assignments. Each
child's Extract ml is multiplied by its allergen's applicable INR/ml. Within
each actual SUB, child Dilution ml is summed and charged once against the
separate Dilution material rate. Volumes are not multiplied by bottle count.
Each Extract component and each SUB's Dilution component is rounded exact
decimal half-up to two places; rounded components sum to the SUB MRP and total.

Saved order date strictly before cutoff selects `before`; equality/later selects
`onOrAfter`. Snapshot evidence includes material/category UUIDs and labels,
rule UUID/version, cutoff/branch/rate, quantities, ranked assignment provenance,
components and header/order amounts. Future rule/settings changes do not reprice
saved orders. A changed saved composition, quantity or MRP cannot silently keep
the old snapshot: explicitly select Refresh configured quote and review/save
the new quote. Unsupported historical orders cannot adopt this path implicitly.

The existing themed confirmation shows selected-Doctor pending amount,
configured MR Doctor Days Limit, oldest relevant unpaid-order saved date/age,
MR unpaid balance, proposed amount, resulting exposure and MR Payment Limit.
Unavailable evidence is not presented as zero; a days setting alone is not
overdue-payment evidence. Positive MR payment limit requires exposure **<** the
limit for this supported IT policy. Positive MR Doctor Days Limit blocks only
selected-Doctor unpaid orders older than the allowance, from saved order date.
Each zero independently disables its restriction. No Doctor Master limit is
added; other order types keep their prior equality policy.

Confirmation binds actor, relationships, composition, effective date, actual ml,
quote and financial result. Final submission recalculates under the same ordered
policy/financial/configuration locks; drift requires fresh review. It does not
silently submit a new price. Replays of the original committed request precede
fresh evaluation. Both direct and saved-draft submission retain the exact
confirmed payload through uncertain retries. Terminal rejection remains durable;
absence is not reported as proof of cancellation. Entry/uploads remain available.

Initial submission awaits normal explicit Admin review. Stock advice is advisory
at submission; no reservation or deduction is made. Incomplete drafts need no
complete quantities/prices and allocate no order numbers or notifications.

## Approval and historical evidence

Explicit approval of a supported pending order validates its saved evidence and
consumes saved Extract and Dilution quantities in the same order transaction.
Only allocated balances at active saved locations with usable expiry evidence
qualify. FEFO allocation uses stable lot/location ties. Expired, expiry-today
(Kolkata), unknown-expiry, Unallocated and reserve quantities are excluded.
Insufficiency names each material and required/available ml, rolls back the whole
approval and leaves the order awaiting review; no negative or partial posting.

Every posting has durable `it-approval:<order UUID>` identity and actor/time.
The encrypted order snapshot retains transition version and immutable material,
lot, location, batch/expiry, quantity and before/after allocation evidence.
Stock history exposes the source and negative postings. Receipt corrections
cannot change a consumed lot's product/batch/expiry identity.
The order lock, existing inventory lock, version checks, posting source and
idempotent replay protect concurrent/retried approval. Refreshes, shipment
transitions and returns do not reconsume/restock; rejection never consumes.
Existing In process orders are not deducted retrospectively.

Admin review/detail surfaces show saved price components and lot allocations.
MR sees only its saved financial and consumption summaries, not general
inventory/configuration access or location/lot allocations.

## Delivery limitation

Source/diff inspection and API source generation only. No tests, regression or
release checks, builds, typechecks, validation/completion command wrappers,
runtime/browser probes, service restarts, migrations, production activation,
emails or live order/stock/rate demonstrations were run. Runtime behavior and
migration execution remain unverified.
