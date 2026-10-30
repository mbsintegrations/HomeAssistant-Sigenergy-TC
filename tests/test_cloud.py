import asyncio
from types import SimpleNamespace

import pytest

from custom_components.sigen_hybrid.core.cloud import CloudAdapter, async_discover_station
from custom_components.sigen_hybrid.core.errors import (
    AuthenticationError,
    CapabilityError,
    CloudLoginFailure,
    TransportError,
)


class PrivateClient:
    station_id = "synthetic-station"

    def __init__(self):
        self.connected = self.closed = self.calls = 0
        self.power_calls = 0
        self.fail = False

    async def connect(self):
        self.connected += 1

    async def close(self):
        self.closed += 1

    async def refresh_station(self):
        return {"batteryCapacity": 20}

    async def energy_flow(self):
        return {"pvPower": 0, "loadPower": 1.5, "buySellPower": 1.5, "batteryPower": 0, "batterySoc": 50}

    async def available_operational_modes(self):
        self.calls += 1
        if self.fail:
            raise ValueError("PRIVATE ACCOUNT CONTENT")
        return {"defaultWorkingModes": []}

    async def current_operational_mode(self):
        return "AI"

    async def instant_manual_control(self):
        return SimpleNamespace(enabled=False, end_time=None)

    async def battery_power_limit(self):
        self.power_calls += 1
        return {"batteryMaxChargingPower": "5.5", "batteryMaxDischargingPower": "4.25"}

    async def prediction_data(self):
        return {}


@pytest.mark.parametrize(
    "station,expected", [(12345, "12345"), (" 12345 ", "12345"), ("synthetic-plant", "synthetic-plant")]
)
async def test_station_discovery_authenticates_and_closes_once(station, expected):
    client = PrivateClient()
    client.station_id = station
    assert await async_discover_station(client) == expected
    assert client.connected == client.closed == 1


@pytest.mark.parametrize("station", [None, True, False, "", "  ", "None", "none", [], {}, 1.5])
async def test_station_discovery_rejects_invalid_identity_without_payload(station):
    client = PrivateClient()
    client.station_id = station
    with pytest.raises(CloudLoginFailure) as error:
        await async_discover_station(client)
    assert error.value.reason == "no_cloud_plant"
    assert client.closed == 1


async def test_station_discovery_failures_are_sanitized_and_close_the_client(caplog):
    from sigenergy_cloud import SigenergyCloudAPIError, SigenergyCloudAuthError, SigenergyCloudRateLimitError

    for failure, expected in [
        (SigenergyCloudAuthError("PRIVATE PASSWORD"), "invalid_auth"),
        (SigenergyCloudAPIError("PRIVATE ACCOUNT", response_body="PRIVATE BODY"), "no_cloud_plant"),
        (SigenergyCloudRateLimitError("PRIVATE QUOTA"), "cannot_connect"),
        (OSError("PRIVATE HOST"), "cannot_connect"),
        (RuntimeError("PRIVATE INTERNAL FAILURE"), "cloud_login_failed"),
        (KeyError("stationId"), "no_cloud_plant"),
        (KeyError("PRIVATE OTHER KEY"), "cloud_login_failed"),
    ]:
        client = PrivateClient()

        async def fail():
            raise failure

        client.connect = fail
        with pytest.raises(CloudLoginFailure) as error:
            await async_discover_station(client)
        assert error.value.reason == expected
        assert "PRIVATE" not in str(error.value)
        assert "PRIVATE" not in caplog.text
        assert client.closed == 1


@pytest.mark.parametrize(
    "status,expected",
    [
        (400, "invalid_auth"),
        (401, "invalid_auth"),
        (403, "cannot_connect"),
        (429, "cannot_connect"),
        (500, "cannot_connect"),
        (503, "cannot_connect"),
    ],
)
async def test_oauth_http_status_is_classified_from_fixed_prefix_only(status, expected, caplog):
    from sigenergy_cloud import SigenergyCloudAuthError

    client = PrivateClient()

    async def fail():
        raise SigenergyCloudAuthError(f"Sigenergy Cloud authentication failed: HTTP {status}; PRIVATE BODY")

    client.connect = fail
    with pytest.raises(CloudLoginFailure) as error:
        await async_discover_station(client)
    assert error.value.reason == expected
    assert f"status={status}" in caplog.text
    assert "PRIVATE" not in caplog.text
    assert client.closed == 1


async def test_oauth_body_cannot_inject_a_different_status(caplog):
    from sigenergy_cloud import SigenergyCloudAuthError

    client = PrivateClient()

    async def fail():
        raise SigenergyCloudAuthError("PRIVATE BODY: Sigenergy Cloud authentication failed: HTTP 503;")

    client.connect = fail
    with pytest.raises(CloudLoginFailure) as error:
        await async_discover_station(client)
    assert error.value.reason == "invalid_auth"
    assert "503" not in caplog.text and "PRIVATE" not in caplog.text


@pytest.mark.parametrize(
    "status,expected",
    [
        (403, "no_cloud_plant"),
        (404, "no_cloud_plant"),
        (429, "cannot_connect"),
        (503, "cannot_connect"),
        (True, "no_cloud_plant"),
        ("PRIVATE", "no_cloud_plant"),
    ],
)
async def test_plant_api_status_is_classified_without_logging_payload(status, expected, caplog):
    from sigenergy_cloud import SigenergyCloudAPIError

    client = PrivateClient()

    async def fail():
        raise SigenergyCloudAPIError("PRIVATE MESSAGE", status_code=status, response_body="PRIVATE BODY")

    client.connect = fail
    with pytest.raises(CloudLoginFailure) as error:
        await async_discover_station(client)
    assert error.value.reason == expected
    assert "PRIVATE" not in caplog.text
    assert client.closed == 1


def test_cloud_login_reason_is_allowlisted():
    with pytest.raises(ValueError, match="Unsupported"):
        CloudLoginFailure("PRIVATE ARBITRARY MESSAGE")


async def test_station_discovery_timeout_closes_client():
    client = PrivateClient()

    async def wait():
        await asyncio.Event().wait()

    client.connect = wait
    with pytest.raises(CloudLoginFailure) as error:
        await async_discover_station(client, timeout_seconds=0.01)
    assert error.value.reason == "cannot_connect"
    assert client.closed == 1


async def test_station_discovery_cancel_during_connect_closes_client():
    client = PrivateClient()
    started = asyncio.Event()

    async def wait():
        started.set()
        await asyncio.Event().wait()

    client.connect = wait
    task = asyncio.create_task(async_discover_station(client))
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert client.closed == 1


async def test_station_discovery_cancel_during_cleanup_waits_for_close():
    client = PrivateClient()
    closing, release = asyncio.Event(), asyncio.Event()

    async def close():
        closing.set()
        await release.wait()
        client.closed += 1

    client.close = close
    task = asyncio.create_task(async_discover_station(client))
    await closing.wait()
    task.cancel()
    await asyncio.sleep(0)
    assert not task.done()
    release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert client.closed == 1


async def test_station_discovery_cleanup_failure_does_not_leak_exception():
    client = PrivateClient()

    async def close():
        raise RuntimeError("PRIVATE SESSION CONTENT")

    client.close = close
    with pytest.raises(CloudLoginFailure) as error:
        await async_discover_station(client)
    assert error.value.reason == "cloud_login_failed"
    assert "PRIVATE" not in str(error.value)


async def test_private_cloud_requires_explicit_opt_in_and_station_identity():
    with pytest.raises(CapabilityError):
        CloudAdapter(PrivateClient(), "synthetic-station", unofficial_opt_in=False)
    client = PrivateClient()
    cloud = CloudAdapter(client, "different-station", unofficial_opt_in=True)
    with pytest.raises(AuthenticationError, match="match"):
        await cloud.connect()
    assert client.closed == 1


async def test_cloud_refresh_is_cached_and_empty_prediction_remains_unknown():
    client = PrivateClient()
    cloud = CloudAdapter(client, "synthetic-station", unofficial_opt_in=True)
    first, second = await asyncio.gather(cloud.refresh(), cloud.refresh())
    assert first == second and client.calls == 1 and client.connected == 1
    assert first["forecast_available"] is False
    assert first["manual_control_power"] == {"charge": {"app_default_kw": 5.5}, "discharge": {"app_default_kw": 4.25}}
    assert client.power_calls == 1
    with pytest.raises(CapabilityError):
        await cloud.set_native_mode(1)


async def test_optional_app_power_read_failure_does_not_erase_modes_or_telemetry():
    client = PrivateClient()

    async def failed_power():
        client.power_calls += 1
        raise ValueError("PRIVATE CLOUD RESPONSE")

    client.battery_power_limit = failed_power
    cloud = CloudAdapter(client, "synthetic-station", unofficial_opt_in=True)
    first, second = await asyncio.gather(cloud.refresh(), cloud.refresh())
    assert first == second and client.power_calls == 1
    assert first["manual_control_power"] == {} and first["mode"] == "AI"
    assert first["telemetry_available"] is True
    assert "PRIVATE" not in str(first)


async def test_failed_power_refresh_discards_prior_app_limits_without_losing_other_data():
    client = PrivateClient()
    cloud = CloudAdapter(client, "synthetic-station", unofficial_opt_in=True)
    assert (await cloud.refresh())["manual_control_power"]["charge"]["app_default_kw"] == 5.5
    cloud._fetched = cloud._details_fetched = float("-inf")

    async def failed_power():
        client.power_calls += 1
        raise ValueError("PRIVATE CLOUD RESPONSE")

    client.battery_power_limit = failed_power
    result = await cloud.refresh()
    assert result["manual_control_power"] == {} and result["telemetry_available"] is True
    assert result["mode"] == "AI" and client.power_calls == 2


async def test_cloud_failure_backoff_does_not_repeat_request_or_leak_payload():
    client = PrivateClient()
    client.fail = True
    cloud = CloudAdapter(client, "synthetic-station", unofficial_opt_in=True)
    with pytest.raises(TransportError) as exc:
        await cloud.refresh()
    assert "PRIVATE" not in str(exc.value)
    with pytest.raises(TransportError, match="backoff"):
        await cloud.refresh()
    assert client.calls == 1


async def test_module_reads_share_refresh_session_cache_and_keep_identity():
    class ModuleClient(PrivateClient):
        topology_calls = static_calls = dynamic_calls = pack_calls = 0

        async def device_topology(self):
            self.topology_calls += 1
            return {
                "nodeList": [
                    {
                        "deviceType": 2,
                        "snCode": "AIO1",
                        "nodeList": [
                            {"deviceType": 4, "snCode": "BAT1"},
                            {"deviceType": 4, "snCode": "BAT2"},
                        ],
                    }
                ]
            }

        async def device_tree_live_values(self, aio):
            assert aio == "AIO1"
            return []

        async def battery_module_static(self, serial):
            self.static_calls += 1
            return {}

        async def battery_module_dynamic(self, serial):
            self.dynamic_calls += 1
            return {
                "realTimeInfo": [
                    {
                        "paramKey": "Battery SOC",
                        "paramValueText": "40" if serial == "BAT1" else "70",
                        "paramValueUnit": "%",
                    }
                ]
            }

        async def battery_module_pack(self, serial):
            self.pack_calls += 1
            return {}

    client = ModuleClient()
    cloud = CloudAdapter(client, "synthetic-station", unofficial_opt_in=True)
    first, second = await asyncio.gather(cloud.refresh(), cloud.refresh())
    assert first == second and client.connected == 1
    assert client.topology_calls == 1 and client.static_calls == client.dynamic_calls == client.pack_calls == 2
    assert [module["measurements"]["soc"]["value"] for module in first["battery_modules"]] == [40, 70]
    assert first["module_read_diagnostics"]["inventory_count"] == 2
    assert first["battery_modules"][0]["read_diagnostics"]["rows"][0]["numeric_value_valid"] is True
    cloud._fetched = cloud._details_fetched = float("-inf")
    await cloud.refresh()
    assert client.topology_calls == 1 and client.static_calls == 2 and client.dynamic_calls == 4

    async def unavailable(serial):
        raise ValueError("PRIVATE DEVICE RESPONSE")

    client.battery_module_dynamic = unavailable
    cloud._fetched = cloud._details_fetched = float("-inf")
    failed = await cloud.refresh()
    assert failed["mode"] == "AI" and failed["telemetry_available"] is True
    assert all(module["measurements"] == {} for module in failed["battery_modules"])
    assert all(
        module["read_diagnostics"]["error"]["error_type"] == "ValueError" for module in failed["battery_modules"]
    )
    assert "PRIVATE" not in str(failed)
    from sigenergy_cloud import SigenergyCloudRateLimitError

    rate_limit_calls = []

    async def rate_limited(serial):
        rate_limit_calls.append(serial)
        raise SigenergyCloudRateLimitError("PRIVATE QUOTA RESPONSE")

    client.battery_module_dynamic = rate_limited
    cloud._fetched = cloud._details_fetched = float("-inf")
    limited = await cloud.refresh()
    assert rate_limit_calls == ["BAT1"]
    assert limited["battery_modules"] == [] and limited["telemetry_available"] is True
    assert "PRIVATE" not in str(limited)


async def test_module_timestamp_uses_actual_response_time_after_slow_sequential_reads(monkeypatch):
    from datetime import datetime, timedelta, timezone

    from custom_components.sigen_hybrid.core import cloud as cloud_module

    clock = [datetime(2026, 10, 27, 19, tzinfo=timezone.utc)]

    class ResponseClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return clock[0]

    class SlowModuleClient(PrivateClient):
        async def device_topology(self):
            clock[0] += timedelta(seconds=3)
            return {
                "nodeList": [
                    {
                        "deviceType": 2,
                        "snCode": "AIO1",
                        "nodeList": [
                            {"deviceType": 4, "snCode": "BAT1"},
                        ],
                    }
                ]
            }

        async def device_tree_live_values(self, aio):
            clock[0] += timedelta(seconds=3)
            return []

        async def battery_module_static(self, serial):
            clock[0] += timedelta(seconds=3)
            return {}

        async def battery_module_dynamic(self, serial):
            clock[0] += timedelta(seconds=3)
            return {
                "dataCurrTimeStamp": str(int(clock[0].timestamp() * 1000)),
                "realTimeInfo": [{"paramKey": "Battery SOC", "paramValueText": "73.5", "paramValueUnit": "%"}],
            }

        async def battery_module_pack(self, serial):
            clock[0] += timedelta(seconds=3)
            return {}

    monkeypatch.setattr(cloud_module, "datetime", ResponseClock)
    cloud = CloudAdapter(SlowModuleClient(), "synthetic-station", unofficial_opt_in=True)
    module = (await cloud.refresh())["battery_modules"][0]
    assert module["measurements"]["soc"]["value"] == 73.5
    assert module["measurements"]["soc"]["timestamp_basis"] == "device_timestamp"
    assert module["retrieved_at"] == clock[0].isoformat()



async def test_cloud_only_light_poll_reuses_details_and_preserves_their_clock(monkeypatch):
    import custom_components.sigen_hybrid.core.cloud as module
    clock=[1000.0]
    monkeypatch.setattr(module.time,"monotonic",lambda:clock[0])
    client=PrivateClient()
    cloud=CloudAdapter(client,"synthetic-station",unofficial_opt_in=True,live_refresh_seconds=60)
    first=await cloud.refresh()
    clock[0]+=61
    second=await cloud.refresh()
    assert client.calls==client.power_calls==1
    assert second["manual_control_power_observed_at"]==first["manual_control_power_observed_at"]
    clock[0]+=900
    await cloud.refresh()
    assert client.calls==client.power_calls==2
