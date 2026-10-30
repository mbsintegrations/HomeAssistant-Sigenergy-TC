"""One command authority; live execution requires an explicitly attached executor."""

from __future__ import annotations

import asyncio
from collections import OrderedDict, deque
from datetime import datetime, timedelta
from math import isfinite

from .errors import CapabilityError, SafetyError
from .models import (
    CommandPlan,
    CommandResult,
    Intent,
    Mode,
    Route,
    SafetyLimits,
    Snapshot,
    Source,
    validate_duration_minutes,
)


class Controller:
    def __init__(self, limits: SafetyLimits, *, demo: bool = False, executor=None):
        self.limits = limits
        self.demo = demo
        self.executor = executor
        self._lock = asyncio.Lock()
        self.manual_until: datetime | None = None
        self.automation_paused_until: datetime | None = None
        self.audit = deque(maxlen=25)
        self._receipts: OrderedDict[str, tuple[Intent, CommandResult]] = OrderedDict()
        self.last_result: CommandResult | None = None

    def preview(self, intent: Intent, snapshot: Snapshot, now: datetime) -> CommandPlan:
        snapshot.validate(now, self.limits.telemetry_max_age)
        if not isinstance(intent.mode, Mode) or not isinstance(intent.source, Source):
            raise SafetyError("Unknown command mode or source")
        if type(intent.export_requested) is not bool:
            raise SafetyError("Grid export requires an explicit boolean choice")
        try:
            duration = validate_duration_minutes(intent.duration_minutes)
        except ValueError as err:
            raise SafetyError(str(err)) from None
        if duration > self.limits.max_duration_minutes:
            raise SafetyError("Command duration exceeds the configured bound")
        if intent.source != Source.MANUAL and any(
            deadline is not None and now < deadline for deadline in (self.manual_until, self.automation_paused_until)
        ):
            raise SafetyError("A manual override currently owns control")
        safe_home = self.executor is not None and getattr(self.executor, "safe_home_discharge", False)
        if not self.limits.export_permitted and (
            intent.export_requested or intent.mode == Mode.DISCHARGE and not safe_home
        ):
            raise SafetyError("Export permission is off; forced discharge cannot guarantee zero export")
        if intent.export_requested and intent.mode != Mode.DISCHARGE:
            raise SafetyError("Grid export is only valid for a battery discharge command")
        floor = max(self.limits.reserve_soc, snapshot.backup_soc, snapshot.discharge_cutoff_soc)
        ceiling = min(self.limits.charge_ceiling_soc, snapshot.charge_cutoff_soc)
        for override in (intent.reserve_soc, intent.charge_ceiling_soc):
            if override is not None and (type(override) not in (int, float) or not isfinite(override) or not 0 <= override <= 100):
                raise SafetyError("Strategy SOC bounds must be finite percentages")
        if intent.reserve_soc is not None:
            floor = max(floor, intent.reserve_soc)
        if intent.charge_ceiling_soc is not None:
            ceiling = min(ceiling, intent.charge_ceiling_soc)
        if intent.strategy_id is not None and (
            intent.reserve_soc is not None and snapshot.soc <= intent.reserve_soc
            or intent.charge_ceiling_soc is not None and snapshot.soc >= intent.charge_ceiling_soc
        ):
            raise SafetyError("Fresh battery SOC no longer satisfies the strategy condition")
        if intent.deadline is not None and (not isinstance(intent.deadline, datetime) or intent.deadline.tzinfo is None
                                           or not 0 < (intent.deadline-now).total_seconds() <= 86400):
            raise SafetyError("The strategy's end time is invalid or has passed")
        if intent.solar_export_kw is not None:
            if not self.limits.export_permitted or type(intent.solar_export_kw) not in (int, float) or not isfinite(intent.solar_export_kw) or intent.solar_export_kw <= 0:
                raise SafetyError("Solar export requires approval and an explicit finite power limit")
        if floor >= ceiling:
            raise SafetyError("Effective reserve and charge ceiling conflict")
        if intent.mode in (Mode.CHARGE, Mode.DISCHARGE):
            if type(intent.power_kw) not in (int, float) or not isfinite(intent.power_kw) or intent.power_kw <= 0:
                raise SafetyError("Charge/discharge needs an explicit finite positive power")
            maximum = (
                min(self.limits.max_charge_kw, snapshot.max_charge_kw)
                if intent.mode == Mode.CHARGE
                else min(self.limits.max_discharge_kw, snapshot.max_discharge_kw)
            )
            if intent.power_kw > maximum:
                raise SafetyError("Requested power exceeds the configured or device limit")
            if intent.mode == Mode.CHARGE and snapshot.soc >= ceiling:
                raise SafetyError("Battery has reached the effective charge ceiling")
            if intent.mode == Mode.DISCHARGE and snapshot.soc <= floor:
                raise SafetyError("Battery has reached the effective reserve")
        elif intent.power_kw is not None:
            raise SafetyError("Hold/self-consumption do not accept a power setpoint")
        warnings = ("Preview only: no command has been sent",)
        if self.executor is None and not self.demo:
            warnings += ("Local Modbus has no verified device-side command expiry; live timed control is locked",)
        return CommandPlan(
            intent,
            Route.DEMO if self.demo else self.executor.route if self.executor is not None else Route.MODBUS,
            floor,
            ceiling,
            warnings,
        )

    async def execute(
        self, intent: Intent, snapshot: Snapshot, now: datetime, *, dry_run: bool = True
    ) -> CommandResult:
        async with self._lock:
            previous = self._receipts.get(intent.request_id)
            if previous:
                if previous[0] != intent:
                    raise SafetyError("Request ID was reused with different parameters")
                return previous[1]
            plan = self.preview(intent, snapshot, now)
            if dry_run:
                result = CommandResult(intent.request_id, "preview", plan.route, "; ".join(plan.warnings))
            elif self.demo:
                expiry = now + timedelta(minutes=intent.duration_minutes)
                result = CommandResult(
                    intent.request_id,
                    "simulated",
                    Route.DEMO,
                    "Simulated only; no household device was operated",
                    expiry,
                )
                if intent.source == Source.MANUAL:
                    self.manual_until = expiry
            elif self.executor is not None:
                result = await self.executor.execute(plan, snapshot, now)
                if intent.source == Source.MANUAL and result.status in ("confirmed", "partially_confirmed"):
                    self.manual_until = result.expires_at
                    self.automation_paused_until = None
            else:
                raise CapabilityError("Live writes are locked until transport and crash-recovery acceptance testing")
            self.last_result = result
            self.audit.append(
                {
                    "time": now.isoformat(),
                    "mode": intent.mode.value,
                    "source": intent.source.value,
                    "status": result.status,
                }
            )
            # Previews are deliberately not execution receipts: the same request
            # may later be explicitly executed, but cannot then execute twice.
            if not dry_run:
                self._receipts[intent.request_id] = (intent, result)
                while len(self._receipts) > 100:
                    self._receipts.popitem(last=False)
            return result

    def diagnostics(self) -> dict:
        return {
            "live_writes_locked": self.executor is None,
            "export_permitted": self.limits.export_permitted,
            "manual_until": self.manual_until.isoformat() if self.manual_until else None,
            "automation_paused_until": self.automation_paused_until.isoformat()
            if self.automation_paused_until
            else None,
            "audit": list(self.audit),
        }
