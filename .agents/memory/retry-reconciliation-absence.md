---
name: Retry reconciliation absence
description: Why an absent durable mutation result needs cancellation evidence before it can be called not committed.
---

An absent retry record alone is not proof that an uncertain mutation cannot still
commit. Reconciliation must share the mutation's lock and durably close the
request identity before reporting a safe negative outcome.

**Why:** A disconnected or delayed original HTTP request can reach the database
after a reconciliation read. Telling the user to retry with a fresh request
identity at that point can create two receipts.

**How to apply:** Keep negative cancellation evidence under the same owner-bound
request identity and serialization boundary as successful durable results.
Re-review with a new identity only after the original has a terminal outcome.
Do not persist sensitive drafts merely to recover an uncertain save.
