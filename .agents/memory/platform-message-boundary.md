---
name: Platform message boundary
description: Product scope for application confirmations and browser-owned leave-tab behavior.
---

The user requires platform popups only for application-owned message choices.
Do not reintroduce native alert, confirm, prompt, or unload-warning requests.

**Why:** The user explicitly rejected the hostname/Cancel/OK browser popup,
including the receipt editor's discard confirmation.

**How to apply:** Keep choices in the themed application UI and preserve the
pending continuation and uncertain-save restrictions. Explain that hard reload,
tab close, and cross-document browser exits cannot display custom HTML choices;
do not imply protection or add persistence without authorization. Ordinary file,
print, permission and other browser-owned controls are outside this rule.
