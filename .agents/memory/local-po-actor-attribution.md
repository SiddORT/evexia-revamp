---
name: Local PO actor attribution
description: How to interpret actor labels on browser-local purchase order activity.
---

Treat purchase order actor labels as local demo attribution, not authenticated identity. For older events without an actor, preserve the event and show that attribution was not recorded; known generated sample events may be identified as sample activity.

**Why:** Admin displays a demo profile but is not signed in. A browser-local record cannot establish who actually created, changed, or deleted an order, and older records never captured actors.

**How to apply:** Keep the distinction visible in purchase order activity and analytics. If authentication is introduced, write verified identity only for subsequent events and do not retroactively claim it for older activity.