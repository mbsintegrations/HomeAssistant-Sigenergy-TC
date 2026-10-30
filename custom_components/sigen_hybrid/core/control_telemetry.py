"""Minimal owner-cloud safety evidence, without fabricated power-flow readings."""

from dataclasses import dataclass
from datetime import datetime

from .control_providers import percent
from .errors import SafetyError
from .power import app_power_limits, finite_power_kw


@dataclass(frozen=True)
class ControlTelemetry:
    observed_at: datetime
    soc: float
    max_charge_kw: float
    max_discharge_kw: float
    backup_soc: float
    discharge_cutoff_soc: float
    charge_cutoff_soc: float
    on_grid: bool
    running: bool
    source: str = "cloud"

    def validate(self, now, max_age=30):
        if now.tzinfo is None or self.observed_at.tzinfo is None:
            raise SafetyError("Control evidence needs timezone-aware timestamps")
        if not -5 <= (now - self.observed_at).total_seconds() <= max_age:
            raise SafetyError("Cloud control evidence is stale")
        for value in (self.soc, self.backup_soc, self.discharge_cutoff_soc, self.charge_cutoff_soc):
            percent(value)
        if any(finite_power_kw(value) is None for value in (self.max_charge_kw, self.max_discharge_kw)):
            raise SafetyError("Explicit finite power limits are required")
        if self.running is not True or self.on_grid is not True:
            raise SafetyError("Control requires a running, grid-connected plant")


def validate_owner_station(data, station_id, *, require_normal=True):
    if (
        not isinstance(data, dict)
        or type(data.get("stationId")) not in (str, int)
        or str(data["stationId"]) != str(station_id)
    ):
        raise SafetyError("Cloud status belongs to another or unknown plant")
    # Observed in the native owner home response: 1 = Normal. Unknown, offline,
    # stopped and restricted states are not converted into an invented ready flag.
    if (
        data.get("blockClient") is not False
        or require_normal
        and (type(data.get("status")) is not int or data["status"] != 1)
    ):
        raise SafetyError("The selected plant is not reporting normal owner operation")
    return data


async def cloud_control_telemetry(provider, user_limits, *, clock, max_age=30):
    """Use fresh owner GETs and explicit configured/app caps, never app infinity.

    The timestamp is conservative retrieval evidence, not a claim that the
    provider exposes a hardware sample clock or physical command acceptance.
    """
    observed = clock()
    station = validate_owner_station(await provider._request("GET", "device/owner/station/home"), provider.station_id)
    if station.get("hasInstantSetting") is not True:
        raise SafetyError("Native manual control is not advertised for this plant")
    levels = (await provider.read(["battery_levels"]))["battery_levels"]
    caps = app_power_limits(
        await provider._request("GET", f"device/energy-profile/battery/limit/{provider.station_id}")
    )
    live = await provider._request("GET", f"device/energy-profile/instant/manunal/display/{provider.station_id}")
    powers = {}
    for direction in ("charge", "discharge"):
        configured = finite_power_kw(user_limits.get(f"max_{direction}_kw"))
        app = finite_power_kw(caps.get(direction, {}).get("app_default_kw"))
        available = [value for value in (configured, app) if value is not None]
        if not available:
            raise SafetyError("Set an explicit owner power limit; the app's unlimited marker is not a device rating")
        powers[direction] = min(available)
    result = ControlTelemetry(
        observed,
        percent(live.get("batterySoc")),
        powers["charge"],
        powers["discharge"],
        levels["backup_soc"],
        levels["discharge_soc"],
        levels["charge_soc"],
        station.get("onGrid"),
        station["status"] == 1,
    )
    result.validate(clock(), max_age)
    return result
