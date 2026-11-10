# Live charger test procedure

Use a connected vehicle and repeat separately for AC and DC. Confirm the initial PV Surplus mode and record the charger limits in mySigen. In TC, choose **Start charging → Temporary Fast Charging**. Verify actual charging power and confirm Start is disabled while charging. Select **Stop charging**, then confirm charging has stopped and the same Surplus mode and limits return in mySigen. Test natural completion separately when practical. To check the waiting path, confirm Stop remains available for a TC-accepted waiting session.

DC uses the existing charging-mode writer and changes only the mode. It preserves reported battery assistance, grid permission, power and vehicle-discharge settings. V2X is excluded from this workflow. The AC and DC sessions keep separate recovery records. Fresh charger telemetry gates the buttons. Stale or unbound telemetry does not stand in for an idle charger.
