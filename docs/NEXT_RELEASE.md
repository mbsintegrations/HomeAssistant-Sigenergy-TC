# Charging follow-up

[0.2.9 Beta](release-0.2.9.md) includes the AC temporary Fast Charging session and restoration logic. Follow [issue #16](https://github.com/mbsintegrations/HomeAssistant-Sigenergy-TC/issues/16) for physical verification of automatic restoration, state-aware AC/DC button availability, and DC temporary charging-mode overrides.

Test automatic AC restoration with a connected vehicle and AC PV Surplus mode. Record the original mode and limits. Start **Temporary Fast Charging**, verify that energy is flowing, then stop the session or let the vehicle finish. Verify the original mode and limits in mySigen. Automatic restoration requires Home Assistant and Cloud connectivity.
