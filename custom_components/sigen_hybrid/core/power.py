"""Allowlisted manual-power metadata; app settings are not device ratings."""

from datetime import datetime
from decimal import Decimal, InvalidOperation

from .models import Snapshot

APP_UNLIMITED_KW = Decimal("4294967.295")
_APP_FIELDS = {
    "charge": "batteryMaxChargingPower",
    "discharge": "batteryMaxDischargingPower",
}
_LIMIT_FIELDS = {"charge": "max_charge_kw", "discharge": "max_discharge_kw"}


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        return None
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation, ValueError:
        return None
    return number if number.is_finite() else None


def finite_power_kw(value):
    """Return a finite positive cap in kW; never turn the app sentinel into one."""
    number = _number(value)
    return float(number) if number is not None and 0 < number < APP_UNLIMITED_KW else None


def app_power_limits(payload):
    """Parse only the two confirmed app cap fields, including numeric strings."""
    if not isinstance(payload, dict):
        return {}
    limits = {}
    for direction, field in _APP_FIELDS.items():
        number = _number(payload.get(field))
        if number == APP_UNLIMITED_KW:
            limits[direction] = {"app_unlimited": True}
        elif (power := finite_power_kw(payload.get(field))) is not None:
            limits[direction] = {"app_default_kw": power}
    return limits


def _fresh(observed_at, now, maximum_age):
    try:
        observed = (
            observed_at
            if isinstance(observed_at, datetime)
            else datetime.fromisoformat(str(observed_at).replace("Z", "+00:00"))
        )
        return -5 <= (now - observed).total_seconds() <= maximum_age
    except TypeError, ValueError:
        return False


def manual_power_metadata(*, cloud_data, cloud_error, snapshot, user_safety, demo, now, local_max_age=30):
    """Merge independent valid sources, without inventing owner or device caps."""
    result = {}
    if not cloud_error and _fresh(
        cloud_data.get("manual_control_power_observed_at", cloud_data.get("updated_at")), now, 1800
    ):
        app = cloud_data.get("manual_control_power", {})
        for direction in _LIMIT_FIELDS:
            item = app.get(direction) if isinstance(app, dict) else None
            if not isinstance(item, dict):
                continue
            power = finite_power_kw(item.get("app_default_kw"))
            if power is not None and "app_unlimited" not in item:
                result[direction] = {"app_default_kw": power}
            elif item.get("app_unlimited") is True and "app_default_kw" not in item:
                result[direction] = {"app_unlimited": True}
    local_ready = False
    if not demo and isinstance(snapshot, Snapshot) and snapshot.source == "modbus":
        try:
            snapshot.validate(now, local_max_age)
            local_ready = True
        except Exception:
            pass
    for direction, field in _LIMIT_FIELDS.items():
        if local_ready and (power := finite_power_kw(getattr(snapshot, field))) is not None:
            result.setdefault(direction, {})["device_max_kw"] = power
        if isinstance(user_safety, dict) and field in user_safety:
            if (power := finite_power_kw(user_safety[field])) is not None:
                result.setdefault(direction, {})["user_max_kw"] = power
    return result
