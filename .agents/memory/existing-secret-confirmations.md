---
name: Existing secret confirmations
description: Distinguishing confirmation of an existing secret from replacement during account setup.
---

A “User added or confirmed requested secrets” notification does not prove an existing secret's value changed. Do not repeatedly request confirmation when the same configuration validation still fails.

**Why:** Account setup continued to reject the existing secret after confirmation; explicitly editing the saved value resolved the validation failure.

**How to apply:** Ask the user to edit and save the existing secret through the secure Secrets tool, then retry the established setup command. Never request the value in chat or expose it in logs.
