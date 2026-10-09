---
name: Document navigation and renewal
description: Avoid synthetic refresh replay caused by rapid full-document navigation in authenticated browser tests.
---
Before another full-document navigation, wait for the authenticated actor and
the intended terminal route, especially after an authorization redirect.
An assertion that a forbidden URL is merely absent is not sufficient.

**Why:** Destroying a document releases its Web Lock while an already dispatched
refresh can still finish on the server. The next document can send the old cookie
before that rotation response lands; legitimate replay detection then revokes the
synthetic session. A permission test may appear to lose its Import control when
the actual actor has already returned to sign-in.

**How to apply:** Settle the actual actor's authenticated state at the expected
redirect destination before reloading or changing its role again. Keep session
replay checks and permission boundaries intact; do not weaken authentication to
make rapid browser tests pass. Inspect the failing actor screenshot, not only
the administrator's default page.
