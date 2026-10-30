"""Explicit units, authority and command results; no household defaults."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from math import isfinite
from uuid import uuid4

from .errors import SafetyError

MAX_MANUAL_DURATION_MINUTES = 1440


def validate_duration_minutes(value):
    """Require actual whole minutes; never truncate floats or accept booleans."""
    if type(value) is not int or not 1 <= value <= MAX_MANUAL_DURATION_MINUTES:
        raise ValueError(f"Manual duration must be a whole integer between 1 and {MAX_MANUAL_DURATION_MINUTES} minutes")
    return value


def validate_manual_power(value):
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ValueError("Manual power must be a finite positive number")
    try:
        parsed = float(value)
    except ValueError, TypeError, OverflowError:
        raise ValueError("Manual power must be a finite positive number") from None
    if not isfinite(parsed) or not 0.001 <= parsed <= 100:
        raise ValueError("Manual power must be between 0.001 and 100 kW")
    return parsed


class Mode(StrEnum):
    CHARGE = "charge"
    DISCHARGE = "discharge"
    HOLD = "hold"
    SELF_CONSUMPTION = "self_consumption"


class Source(StrEnum):
    MANUAL = "manual"
    AUTOMATION = "automation"
    PLANNER = "planner"


class Route(StrEnum):
    MODBUS = "modbus"
    CLOUD = "cloud"
    DEMO = "demo"


@dataclass(frozen=True)
class Snapshot:
    observed_at: datetime
    soc: float
    pv_kw: float
    home_kw: float
    grid_kw: float  # positive import, negative export, normalized at the adapter
    battery_kw: float  # positive charging, negative discharging
    capacity_kwh: float
    max_charge_kw: float
    max_discharge_kw: float
    backup_soc: float = 0
    discharge_cutoff_soc: float = 0
    charge_cutoff_soc: float = 100
    on_grid: bool = True
    running: bool = True
    remote_ems: bool = False
    remote_mode: int = 0
    native_mode: int = 0
    total_load_kw: float | None = None
    source: str = "modbus"
    energy: dict[str, float] = field(default_factory=dict)

    def validate(self, now: datetime, max_age: float = 30) -> None:
        if now.tzinfo is None or self.observed_at.tzinfo is None:
            raise SafetyError("Telemetry timestamps must be timezone-aware")
        age = (now - self.observed_at).total_seconds()
        if age < -5 or age > max_age:
            raise SafetyError("Local telemetry is stale or from the future")
        for value in (
            self.soc,
            self.pv_kw,
            self.home_kw,
            self.grid_kw,
            self.battery_kw,
            self.capacity_kwh,
            self.max_charge_kw,
            self.max_discharge_kw,
            self.backup_soc,
            self.discharge_cutoff_soc,
            self.charge_cutoff_soc,
        ):
            if type(value) not in (int, float) or not isfinite(value):
                raise SafetyError("Telemetry contains a non-finite value")
        if not 0 <= self.soc <= 100 or self.capacity_kwh <= 0:
            raise SafetyError("Battery telemetry is outside valid bounds")
        if self.running is not True or self.on_grid is not True:
            raise SafetyError("Control requires a running, grid-connected plant")


@dataclass(frozen=True)
class SafetyLimits:
    reserve_soc: float = 20
    charge_ceiling_soc: float = 90
    max_charge_kw: float = 3
    max_discharge_kw: float = 3
    export_permitted: bool = False
    max_duration_minutes: int = MAX_MANUAL_DURATION_MINUTES
    telemetry_max_age: float = 30

    def __post_init__(self):
        if any(
            type(value) not in (int, float) or not isfinite(value)
            for value in (
                self.reserve_soc,
                self.charge_ceiling_soc,
                self.max_charge_kw,
                self.max_discharge_kw,
                self.telemetry_max_age,
            )
        ):
            raise ValueError("Safety limits must be finite numeric values")
        if not (0 <= self.reserve_soc < self.charge_ceiling_soc <= 100):
            raise ValueError("Reserve must be below the charge ceiling")
        if any(not isfinite(v) or v <= 0 for v in (self.max_charge_kw, self.max_discharge_kw)):
            raise ValueError("Power limits must be finite and positive")
        validate_duration_minutes(self.max_duration_minutes)
        if type(self.export_permitted) is not bool or not 1 <= self.telemetry_max_age <= 300:
            raise ValueError("Export permission and telemetry age must be explicit valid limits")


@dataclass(frozen=True)
class Intent:
    mode: Mode
    source: Source = Source.MANUAL
    duration_minutes: int = 30
    power_kw: float | None = None
    export_requested: bool = False
    request_id: str = field(default_factory=lambda: str(uuid4()))
    reserve_soc: float | None = None
    charge_ceiling_soc: float | None = None
    deadline: datetime | None = None
    strategy_id: str | None = None
    solar_export_kw: float | None = None


@dataclass(frozen=True)
class CommandPlan:
    intent: Intent
    route: Route
    reserve_soc: float
    ceiling_soc: float
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class CommandResult:
    request_id: str
    status: str  # preview, simulated, dispatched_unconfirmed, confirmed
    route: str
    message: str
    expires_at: datetime | None = None


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
