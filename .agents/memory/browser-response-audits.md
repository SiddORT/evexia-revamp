---
name: Browser response audit boundaries
description: Distinguish API JSON from Vite source responses when auditing browser credential leakage.
---

Match response audits to the API pathname boundary, not a loose resource-name
substring.

**Why:** A Communication credential audit also captured a Vite component module
whose URL contained the same resource path fragment; parsing JavaScript as JSON
made a successful CRUD journey appear broken.

**How to apply:** Select the exact API route prefix, retain strict response-shape
and secret-canary assertions, and await collected response bodies before closing
the browser context. Do not filter away malformed API responses to hide failures.
