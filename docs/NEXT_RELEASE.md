# Next release

Tracked in [issue #16](https://github.com/mbsintegrations/HomeAssistant-Sigenergy-TC/issues/16).

- [x] AC Start Charging reads the exact charger's current mode before starting. In PV Surplus mode, offer **Temporary Fast Charging**, **Wait for solar** and **Cancel**. No mode is changed until the owner explicitly chooses Fast.
- [x] Keep the charger's existing power cap, battery assistance and SOC settings. Restore the previous Surplus settings when the session ends or Stop is confirmed. Preserve newer owner changes made in mySigen.
- [x] Persist the temporary session across HA restarts. Reconcile uncertain responses without replaying Start or Stop. Acknowledgment means the request was accepted, not that energy is flowing.
- [x] Show waiting, charging and restoration status beside AC controls. Check only an active session, once per minute.
- [ ] Owner acceptance on the real charger: cancellation, temporary Fast start, charging end/Stop and return to Surplus.
- [ ] Include the live hotfix in the next tagged release and update the release notes.

## Testing the live hotfix

Refresh the Sigenergy TC dashboard after the update. With the AC charger in PV Surplus mode, select **Start charging**. Choose **Temporary Fast Charging** to allow grid charging for this session, or **Wait for solar**/**Cancel** to leave the charger untouched. Existing Fast-mode starts and DC controls keep their existing behavior.

TC waits for fresh native charger status. A brief pause does not end the session; at least 60 seconds of non-charging state after charging has been observed triggers restoration. If charging never starts, TC restores the previous mode after three minutes. The temporary mode lease expires after 24 hours. These checks require HA and Cloud to be online; they are not a hardware timer. After an outage, TC resumes verification and restoration without replaying charger commands. The original mode can also be restored directly in mySigen.

Public release 0.2.8 remains unchanged until the next release is published. This candidate is for the owner's live acceptance test.
