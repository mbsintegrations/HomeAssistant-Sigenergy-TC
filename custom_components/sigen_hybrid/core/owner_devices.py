"""Named owner-app device reads and unit-checked battery telemetry.

These GET paths were verified in the owner's mySigen device details. They use
the existing authenticated client; no browser token or additional login is used.
"""

from __future__ import annotations

import asyncio
import json
import math
import re
from datetime import datetime, timezone


class OwnerDeviceReads:
    """Delegate the upstream client, adding only fixed read-only device methods."""

    def __init__(self, client):
        self.client = client
        self._login_lock = asyncio.Lock()
        self._logged_in = False

    async def connect(self):
        async with self._login_lock:
            if not self._logged_in:
                await self.client.connect()
                self._logged_in = True

    def __getattr__(self, name):
        return getattr(self.client, name)

    async def energy_flow(self):
        # The pinned upstream client's async call omits the native app's `id`
        # query. Bind it explicitly instead of relying on a server default plant
        # or paying for a failed call followed by its fallback on each poll.
        return await self.client._data(
            "GET",
            "device/sigen/station/energyflow/async",
            params={"id": self.client._station_id(), "refreshFlag": "false"},
        )

    @staticmethod
    def _serial(value):
        if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", value):
            raise ValueError("Invalid device identity")
        return value

    async def battery_module_dynamic(self, serial):
        return await self.client._data(
            "GET",
            "device/sigen/device/dynamic/info",
            params={
                "stationId": self.client._station_id(),
                "deviceType": 4,
                "snCode": self._serial(serial),
                "refreshFlag": "",
            },
        )

    async def battery_module_static(self, serial):
        return await self.client._data(
            "GET",
            "device/sigen/device/static/info",
            params={
                "stationId": self.client._station_id(),
                "deviceType": 4,
                "snCode": self._serial(serial),
            },
        )

    async def battery_module_pack(self, serial):
        return await self.client._data(
            "GET",
            "device/device/pack/queryPackMergeInfo",
            params={
                "stationId": self.client._station_id(),
                "snCode": self._serial(serial),
            },
        )

    async def device_tree_live_values(self, aio_serial):
        return await self.client._data(
            "GET",
            "device/devicetreepanel/liveValue",
            params={
                "stationId": self.client._station_id(),
                "aioSnCode": self._serial(aio_serial),
                "refreshFlag": "false",
            },
        )

    @staticmethod
    def _history_date(value):
        if not isinstance(value, str) or not re.fullmatch(r"[0-9]{8}", value):
            raise ValueError("Expected a calendar date in YYYYMMDD format")
        parsed = datetime.strptime(value, "%Y%m%d")
        if parsed.strftime("%Y%m%d") != value:
            raise ValueError("Invalid calendar date")
        return value

    async def history_energy(self, *, start_date, end_date, date_flag):
        """Read the fixed station energy chart endpoint with validated dates."""
        start, end = self._history_date(start_date), self._history_date(end_date)
        if end < start or type(date_flag) is not int or date_flag not in (1, 2, 3, 4, 5):
            raise ValueError("Unsupported energy-history period")
        return await self.client._data(
            "GET",
            "data-process/sigen/station/statistics/v1/energy",
            params={"stationId": self.client._station_id(), "startDate": start, "endDate": end, "dateFlag": date_flag},
        )

    async def history_tariff_soc(self, *, date):
        """Read the fixed daily tariff/SOC endpoint using the current session."""
        return await self.client._data(
            "GET",
            "data-process/sigen/station/statistics/tariff-soc/day",
            params={"stationId": self.client._station_id(), "dt": self._history_date(date)},
        )


def numeric(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        result = float(value)
    except TypeError, ValueError, OverflowError:
        return None
    return result if math.isfinite(result) else None


def source_timestamp(value, now):
    """Accept real provider clocks only; never substitute retrieval time."""
    if value in (None, "") or isinstance(value, bool):
        return None
    try:
        number = numeric(value)
        if number is not None:
            stamp = datetime.fromtimestamp(number / 1000 if number > 1e11 else number, timezone.utc)
        else:
            stamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if stamp.tzinfo is None or not -5 <= (now - stamp).total_seconds() <= 1800:
            return None
        return stamp.isoformat()
    except ValueError, OverflowError, OSError:
        return None


def system_inventory(topology, station=None):
    """Only advertised identities/presence; never invent optimizers or modules."""
    found = []
    station = station if isinstance(station, dict) else {}

    def walk(nodes, depth=0):
        if depth > 10 or not isinstance(nodes, list):
            return
        for node in nodes[:128]:
            if not isinstance(node, dict):
                continue
            serial = node.get("snCode") or node.get("showSnCode")
            kind = {"2": "inverter", "4": "battery_module"}.get(str(node.get("deviceType")))
            if kind and isinstance(serial, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", serial):
                item = {"id": serial, "serial": serial, "type": kind, "installed": True}
                model = node.get("modelName") or node.get("machineModel")
                if isinstance(model, str) and 0 < len(model) <= 120:
                    item["model"] = model
                if not any(old["id"] == serial for old in found):
                    found.append(item)
            walk(node.get("nodeList"), depth+1)

    walk(topology.get("nodeList") if isinstance(topology, dict) else None)
    for flag, kind, serials in (("hasGateway", "gateway", None), ("hasAcCharger", "ac", "acSnList"), ("hasEv", "dc", "dcSnList")):
        if station.get(flag) is False:
            found.append({"id": kind, "type": kind, "installed": False})
        elif station.get(flag) is True:
            identities = station.get(serials, []) if serials else [kind]
            if isinstance(identities, list):
                for serial in identities[:32]:
                    if isinstance(serial, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", serial):
                        found.append({"id": serial, "serial": serial if serials else None, "type": kind, "installed": True})
    if station.get("hasPv") is True or (numeric(station.get("pvCapacity")) or 0) > 0:
        found.append({"id": "solar", "type": "solar", "installed": True})
    return found[:128]


def battery_inventory(topology):
    """Retain exact module identity and its own AIO parent, never aggregate SNs."""
    found = {}

    def walk(nodes, aio=None, depth=0):
        if depth > 10 or not isinstance(nodes, list):
            return
        for node in nodes[:128]:
            if not isinstance(node, dict):
                continue
            serial = node.get("snCode") or node.get("showSnCode")
            kind = str(node.get("deviceType"))
            parent = serial if kind == "2" else aio
            if kind == "4" and isinstance(serial, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", serial):
                found.setdefault(serial, {"serial": serial, "aio_serial": parent})
            walk(node.get("nodeList"), parent, depth + 1)

    if isinstance(topology, dict):
        walk(topology.get("nodeList"))
    return list(found.values())[:32]


def device_read_error(error):
    """Expose bounded error identity/codes, never provider messages or bodies."""
    status = getattr(error, "status_code", None)
    result = {
        "error_type": type(error).__name__,
        "http_status": status if type(status) is int and 100 <= status <= 599 else None,
    }
    body = getattr(error, "response_body", None)
    if isinstance(body, str) and len(body) <= 65536:
        try:
            code = json.loads(body).get("code")
            if (
                type(code) is int
                and abs(code) <= 99999999
                or isinstance(code, str)
                and re.fullmatch(r"-?[0-9]{1,8}", code)
            ):
                result["provider_code"] = code
        except ValueError, AttributeError:
            pass
    return result


def device_clock_schema(value, now):
    """Describe a provider clock without retaining its raw value."""
    result = {"python_type": type(value).__name__, "present": value not in (None, "")}
    if value in (None, "") or isinstance(value, bool):
        result["format"] = "absent" if value in (None, "") else "invalid_boolean"
        return result
    number = numeric(value)
    if number is not None:
        magnitude = abs(number)
        divisor = 1e9 if magnitude > 1e17 else 1e6 if magnitude > 1e14 else 1000 if magnitude > 1e11 else 1
        result["format"] = {
            1: "epoch_seconds",
            1000: "epoch_milliseconds",
            1e6: "epoch_microseconds",
            1e9: "epoch_nanoseconds",
        }[divisor]
        try:
            result["age_seconds"] = round(
                (now - datetime.fromtimestamp(number / divisor, timezone.utc)).total_seconds(), 3
            )
        except ValueError, OSError, OverflowError:
            result["epoch_range_valid"] = False
        return result
    if isinstance(value, str):
        try:
            stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
            result["format"] = "iso_aware" if stamp.tzinfo else "iso_without_timezone"
            if stamp.tzinfo:
                result["age_seconds"] = round((now - stamp).total_seconds(), 3)
            return result
        except ValueError:
            result["string_length"] = len(value)
    result["format"] = "unrecognized"
    return result


def device_dynamic_schema(value, now):
    """Describe field labels, types and units; exclude readings and identities."""
    result = {"response_type": type(value).__name__}
    if not isinstance(value, dict):
        return result
    result["known_keys"] = [key for key in ("realTimeInfo", "dataCurrTimeStamp", "paramInfoVOList") if key in value]
    result["clock"] = device_clock_schema(value.get("dataCurrTimeStamp"), now)
    rows = value.get("realTimeInfo")
    result["rows_type"] = type(rows).__name__
    result["row_count"] = len(rows) if isinstance(rows, list) else None
    result["rows"] = []
    units = {"", "%", "W", "kW", "MW", "Wh", "kWh", "MWh", "V", "A", "℃", "°C", "C", "\u00e2\u201e\u0192"}
    for row in rows[:20] if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        key, unit, text = row.get("paramKey"), row.get("paramValueUnit"), row.get("paramValueText")
        result["rows"].append(
            {
                "param_key": key[:80] if isinstance(key, str) else None,
                "unit": unit if isinstance(unit, str) and unit in units else "unrecognized",
                "value_text_type": type(text).__name__,
                "value_text_present": text not in (None, ""),
                "value_text_numeric": numeric(text) is not None,
                "numeric_value_valid": numeric(text) is not None,
                "known_heating_enum": text in ("On", "Off"),
                "value_type": type(row.get("paramValue")).__name__,
            }
        )
    return result


def device_topology_schema(topology):
    """Identify CMU-parent/type relationships while excluding every serial."""
    rows = []

    def walk(nodes, parent=None, depth=0):
        if not isinstance(nodes, list) or depth > 10:
            return
        for node in nodes[:128]:
            if not isinstance(node, dict):
                continue
            kind, serial = node.get("deviceType"), node.get("snCode") or node.get("showSnCode")
            rows.append(
                {
                    "device_type": kind if isinstance(kind, (str, int)) else None,
                    "serial_category": "CMU"
                    if isinstance(serial, str) and serial.upper().startswith("CMU")
                    else "other",
                    "parent_device_type": parent,
                    "depth": depth,
                }
            )
            walk(node.get("nodeList"), kind, depth + 1)

    if isinstance(topology, dict):
        walk(topology.get("nodeList"))
    return rows


def _parameters(body, key):
    return (
        {
            item.get("paramKey"): item
            for item in (body.get(key) or [])
            if isinstance(item, dict) and isinstance(item.get("paramKey"), str)
        }
        if isinstance(body, dict) and isinstance(body.get(key), list)
        else {}
    )


def _measurement(rows, name, units, *, low=None, high=None):
    row = rows.get(name, {})
    unit = row.get("paramValueUnit")
    # Some owner-app response decoders render UTF-8 ℃ through Windows-1252.
    # Normalize only this observed spelling, retaining strict dimensional checks.
    if unit == "\u00e2\u201e\u0192":
        unit = "℃"
    if unit not in units:
        return None
    value = numeric(row.get("paramValueText"))
    if value is None:
        return None
    value *= units[unit]
    return value if (low is None or value >= low) and (high is None or value <= high) else None


def battery_module_data(identity, dynamic, pack, static, live_values, now):
    """Map own module fields, retaining signed power and honest timestamp bases."""
    serial = identity["serial"]
    dynamic = dynamic if isinstance(dynamic, dict) else {}
    pack = pack if isinstance(pack, dict) else {}
    static = static if isinstance(static, dict) else {}
    real = _parameters(dynamic, "realTimeInfo")
    cells = _parameters(pack, "paramInfoVOList")
    info = _parameters(static, "paramInfoVOList")
    # A response for another serial must never populate this module.
    returned_serial = info.get("Device SN", {}).get("paramValueText")
    if returned_serial not in (None, serial):
        return {"serial": serial, "available": False, "measurements": {}}
    retrieved = now.isoformat()
    stamp_supplied = dynamic.get("dataCurrTimeStamp") not in (None, "")
    stamp = source_timestamp(dynamic.get("dataCurrTimeStamp"), now)
    basis = "device_timestamp" if stamp else "cloud_retrieval"
    measurements = {}

    def add(key, value, unit, *, observed=stamp, timestamp_basis=basis):
        if value is not None:
            measurements[key] = {
                "value": value,
                "unit": unit,
                "observed_at": observed,
                "retrieved_at": retrieved,
                "timestamp_basis": timestamp_basis,
            }

    if not stamp_supplied or stamp:
        add("soc", _measurement(real, "Battery SOC", {"%": 1}, low=0, high=100), "%")
        add("power_kw", _measurement(real, "Charging & Discharging Power", {"kW": 1, "W": 0.001}), "kW")
        add("voltage_v", _measurement(real, "Battery Pack Voltage", {"V": 1}, low=0, high=1500), "V")
        heating = real.get("Heating status", {}).get("paramValueText")
        add("heating", heating if heating in ("On", "Off") else None, None)
    # The tree value is this module's SOC with an independently supplied clock.
    for item in live_values if isinstance(live_values, list) else []:
        if not isinstance(item, dict) or item.get("snCode") != serial or str(item.get("deviceType")) != "4":
            continue
        tree_stamp = source_timestamp(item.get("dateCurrTimeStamp"), now)
        soc = numeric(item.get("value"))
        if tree_stamp and soc is not None and 0 <= soc <= 100:
            add("soc", soc, "%", observed=tree_stamp, timestamp_basis="device_tree_timestamp")
    # Pack endpoints omit a measurement timestamp. Declare retrieval basis.
    add(
        "temperature_c",
        _measurement(cells, "Average Cell Temperature", {"℃": 1, "°C": 1, "C": 1}, low=-80, high=150),
        "°C",
        observed=None,
        timestamp_basis="cloud_retrieval",
    )
    add(
        "cell_voltage_v",
        _measurement(cells, "Average Cell Voltage", {"V": 1}, low=0, high=10),
        "V",
        observed=None,
        timestamp_basis="cloud_retrieval",
    )
    add(
        "total_discharge_kwh",
        _measurement(cells, "Total Discharge Amount", {"kWh": 1, "Wh": 0.001, "MWh": 1000}, low=0),
        "kWh",
        observed=None,
        timestamp_basis="cloud_retrieval",
    )
    return {
        "serial": serial,
        "available": bool(measurements),
        "measurements": measurements,
        "retrieved_at": retrieved,
        "model": info.get("Device Model", {}).get("paramValueText"),
        "firmware": info.get("Software Version", {}).get("paramValueText") or static.get("softwareVersion"),
        "rated_energy_kwh": _measurement(info, "Rated Battery Capacity", {"kWh": 1, "Wh": 0.001}, low=0),
    }
