# Charging follow-up

[0.2.9 Beta](release-0.2.9.md) includes the AC temporary Fast Charging session and restoration logic. Follow [issue #16](https://github.com/mbsintegrations/HomeAssistant-Sigenergy-TC/issues/16) for physical verification of automatic restoration, state-aware AC/DC button availability, and DC temporary charging-mode overrides.

Test automatic AC restoration with a connected vehicle and AC PV Surplus mode. Record the original mode and limits. Start **Temporary Fast Charging**, verify that energy is flowing, then stop the session or let the vehicle finish. Verify the original mode and limits in mySigen. Automatic restoration requires Home Assistant and Cloud connectivity.

## 0.2.10 candidate acceptance

Use a connected vehicle and repeat separately for AC and DC. Confirm the initial PV Surplus mode and record the charger limits in mySigen. In TC, choose **Start charging → Temporary Fast Charging**. Verify actual charging power and confirm Start is disabled while charging. Select **Stop charging**, then confirm charging has stopped and the same Surplus mode and limits return in mySigen. Test natural completion separately when practical. To check the waiting path, confirm Stop remains available for a TC-accepted waiting session.

DC uses the existing charging-mode writer and changes only the mode. It preserves reported battery assistance, grid permission, power and vehicle-discharge settings. V2X is excluded from this workflow. The AC and DC sessions keep separate recovery records. Fresh charger telemetry gates the buttons. Stale or unbound telemetry does not stand in for an idle charger.

Record software and physical checks separately. A Beta update and closure of issue #16 require physical confirmation of both restoration paths.
