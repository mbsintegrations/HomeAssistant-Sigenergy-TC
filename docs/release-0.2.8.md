# Sigenergy TC 0.2.8

Released 2 November 2026. **Invitation-only Alpha — install only if invited by MBS Integrations.**

[Download and release assets](https://github.com/mbsintegrations/HomeAssistant-Sigenergy-TC/releases/tag/0.2.8) · [Installation](installation.md) · [Recovery](controls-and-recovery.md)

## What changed

Personal strategies now provides **New, Change, Rename and Delete** for the native rules already saved on the Sigenergy plant. New and Change use Sigenergy’s personalization assistant through the configured mySigen Cloud login, including its proposal, follow-up and confirmation workflow. Rename and Delete use native rule requests. These are separate from HA-managed schedules and do not require an NBI application or an external AI subscription.

The backend checks administrator access, Cloud control permission, plant identity and fresh rule data. Changes preserve a private pre-change snapshot, require fresh readback and are never automatically replayed after a lost response. Native conversations expire and are polled only while their editor is open. Existing dashboard layouts and control permissions are retained.

## Update an existing installation

1. Back up HA and record the existing native rules in mySigen. Release any active TC override before restarting.
2. Download **0.2.8** in HACS and restart Home Assistant.
3. Fully reload the browser, tablet or Companion App. Keep the existing integration entry and dashboard.
4. Open **Personal strategies**. Administrators with connected and enabled Cloud control can manage native rules. An upgrade does not enable writes that were previously disabled.

For manual installation, use the attached `sigenergy-tc-0.2.8.zip` and verify it against `SHA256SUMS.txt`. Follow the [installation guide](installation.md). Do not add duplicate frontend resources.

## Verified and pending

590 backend tests and 443 frontend tests passed, together with Ruff and the official Hassfest/HACS checks. Browser regressions covered 44 overview/embedded cases, 24 resize transitions, 15 native preset dialogs and six native strategy interaction viewports. Isolated HA Test checked startup, module serving, existing services and rejection of writes when control is disabled. Real-account reads verified native history and an informational assistant response; the native rule list remained unchanged.

**Real native strategy create/change/rename/delete acceptance is still pending invited owner testing.** No actual rule mutation was performed in these checks. Synthetic transport and browser success does not establish hardware acceptance. Review the returned native proposal carefully; submitting text is a plant operation and is not guaranteed to be a dry run. A saved snapshot is not an automatic undo for a deleted rule. See [native strategies](native-strategies.md) and [acceptance scope](acceptance.md).

The release continues to use the unofficial mySigen app interface. Firmware and account permissions may affect coverage. Installer/protection changes, firmware operations, native charger schedules, V2X dispatch and external AI execution remain outside the implemented controls. [Capability matrix](compatibility.md).
