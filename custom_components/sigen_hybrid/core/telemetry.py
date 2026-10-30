"""Normalize documented cloud readings without creating local control telemetry."""

from math import isfinite


def number(value):
    if isinstance(value, bool) or value is None or not isinstance(value, (int, float, str)):
        return None
    try:
        result = float(value)
    except ValueError, TypeError:
        return None
    return result if isfinite(result) else None


def cloud_measurements(flow, capacity=None):
    """App API powers are kW; battery positive means charging.

    loadPower is kept as site load: no unverified EV subtraction is applied.
    Missing fields remain unknown. These values are never a control Snapshot.
    """
    if not isinstance(flow, dict):
        return {}
    solar, external = number(flow.get("pvPower")), number(flow.get("thirdPvPower"))
    soc = number(flow.get("batterySoc"))
    capacity = number(capacity)
    return {
        "pv_kw": None if solar is None else solar + (external if external is not None else 0),
        "home_kw": number(flow.get("loadPower")),
        # App flow is negative for import; the integration uses import positive.
        "grid_kw": -number(flow["buySellPower"]) if number(flow.get("buySellPower")) is not None else None,
        "battery_kw": number(flow.get("batteryPower")),
        "soc": soc if soc is not None and 0 <= soc <= 100 else None,
        "capacity_kwh": capacity if capacity is not None and capacity > 0 else None,
        "grid_status": "On Grid" if flow.get("onGrid") is True else "Off Grid" if flow.get("onGrid") is False else None,
        "solar_today": number(flow.get("pvDayNrg")),
    }


def flow_schema(flow):
    """Diagnostic field names/types only, never account identifiers or values."""
    if not isinstance(flow, dict):
        return {}
    return {
        key: type(value).__name__
        for key, value in flow.items()
        if isinstance(key, str) and key.isidentifier() and len(key) <= 60
    }
