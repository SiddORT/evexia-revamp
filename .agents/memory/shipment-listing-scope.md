---
name: Shipment listing scope
description: The user wants all three fulfillment statuses visible together by default.
---
Shipments must show In process, Shipped and Returned orders together by default.
Shipping or returning an order must not remove it from that default view.
Individual status filters remain available.

**Why:** The user explicitly wants shipped orders to remain visible on Shipments.

**How to apply:** Preserve this default when changing listing, reset or refresh
behavior. Do not revert to an In process-only default.

### Listing and detail presentation

Keep the Shipments listing compact and avoid horizontal scrolling. Combine
Order and Type, but keep Doctor, MR and Patient separate. Full order details
belong in a right-side View details drawer, including allergens, quantities,
people, billing, shipping and shipment information.

**Why:** The user explicitly requested this separation to keep the table readable.

**How to apply:** Add lengthy order information to the drawer rather than
expanding the listing into an increasingly wide table.

Use page-aware serial numbers, full order-type names, and icon-only actions
with accessible labels and tooltips. Organize drawer information into clearly
separated sections rather than deeply indented, narrow nested fields.

**Why:** The user requested clearer drawer organization and less uneven column
spacing after reviewing the initial shipment layout.
