---
name: Frontend browser test source isolation
description: Avoid editing authentication modules while isolated Vite browser tests run.
---
Freeze application source during a browser test pass that dynamically imports
the portal's service/auth modules. An isolated database and listener do not
isolate the fixture from shared source-file hot reloads.

**Why:** Editing the auth module during a Vite-backed test pass produced
different canonical and cache-busted module instances. Tests importing services
directly saw an empty/different session while the rendered authenticated UI used
another instance, causing misleading session and renewal failures.

**How to apply:** Finish source changes before starting the isolated browser
fixture. If a pass was contaminated by hot reload, confirm the affected flows in
a stable fresh fixture rather than weakening session checks or repeating all
already-passing cases.
