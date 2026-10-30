"""Additional native owner controls, with closed payloads and reversible values.

Power/reserve endpoints follow sigenergy-cloud 0.1.7. Charger and priority
payloads follow the mySigen web client's native DTOs. No installer field is
editable and every command still passes through the durable recovery journal.
"""

import hashlib
import json
import re
from copy import deepcopy
from math import isfinite

from .errors import CapabilityError, SafetyError

EXTENDED_SETTINGS = frozenset({
    "grid_connection_current", "battery_power_limits", "pv_power_limit",
    "backup_reserve", "discharge_priority", "solar_priority", "peak_shaving",
    "ac_charge_mode", "dc_charge_mode", "dc_charge_settings",
})
PATHS = {
    "grid_connection_current": "device/energy-profile/parallel/off/grid",
    "battery_power_limits": "device/energy-profile/battery/limit",
    "pv_power_limit": "device/energy-profile/solar/limit",
    "backup_reserve": "device/setting/backup/reserve",
    "discharge_priority": "device/energy-profile/battery/discharge/priority",
    "solar_priority": "device/energy-profile/solar/priority",
    "peak_shaving": "device/dischargesetting/peak/shaving",
    "ac_charge_mode": "device/charge/mode/ac",
    "dc_charge_mode": "device/charge/mode/dc",
    "dc_charge_settings": "device/dcevse/charge/setting",
}
UNLIMITED = 4_294_967.295
CHARGER_FIELDS = {
    "mode": "chargeMode", "battery_boost": "enableFromPack",
    "cutoff_soc": "cutoffSocFromPack", "grid_charging": "enableFromGrid",
    "max_grid_power_kw": "maxPowerFromGrid", "discharge_power_kw": "allowsDischargePower",
    "stop_discharging_soc": "vehicleDischargeCutoffSoc",
}


def numeric(value, low=0, high=UNLIMITED, *, optional=False, read=False):
    if optional and value in (None, ""):
        return None
    if isinstance(value, bool) or not read and type(value) not in (int, float):
        raise SafetyError("Use a finite numeric setting")
    try:
        result = float(value)
    except (ValueError, TypeError):
        raise SafetyError("The native numeric setting is unavailable") from None
    if not isfinite(result) or not low <= result <= high:
        raise SafetyError("The setting is outside its supported range")
    return result


def flag(value):
    if type(value) is not bool:
        raise SafetyError("An explicit on/off setting is required")
    return value


def fields(value, required):
    if not isinstance(value, dict) or set(value) != set(required):
        raise SafetyError("Complete, recognized native settings are required")


def validate(key, value):
    if key not in EXTENDED_SETTINGS:
        raise CapabilityError("Unknown native owner setting")
    if key == "grid_connection_current":
        fields(value, {"enabled", "limit_a"})
        flag(value["enabled"])
        numeric(value["limit_a"], high=10000, optional=not value["enabled"])
    elif key == "battery_power_limits":
        fields(value, {"charge_kw", "discharge_kw"})
        for item in value.values():
            numeric(item, optional=True)
    elif key == "pv_power_limit":
        fields(value, {"limit_kw"})
        numeric(value["limit_kw"], optional=True)
    elif key == "backup_reserve":
        fields(value, {"soc"})
        numeric(value["soc"], high=100)
        if int(value["soc"]) != value["soc"]:
            raise SafetyError("Backup reserve must be a whole percentage")
    elif key in ("discharge_priority", "solar_priority"):
        fields(value, {"order"})
        order = value["order"]
        if (not isinstance(order, list) or not 1 <= len(order) <= 64
            or any(not isinstance(item, str) or not 1 <= len(item) <= 160 for item in order)
            or len(set(order)) != len(order)):
            raise SafetyError("Each advertised energy destination must appear once")
    elif key == "peak_shaving":
        fields(value, {"enabled", "soc", "slots"})
        flag(value["enabled"])
        numeric(value["soc"], high=100)
        slots = value["slots"]
        if not isinstance(slots, list) or len(slots) > 64:
            raise SafetyError("Use at most 64 peak-shaving windows")
        for slot in slots:
            fields(slot, {"weekdays", "start", "end", "power_kw"})
            days = slot["weekdays"]
            if (not isinstance(days, list) or not days or len(days) > 7
                or any(type(day) is not int or not 1 <= day <= 7 for day in days) or len(set(days)) != len(days)):
                raise SafetyError("Choose valid native weekdays, Monday 1 to Sunday 7")
            # The same HH:MM validation used by the local strategy runner.
            for instant in (slot["start"], slot["end"]):
                if not isinstance(instant, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", instant):
                    raise SafetyError("Use HH:MM times for peak-shaving windows")
            if slot["start"] == slot["end"]:
                raise SafetyError("A peak-shaving window needs a non-zero duration")
            numeric(slot["power_kw"])
    elif key.endswith("_charge_mode"):
        fields(value, CHARGER_FIELDS)
        modes = (0, 1, 2) if key.startswith("ac_") else (0, 1, 3)
        if type(value["mode"]) is not int or value["mode"] not in modes:
            raise SafetyError("Select fast, PV surplus or Sigen AI charging")
        for field in ("battery_boost", "grid_charging"):
            if value[field] is not None:
                flag(value[field])
        for field in ("cutoff_soc", "stop_discharging_soc"):
            numeric(value[field], high=100, optional=True)
        for field in ("max_grid_power_kw", "discharge_power_kw"):
            numeric(value[field], optional=True)
    elif key == "dc_charge_settings":
        fields(value, {"power_kw", "cutoff_soc"})
        numeric(value["power_kw"])
        numeric(value["cutoff_soc"], high=100)
    if isinstance(value, dict):
        for field, item in value.items():
            if field.endswith("_kw") and item is not None and abs(item*1000-round(item*1000)) > 1e-6:
                raise SafetyError("Power settings must use whole watts (0.001 kW steps)")
        if key == "grid_connection_current" and value["limit_a"] is not None and abs(value["limit_a"]*10-round(value["limit_a"]*10)) > 1e-6:
            raise SafetyError("Grid current uses 0.1 ampere steps")


def charger_key(key):
    if not isinstance(key, str):
        return None
    if key.startswith("ac_"):
        return "ac_charging"
    if key.startswith("dc_"):
        return "dc_charging"
    return None


def parameters(provider, key):
    result = {"stationId": int(provider.station_id)}
    device = charger_key(key)
    if device:
        if device not in provider.devices:
            raise CapabilityError("Select an installed charger returned by this plant")
        result["snCode"] = provider.devices[device]
    return result


def destination_id(row):
    if row.get("loadKey") not in (None, ""):
        return str(row["loadKey"])
    identity = [row.get(field) for field in ("loadsType", "sgDeviceType", "smartLoadsPath")]
    if identity == [None, None, None]:
        raise SafetyError("The native energy destination has no identity")
    return "destination-"+hashlib.sha256(json.dumps(identity, separators=(",", ":")).encode()).hexdigest()[:20]


async def read(provider, key):
    params = parameters(provider, key)
    path = PATHS[key]
    if charger_key(key):
        data = await provider._request("GET", path, params=params)
    else:
        data = await provider._request("GET", f"{path}/{provider.station_id}")
    provider.extended_metadata[key] = deepcopy(data)
    if key == "grid_connection_current":
        raw = data.get("ownerSetLimitation")
        if raw in (None, ""):
            raw = data.get("currentLimitation")
        enabled = flag(data["enable"])
        value = {"enabled": enabled, "limit_a": numeric(raw, high=10000, optional=not enabled, read=True)}
    elif key == "battery_power_limits":
        value = {}
        for target, source in (("charge_kw", "batteryMaxChargingPower"), ("discharge_kw", "batteryMaxDischargingPower")):
            number = numeric(data[source], optional=True, read=True)
            value[target] = None if number == UNLIMITED else number
    elif key == "pv_power_limit":
        number = numeric(data["powerLimit"], optional=True, read=True)
        value = {"limit_kw": None if number == UNLIMITED else number}
    elif key == "backup_reserve":
        value = {"soc": numeric(data["backupReserve"], high=100, read=True)}
    elif key == "discharge_priority":
        value = {"order": data["priority"]}
    elif key == "solar_priority":
        if not isinstance(data, list) or any(not isinstance(row, dict) for row in data):
            raise SafetyError("The native solar destinations are unavailable")
        value = {"order": [destination_id(row) for row in sorted(data, key=lambda row: numeric(row["priority"], read=True))]}
    elif key == "peak_shaving":
        value = {"enabled": data["controlMode"] == 1, "soc": numeric(data["shavingSOC"], high=100, read=True), "slots": []}
        if data["controlMode"] not in (0, 1) or not isinstance(data["settingList"], list):
            raise SafetyError("The native peak-shaving settings are incomplete")
        for slot in data["settingList"]:
            value["slots"].append({
                "weekdays": [int(day) for day in str(slot["whichDay"]).split(",") if day],
                "start": slot["startTime"], "end": slot["endTime"], "power_kw": numeric(slot["peakPower"], read=True),
            })
    elif key.endswith("_charge_mode"):
        value = {}
        for field, native in CHARGER_FIELDS.items():
            item = data.get(native)
            value[field] = flag(item) if field in ("battery_boost", "grid_charging") and item is not None else (
                int(numeric(item, high=3, read=True)) if field == "mode" else numeric(item, optional=True, read=True)
            )
    else:
        value = {"power_kw": numeric(data["allowedChargePower"], read=True), "cutoff_soc": numeric(data["vehicleChargingCutoffSoc"], high=100, read=True)}
    validate(key, value)
    return value


def preflight(provider, key, value, current):
    validate(key, value)
    metadata = provider.extended_metadata.get(key)
    if metadata is None:
        raise SafetyError("Read current native limits before changing this setting")
    if key in ("discharge_priority", "solar_priority") and set(value["order"]) != set(current["order"]):
        raise SafetyError("Only the plant's existing energy destinations may be reordered")
    if key == "peak_shaving" and value["enabled"] and not value["slots"] and not current["enabled"]:
        raise SafetyError("Add a peak-shaving window before enabling the schedule")
    if key == "grid_connection_current":
        if value["enabled"] is False and value["limit_a"] is None and current == value:
            return
        maximum = numeric(metadata.get("installerSetLimitation"), high=10000, read=True)
        if value["enabled"] and value["limit_a"] > maximum:
            raise SafetyError("The requested current exceeds the installer ceiling")
    if key.endswith("_charge_mode"):
        for field, lo, hi in (("cutoff_soc", "socLowerLimit", "socUpperLimit"),
                              ("stop_discharging_soc", "minimumDischargeCutoffSoc", "maximumDischargeCutoffSoc")):
            if value[field] is not None:
                low = numeric(metadata.get(lo, 20 if field == "stop_discharging_soc" else 0), high=100, read=True)
                high = numeric(metadata.get(hi, 100), high=100, read=True)
                if not low <= value[field] <= high:
                    raise SafetyError("The requested SOC exceeds the charger's advertised range")
        # V2X is a separate native operation, never enabled as a charging mode.
        for field in ("discharge_power_kw", "stop_discharging_soc"):
            if value[field] != current[field]:
                raise SafetyError("Vehicle discharge settings require the separate V2X workflow")
    if key == "dc_charge_settings":
        maximum = numeric(metadata.get("ratedPower"), read=True)
        if value["power_kw"] > maximum:
            raise SafetyError("The requested DC power exceeds the charger's rated power")


async def write(provider, key, value, current):
    preflight(provider, key, value, current)
    payload = parameters(provider, key)
    method = "PUT"
    if key == "grid_connection_current":
        payload.update(enable=value["enabled"], ownerSetLimitation="" if value["limit_a"] is None else f"{value['limit_a']:.1f}", installerSetLimitation=None)
    elif key == "battery_power_limits":
        payload.update(batteryMaxChargingPower=power(value["charge_kw"]), batteryMaxDischargingPower=power(value["discharge_kw"]))
    elif key == "pv_power_limit":
        payload["powerLimit"] = power(value["limit_kw"])
    elif key == "backup_reserve":
        payload["backupReserve"] = int(value["soc"])
    elif key == "discharge_priority":
        payload["priority"] = value["order"]
    elif key == "solar_priority":
        original = {destination_id(row): row for row in provider.extended_metadata[key]}
        ranks = sorted(numeric(row["priority"], read=True) for row in original.values())
        payload["loadsPvPriorityList"] = [{
            **{field: original[item].get(field) for field in ("loadsType", "sgDeviceType", "smartLoadsPath")},
            "priority": ranks[index],
        } for index, item in enumerate(value["order"])]
    elif key == "peak_shaving":
        method = "POST"
        payload.update(controlMode=int(value["enabled"]), shavingSOC=value["soc"], settingList=[{
            "whichDay": ",".join(map(str, row["weekdays"])), "startTime": row["start"], "endTime": row["end"], "peakPower": row["power_kw"],
        } for row in value["slots"]])
    elif key.endswith("_charge_mode"):
        method = "POST"
        payload.update({native: value[field] for field, native in CHARGER_FIELDS.items() if value[field] is not None})
    else:
        method = "POST"
        payload.update(allowedChargePower=value["power_kw"], vehicleChargingCutoffSoc=value["cutoff_soc"])
    await provider._request(method, PATHS[key], json=payload)


def power(value):
    return f"{UNLIMITED if value is None else value:.3f}"


def matches(requested, observed):
    """JSON numeric spelling may change, but booleans and shapes remain strict."""
    if type(requested) in (int, float) and type(observed) in (int, float):
        return isfinite(requested) and isfinite(observed) and abs(requested-observed) < 1e-6
    if isinstance(requested, dict) and isinstance(observed, dict):
        return set(requested) == set(observed) and all(matches(requested[key], observed[key]) for key in requested)
    if isinstance(requested, list) and isinstance(observed, list):
        return len(requested) == len(observed) and all(matches(a, b) for a, b in zip(requested, observed, strict=True))
    return type(requested) is type(observed) and requested == observed
