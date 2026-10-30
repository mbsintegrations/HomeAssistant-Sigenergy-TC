"""Cloud-only control evidence is explicit, bounded and never a fake flow."""

from datetime import timedelta

import pytest
from test_control_session import setup

from custom_components.sigen_hybrid.core.control_telemetry import cloud_control_telemetry
from custom_components.sigen_hybrid.core.errors import SafetyError


def cloud_only():
    clock, appliance, store, journal, session, controller, snapshot = setup()
    original = appliance._data
    header = {"stationId": 42, "status": 1, "blockClient": False, "onGrid": True, "hasInstantSetting": True}
    live = {"batterySoc": "50.5"}
    caps = {"batteryMaxChargingPower": "4294967.295", "batteryMaxDischargingPower": "2.5"}

    async def read(method, path, **kwargs):
        if path == "device/owner/station/home":
            return header
        if "/instant/manunal/display/" in path:
            return live
        if "/battery/limit/" in path:
            return caps
        return await original(method, path, **kwargs)

    appliance._data = read
    return clock, journal.provider, header, live, caps


async def test_explicit_cloud_status_and_caps_without_fabricated_solar_or_house_power():
    clock, provider, header, live, caps = cloud_only()
    result = await cloud_control_telemetry(
        provider, {"max_charge_kw": 3, "max_discharge_kw": 3}, clock=lambda: clock[0]
    )
    assert result.soc == 50.5 and result.max_charge_kw == 3 and result.max_discharge_kw == 2.5
    assert result.source == "cloud" and not hasattr(result, "pv_kw") and not hasattr(result, "home_kw")


@pytest.mark.parametrize(
    "field,value",
    [
        ("stationId", 99),
        ("stationId", True),
        ("status", 0),
        ("status", True),
        ("blockClient", True),
        ("hasInstantSetting", False),
        ("onGrid", False),
        ("onGrid", None),
    ],
)
async def test_wrong_plant_unknown_or_restricted_state_is_not_assumed_ready(field, value):
    clock, provider, header, live, caps = cloud_only()
    header[field] = value
    with pytest.raises(SafetyError):
        await cloud_control_telemetry(provider, {"max_charge_kw": 3}, clock=lambda: clock[0])


async def test_unlimited_marker_without_an_explicit_owner_cap_is_rejected():
    clock, provider, header, live, caps = cloud_only()
    with pytest.raises(SafetyError, match="explicit owner power limit"):
        await cloud_control_telemetry(provider, {}, clock=lambda: clock[0])


async def test_slow_cloud_reads_are_rejected_as_stale_without_resetting_the_clock():
    clock, provider, header, live, caps = cloud_only()
    original = provider.client._data

    async def slow_read(*args, **kwargs):
        result = await original(*args, **kwargs)
        clock[0] += timedelta(seconds=10)
        return result

    provider.client._data = slow_read
    with pytest.raises(SafetyError, match="stale"):
        await cloud_control_telemetry(provider, {"max_charge_kw": 3}, clock=lambda: clock[0])


async def test_region_is_part_of_durable_plant_identity():
    clock, provider, header, live, caps = cloud_only()
    provider.region = "eu"
    assert await provider.identity() == "cloud:eu:42"
    provider.client.station_id = "99"
    assert await provider.identity() == "cloud:eu:99"
