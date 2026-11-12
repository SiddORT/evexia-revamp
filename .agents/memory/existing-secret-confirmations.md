---
name: Existing secret confirmations
description: Distinguishing confirmation of an existing secret from replacement during account setup.
---

A “User added or confirmed requested secrets” notification does not prove an existing secret's value changed. Do not repeatedly request confirmation when the same configuration validation still fails.

**Why:** Account setup continued to reject the existing secret after confirmation; explicitly editing the saved value resolved the validation failure.

**How to apply:** Ask the user to edit and save the existing secret through the secure Secrets tool, then retry the established setup command. Never request the value in chat or expose it in logs.

Configured initial-login secrets are not proof of current account access.
If a specifically authorized real login is rejected, do not keep trying that
initial password, reset the account or infer that stock/data are broken.

**Why:** A configured initial login was rejected while a separately supplied
current login succeeded; secret existence alone did not establish validity.

**How to apply:** Use the secure secret form for an authorized current login
when needed. Keep values inside the executing login process, and distinguish
authentication failure from the business-data issue being investigated.
