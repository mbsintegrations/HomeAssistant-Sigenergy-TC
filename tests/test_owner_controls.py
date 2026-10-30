"""Native gateway/charger request formats, using simulated appliances only."""

from datetime import datetime, timezone

import pytest

from custom_components.sigen_hybrid.core.control_providers import CloudControlSettings
from custom_components.sigen_hybrid.core.errors import CapabilityError, ConfirmationError, SafetyError


class Appliance:
    station_id = "42"

    def __init__(self):
        self.calls = []
        self.grid = 0
        self.show_button = True
        self.charger = 0
        self.accept = True
        self.transition = True

    async def _data(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if path == "device/gateway/gateway-status":
            return {"onOffGridStatus": self.grid, "showButton": self.show_button}
        if path in ("device/acevse/charge/status", "device/dcevse/status"):
            return self.charger
        raise AssertionError(path)

    async def _envelope(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if path == "device/gateway/ongrid-state/update":
            if self.accept and self.transition:
                self.grid = 0 if kwargs["json"]["onGridState"] == 0 else 2
            return {"code": 0, "data": 0 if self.accept else 1}
        if path in ("device/acevse/charge/start", "device/dcevse/charge/start"):
            if self.accept and self.transition:
                self.charger = 3 if kwargs["params"]["enable"] == 0 else 0
            return {"code": 0, "data": {"successful": self.accept, "errorCode": 0}}
        raise AssertionError(path)


async def no_sleep(_seconds):
    pass


def provider(appliance):
    return CloudControlSettings(
        appliance,
        "42",
        gateway=True,
        ac_serial="AC_TEST",
        dc_serial="DC_TEST",
        sleep=no_sleep,
        clock=lambda: datetime(2026, 10, 30, tzinfo=timezone.utc),
    )


async def test_gateway_request_uses_post_and_command_value_one_for_manual_off_grid():
    appliance = Appliance()
    settings = provider(appliance)
    await settings.write("grid_connection", False)
    write = [call for call in appliance.calls if call[0] != "GET"]
    assert write == [("POST", "device/gateway/ongrid-state/update", {"json": {"stationId": 42, "onGridState": 1}})]
    assert await settings.read(["grid_connection"]) == {"grid_connection": False}
    await settings.write("grid_connection", True)
    assert appliance.calls[-2][2]["json"]["onGridState"] == 0
    assert appliance.grid == 0


@pytest.mark.parametrize("state,show", [(1, True), (3, True), (0, False), (0, None)])
async def test_outage_generator_and_missing_owner_permission_never_send_a_grid_command(state, show):
    appliance = Appliance()
    appliance.grid, appliance.show_button = state, show
    with pytest.raises(SafetyError):
        await provider(appliance).write("grid_connection", True if state else False)
    assert all(call[0] == "GET" for call in appliance.calls)


@pytest.mark.parametrize("accepted,transition", [(False, False), (True, False)])
async def test_grid_rejection_or_slow_readback_never_retries_the_mutation(accepted, transition):
    appliance = Appliance()
    appliance.accept, appliance.transition = accepted, transition
    with pytest.raises(ConfirmationError):
        await provider(appliance).write("grid_connection", False)
    assert len([call for call in appliance.calls if call[0] == "POST"]) == 1
    assert len([call for call in appliance.calls if call[0] == "GET"]) <= 5


@pytest.mark.parametrize("kind,family,serial", [("ac", "acevse", "AC_TEST"), ("dc", "dcevse", "DC_TEST")])
async def test_charger_start_stop_uses_bound_serial_and_vendor_enable_direction(kind, family, serial):
    appliance = Appliance()
    settings = provider(appliance)
    await settings.write(f"{kind}_charging", True)
    assert appliance.calls[-1] == (
        "PUT",
        f"device/{family}/charge/start",
        {"params": {"stationId": 42, "snCode": serial, "enable": 0}},
    )
    assert (await settings.read([f"{kind}_charging"]))[f"{kind}_charging"] is True
    await settings.write(f"{kind}_charging", False)
    assert appliance.calls[-1][2]["params"]["enable"] == 1


async def test_absent_devices_and_v2g_cannot_be_addressed_as_ordinary_charging():
    appliance = Appliance()
    settings = CloudControlSettings(appliance, "42")
    for key in ("grid_connection", "ac_charging", "dc_charging"):
        with pytest.raises(CapabilityError):
            await settings.write(key, False)
    assert not appliance.calls
    appliance.charger = 8
    with pytest.raises(SafetyError, match="Vehicle-to-grid"):
        await provider(appliance).write("dc_charging", False)
    assert all(call[0] == "GET" for call in appliance.calls)


async def test_recovery_never_restarts_an_old_manual_override_or_charging_session():
    appliance = Appliance()
    settings = provider(appliance)
    await settings.restore("ac_charging", True)
    assert appliance.calls[-1][2]["params"]["enable"] == 1
    assert settings.matches_restored("ac_charging", True, False)
    assert settings.matches_restored("manual", {"enabled": True, "mode": "0"}, {"enabled": False})
