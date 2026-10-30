# Security

Do not post credentials, refresh tokens, plant addresses, device serials or recovery journals in public issues. Use GitHub private vulnerability reporting when enabled, or contact MBS Integrations privately through [mbsintegrations.ie](https://mbsintegrations.ie).

Credentials stay in the owner's HA configuration storage. HA backups therefore need protection. No MBS backend receives plant credentials or commands. Native HA administrator checks protect interactive writes and shared scheduling preference changes; trusted HA automation code is part of the owner's security boundary.

Only fixed operations are exposed, bound to the validated configured plant and discovered devices. Installer restrictions and owner bounds must not be bypassed. Avoid remote dashboard exposure without normal HA authentication. Sanitized diagnostics are allowlisted, but review any attachment before publishing it.

This Alpha is not a security or reliability certification. Install only when invited and retain native recovery access. See [control recovery](docs/controls-and-recovery.md).
