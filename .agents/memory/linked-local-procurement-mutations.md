---
name: Linked local procurement mutations
description: Safety constraints for browser-local purchase orders and receiving history.
---

Coordinate every linked PO and Purchase Received mutation with the same exclusive browser Web Lock, and re-read both saved records inside it. Fail explicitly when the browser cannot provide that coordination rather than attempt a best-effort localStorage lock.

**Why:** Revision comparisons alone are not atomic across tabs. A PO deletion and receipt creation, or two receipts, can each pass separate freshness checks and then invalidate source history or over-accept quantities.

**How to apply:** Use the shared guarded service entry points for UI mutations and preserve successful-action-only activity. Fulfillment remains derived from active receipts rather than a second PO write, so receipt persistence cannot leave half-updated fulfillment.

Keep legacy PO line-identity normalization deterministic and read-only. Persist normalized identities on a coordinated PO write, not as a side effect of opening a page.

**Why:** A synchronous read-time migration cannot acquire the asynchronous browser lock. Its raw-value comparison and write can race a newer mutation; deterministic IDs safely provide stable references without that extra write.

**How to apply:** Preserve retained line identities through edits, distinguish duplicate product rows, and do not change PO source rows while active receipts depend on them.

Receipt corrections may retain or reduce saved historical received quantities even when later receipts consumed the previously rejected balance. Always cap acceptance by the balance excluding the receipt being edited; new/increased receiving still needs current capacity.

**Why:** Receiving ten units and accepting five leaves five outstanding. A later receipt can accept those five and close the PO. Applying today's five-unit balance to the earlier ten-unit historical receiving would prevent correcting its batch, receiver, date, or expiry.

**How to apply:** Separate historical receiving from additional receiving when validating edits. Never use the historical allowance to increase aggregate accepted quantities above the order.

Keep sample marking compatible with the existing strict persisted receipt schema until a coordinated schema migration is intended.

**Why:** PO mutation guards also read and validate saved PR records. Adding an otherwise harmless sample flag to PR alone can make an older PO reader reject the entire receiving history and block unrelated PO changes.

**How to apply:** Carry sample identity through existing saved identity fields and derive display/document marking from them. Any future receipt schema expansion must update all cross-reading validators together and deliberately preserve older records.

Do not offer to discard or switch a receipt's source PO while its save is in flight, including while it waits for the shared browser lock.

**Why:** Unmounting the receipt editor does not cancel a queued browser-lock mutation. An old save can still persist and redirect after the UI claims that draft was discarded.

**How to apply:** Coordinate navigation with mutation state at the page level. Preserve the current source link until saving settles, and block save initiation while a source-change decision is unresolved.