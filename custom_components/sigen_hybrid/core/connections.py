"""Independent transport health and read selection. Never routes a write."""

from dataclasses import dataclass
from datetime import datetime
from math import isfinite

TRANSPORTS = ("modbus", "cloud")
MAX_AGE = {"modbus": 120, "cloud": 1800}
CONTROL_FEATURES = {
    "manual_control": ("modbus",),
    "native_mode": (),
    "grid_switch": (),
    "charger_control": (),
    "device_configuration": (),
}


def enabled_connections(data, options):
    """Keep old entries working; explicit switches preserve saved credentials."""
    defaults = {
        "modbus": bool(data.get("host")) and not data.get("cloud_only", False),
        "cloud": bool(options.get("cloud")),
    }
    switches = options.get("connections", {})
    return {key: not data.get("demo", False) and switches.get(key, defaults[key]) is True for key in TRANSPORTS}


def age_seconds(timestamp, now):
    try:
        clock = timestamp if isinstance(timestamp, datetime) else datetime.fromisoformat(timestamp)
        if clock.tzinfo is None or now.tzinfo is None:
            return None
        age = (now - clock).total_seconds()
        return age if age >= -5 else None
    except ValueError, TypeError:
        return None


@dataclass(frozen=True)
class Reading:
    value: object
    source: str
    observed_at: str


def select_reading(key, sources, statuses, now):
    """Per-field local/Cloud priority, with the actual observation clock."""
    for route in TRANSPORTS:
        status, source = statuses.get(route, {}), sources.get(route, {})
        if not status.get("enabled") or status.get("status") != "connected":
            continue
        age = age_seconds(source.get("observed_at"), now)
        if age is None or age > MAX_AGE[route]:
            continue
        value = source.get("values", {}).get(key)
        if value is None or isinstance(value, float) and not isfinite(value):
            continue
        return Reading(value, route, source["observed_at"])
    return None


def connection_states(enabled, configured, sources, errors, now):
    result = {}
    for route in TRANSPORTS:
        stamp = sources.get(route, {}).get("observed_at")
        age = age_seconds(stamp, now)
        state = "disabled"
        if enabled.get(route):
            if not configured.get(route):
                state = "setup_required"
            elif errors.get(route):
                state = "authentication_required" if errors[route] == "authentication_required" else "disconnected"
            elif age is None:
                state = "connecting"
            else:
                state = "connected" if age <= MAX_AGE[route] else "disconnected"
        result[route] = {
            "enabled": bool(enabled.get(route)),
            "configured": bool(configured.get(route)),
            "status": state,
            "last_success": stamp,
            "age_seconds": round(age) if age is not None else None,
        }
    return result


def capabilities(connections, *, writes_locked=True):
    """Advertise only implemented controls; credentials never imply permission."""
    result = {}
    for feature, providers in CONTROL_FEATURES.items():
        configured = [p for p in providers if connections.get(p, {}).get("enabled")]
        connected = [p for p in configured if connections[p]["status"] == "connected"]
        result[feature] = {
            "supported": bool(configured),
            "online": bool(connected),
            "available": bool(connected) and not writes_locked,
            "routes": configured,
            "reason": "temporarily_unavailable" if configured else "unsupported",
        }
    return result
