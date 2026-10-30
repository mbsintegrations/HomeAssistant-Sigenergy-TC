"""Closed owner settings, using freshly advertised plant modes and devices."""

from .errors import CapabilityError, SafetyError

SETTINGS = frozenset({"native_mode", "grid_connection", "ac_charging", "dc_charging", "battery_levels"})


def mode_catalogue(data):
    """Keep provider identities; never infer operation codes from translated labels."""
    if not isinstance(data, dict):
        raise SafetyError("The plant's operating modes are unavailable")
    if not isinstance(data.get("defaultWorkingModes"), list) or not isinstance(data.get("energyProfileItems") or [], list):
        raise SafetyError("The plant's operating mode list is incomplete")
    result = []
    for item in data.get("defaultWorkingModes", []):
        if not isinstance(item, dict):
            continue
        raw, label = item.get("value"), item.get("label")
        if type(raw) not in (str, int) or not str(raw).isascii() or not str(raw).isdecimal():
            continue
        mode = int(raw)
        if mode not in (0, 1, 2, 5, 7) or not isinstance(label, str) or not label.strip():
            continue
        result.append({"mode": mode, "profile_id": -1, "label": label[:150]})
    for item in data.get("energyProfileItems") or []:
        if not isinstance(item, dict):
            continue
        profile, label = item.get("profileId"), item.get("name")
        if type(profile) is int and profile > 0 and isinstance(label, str) and label.strip():
            result.append({"mode": 9, "profile_id": profile, "label": label[:150]})
    identities = [(item["mode"], item["profile_id"]) for item in result]
    if not result or len(set(identities)) != len(identities):
        raise SafetyError("The plant's operating mode identities are incomplete or ambiguous")
    return result


async def prepare_setting(provider, key, value, *, owner_limits, station, serial=None):
    """Read permissions before validation and before the write-ahead journal."""
    if key not in SETTINGS:
        raise CapabilityError("This owner setting is not supported")
    if key == "native_mode":
        catalogue = mode_catalogue(
            await provider._request("GET", f"device/energy-profile/mode/all/{provider.station_id}")
        )
        provider.native_modes = frozenset(item["mode"] for item in catalogue)
        provider.profiles = frozenset(item["profile_id"] for item in catalogue if item["mode"] == 9)
        provider.mode_options = catalogue
        provider.validate(key, value)
        selected = next(
            (item for item in catalogue if (item["mode"], item["profile_id"]) == (value["mode"], value["profile_id"])),
            None,
        )
        if selected is None:
            raise SafetyError("Select an operating mode advertised by this plant")
        # V2.9's native mode enum: 5 is fully feed-in. Do not enable an export
        # strategy without explicit owner approval, or alter the site export cap.
        if value["mode"] == 5 and owner_limits.export_permitted is not True:
            raise SafetyError("Export approval is required for fully feed-in mode")
    elif key == "grid_connection":
        provider.gateway = station.get("hasGateway") is True
    elif key in ("ac_charging", "dc_charging"):
        kind = "ac" if key == "ac_charging" else "dc"
        if station.get("hasAcCharger" if kind == "ac" else "hasEv") is not True:
            raise CapabilityError("The plant is not advertising this installed charger")
        serials = station.get(f"{kind}SnList")
        if not isinstance(serials, list) or not serials or any(not isinstance(item, str) for item in serials):
            raise CapabilityError("No charger identity was returned by this plant")
        if serial is None and len(serials) == 1:
            serial = serials[0]
        if serial not in serials:
            raise SafetyError("Select the exact charger returned by this plant")
        # Reuse the provider's serial validator; arbitrary service targets are forbidden.
        bound = type(provider)(
            provider.client,
            provider.station_id,
            **{"ac_serial" if kind == "ac" else "dc_serial": serial},
        )
        provider.devices[key] = bound.devices[key]
    elif key == "battery_levels":
        provider.validate(key, value)
        if value["discharge_soc"] < owner_limits.reserve_soc or value["charge_soc"] > owner_limits.charge_ceiling_soc:
            raise SafetyError("Battery SOC thresholds exceed the configured owner limits")
        current = (await provider.read([key]))[key]
        if "ja12_soc" in current and "ja12_soc" not in value:
            value = {**value, "ja12_soc": current["ja12_soc"]}
        provider._preserve_extra_soc(value, current)
    provider.validate(key, value)
    return value


async def setting_preview(provider, key, value):
    before = await provider.read([key])
    provider.validate_restore(key, before[key])
    provider.preflight([(key, value)], before)
    return {"phase": "preview", "setting": key, "before": before[key], "requested": value}
