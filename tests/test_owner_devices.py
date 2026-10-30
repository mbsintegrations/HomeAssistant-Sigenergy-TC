import json
from datetime import datetime, timedelta, timezone

import pytest

from custom_components.sigen_hybrid.core.owner_devices import (
    OwnerDeviceReads,
    battery_inventory,
    battery_module_data,
    device_clock_schema,
    device_dynamic_schema,
    device_read_error,
    device_topology_schema,
)

NOW = datetime(2026, 10, 27, 19, 15, tzinfo=timezone.utc)


def row(key, value, unit):
    return {"paramKey": key, "paramValueText": value, "paramValueUnit": unit}


def test_module_identity_and_timestamps_never_reuse_aggregate():
    data = battery_module_data(
        {"serial": "BAT1"},
        {
            "realTimeInfo": [
                row("Battery SOC", "73.5", "%"),
                row("Charging & Discharging Power", "-0.618", "kW"),
                row("Battery Pack Voltage", "29.8", "V"),
                row("Heating status", "Off", ""),
            ],
            "dataCurrTimeStamp": "",
        },
        {"paramInfoVOList": [row("Average Cell Temperature", "20.3", "℃")]},
        {},
        [
            {"snCode": "BAT2", "deviceType": 4, "value": "99", "dateCurrTimeStamp": NOW.timestamp() * 1000},
            {"snCode": "BAT1", "deviceType": 4, "value": "73.6", "dateCurrTimeStamp": NOW.timestamp() * 1000},
        ],
        NOW,
    )
    measurements = data["measurements"]
    assert measurements["soc"]["value"] == 73.6
    assert measurements["soc"]["timestamp_basis"] == "device_tree_timestamp"
    assert measurements["power_kw"]["value"] == -0.618
    assert measurements["power_kw"]["observed_at"] is None
    assert measurements["power_kw"]["timestamp_basis"] == "cloud_retrieval"
    assert measurements["temperature_c"]["value"] == 20.3


def test_invalid_units_missing_values_and_stale_supplied_clock_are_not_zero():
    dynamic = {
        "realTimeInfo": [row("Battery SOC", "80", "%"), row("Battery Pack Voltage", "123", "kW")],
        "dataCurrTimeStamp": (NOW - timedelta(hours=1)).timestamp() * 1000,
    }
    data = battery_module_data({"serial": "BAT1"}, dynamic, {}, {}, [], NOW)
    assert data["available"] is False and data["measurements"] == {}
    dynamic["dataCurrTimeStamp"] = ""
    data = battery_module_data({"serial": "BAT1"}, dynamic, {}, {}, [], NOW)
    assert set(data["measurements"]) == {"soc"}
    assert "temperature_c" not in data["measurements"]


def test_returned_serial_mismatch_rejected_and_zero_preserved():
    dynamic = {"realTimeInfo": [row("Charging & Discharging Power", "0", "W")]}
    wrong = {"paramInfoVOList": [row("Device SN", "BAT2", "")]}
    assert battery_module_data({"serial": "BAT1"}, dynamic, {}, wrong, [], NOW)["measurements"] == {}
    assert battery_module_data({"serial": "BAT1"}, dynamic, {}, {}, [], NOW)["measurements"]["power_kw"]["value"] == 0


def test_inventory_discovers_only_own_modules_and_parent_aio():
    topology = {
        "nodeList": [
            {
                "deviceType": 2,
                "snCode": "AIO1",
                "nodeList": [
                    {"deviceType": 3, "snCode": "INV1", "nodeList": [{"deviceType": 4, "snCode": "BAT1"}]},
                    {"deviceType": 4, "snCode": "BAD/ID"},
                    {"deviceType": 4, "snCode": "BAT1"},
                ],
            }
        ]
    }
    assert battery_inventory(topology) == [{"serial": "BAT1", "aio_serial": "AIO1"}]


@pytest.mark.parametrize("unit", ["℃", "°C", "\u00e2\u201e\u0192"])
def test_observed_temperature_unit_encodings_are_strictly_normalized(unit):
    pack = {"paramInfoVOList": [row("Average Cell Temperature", "20.3", unit)]}
    actual = battery_module_data({"serial": "BAT1"}, {}, pack, {}, [], NOW)
    assert actual["measurements"]["temperature_c"]["value"] == 20.3
    assert actual["measurements"]["temperature_c"]["unit"] == "°C"
    pack["paramInfoVOList"][0]["paramValueUnit"] = "kW"
    assert battery_module_data({"serial": "BAT1"}, {}, pack, {}, [], NOW)["measurements"] == {}


def test_schema_trace_distinguishes_numeric_placeholder_and_heating_without_readings():
    dynamic = {
        "dataCurrTimeStamp": "",
        "private_account_field": "PRIVATE_ACCOUNT",
        "realTimeInfo": [
            row("Battery SOC", "73.5", "%"),
            row("Charging & Discharging Power", "--", "kW"),
            row("Heating status", "On", ""),
            row("Device SN", "PRIVATE_DEVICE_ID", ""),
        ],
    }
    trace = device_dynamic_schema(dynamic, NOW)
    assert trace["clock"]["format"] == "absent"
    assert trace["rows"][0]["numeric_value_valid"] is True
    assert trace["rows"][1]["numeric_value_valid"] is False
    assert trace["rows"][1]["value_text_present"] is True
    assert trace["rows"][2]["known_heating_enum"] is True
    assert "PRIVATE" not in json.dumps(trace) and '"73.5"' not in json.dumps(trace)
    topology = {
        "nodeList": [
            {
                "deviceType": 1,
                "snCode": "CMU_PRIVATE_ID",
                "nodeList": [
                    {
                        "deviceType": 2,
                        "snCode": "PRIVATE_INVERTER",
                        "nodeList": [{"deviceType": 4, "snCode": "PRIVATE_MODULE"}],
                    },
                ],
            }
        ]
    }
    tree = device_topology_schema(topology)
    assert tree[0]["serial_category"] == "CMU" and tree[2]["parent_device_type"] == 2
    assert "PRIVATE" not in json.dumps(tree)


def test_schema_clock_and_sdk_error_trace_do_not_return_raw_values_or_messages():
    assert device_clock_schema("2026-10-27 19:15:00", NOW)["format"] == "iso_without_timezone"
    clock = device_clock_schema(str(int(NOW.timestamp() * 1000)), NOW)
    assert clock["format"] == "epoch_milliseconds" and clock["age_seconds"] == 0
    error = type("SigenergyCloudAPIError", (Exception,), {})("PRIVATE_MESSAGE")
    error.status_code = 400
    error.response_body = '{"code":42,"msg":"PRIVATE_BODY"}'
    assert device_read_error(error) == {"error_type": "SigenergyCloudAPIError", "http_status": 400, "provider_code": 42}
    error.response_body = '{"code":true,"msg":"PRIVATE_BODY"}'
    assert "provider_code" not in device_read_error(error)


async def test_named_methods_only_get_fixed_paths_with_existing_client():
    class Client:
        calls = []

        def _station_id(self):
            return "synthetic-station"

        async def _data(self, method, path, **kwargs):
            self.calls.append((method, path, kwargs))
            return {}

    client = Client()
    wrapper = OwnerDeviceReads(client)
    await wrapper.battery_module_dynamic("BAT1")
    await wrapper.battery_module_static("BAT1")
    await wrapper.battery_module_pack("BAT1")
    await wrapper.device_tree_live_values("AIO1")
    await wrapper.energy_flow()
    assert all(method == "GET" for method, _, _ in client.calls)
    assert len(client.calls) == 5
    assert client.calls[-1] == (
        "GET",
        "device/sigen/station/energyflow/async",
        {"params": {"id": "synthetic-station", "refreshFlag": "false"}},
    )
    assert client.calls[0][2]["params"] == {
        "stationId": "synthetic-station",
        "deviceType": 4,
        "snCode": "BAT1",
        "refreshFlag": "",
    }
    with pytest.raises(ValueError):
        await wrapper.battery_module_dynamic("https://unexpected.invalid")
    assert len(client.calls) == 5


async def test_history_reads_are_named_allowlisted_and_dates_are_validated():
    class Client:
        calls = []

        def _station_id(self):
            return "synthetic-station"

        async def _data(self, method, path, **kwargs):
            self.calls.append((method, path, kwargs))
            return {}

    client = Client()
    wrapper = OwnerDeviceReads(client)
    await wrapper.history_energy(start_date="20261026", end_date="20261027", date_flag=2)
    await wrapper.history_tariff_soc(date="20261027")
    assert len(client.calls) == 2 and all(item[0] == "GET" for item in client.calls)
    assert client.calls[0][1] == "data-process/sigen/station/statistics/v1/energy"
    assert client.calls[1][2]["params"] == {"stationId": "synthetic-station", "dt": "20261027"}
    for start, end, flag in [
        ("20260230", "20261027", 1),
        ("20261027", "20261026", 1),
        ("20261026", "20261027", True),
        ("20261026", "20261027", 999),
    ]:
        with pytest.raises(ValueError):
            await wrapper.history_energy(start_date=start, end_date=end, date_flag=flag)
    assert len(client.calls) == 2
    await wrapper.history_energy(start_date="20261027", end_date="20261231", date_flag=5)
    assert client.calls[-1][2]["params"]["dateFlag"] == 5
