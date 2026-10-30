"""A durable manual lease, native SOC protections and owner-preserving release."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta

from .errors import ConfirmationError, SafetyError
from .models import CommandResult, Mode, Route, Source
from .recovery import canonical


class CloudControlSession:
    """Execute through the journal; never retry or resume an uncertain command."""

    route = Route.CLOUD
    safe_home_discharge = True

    def __init__(self, journal, *, clock):
        self.journal, self.clock = journal, clock
        self._lock = asyncio.Lock()

    @staticmethod
    def context(intent):
        return {
            "mode": intent.mode.value,
            "source": intent.source.value,
            "duration_minutes": intent.duration_minutes,
            "power_kw": intent.power_kw,
            "export_requested": intent.export_requested,
            "reserve_soc": intent.reserve_soc,
            "charge_ceiling_soc": intent.charge_ceiling_soc,
            "deadline": intent.deadline.isoformat() if intent.deadline else None,
            "strategy_id": intent.strategy_id,
            "solar_export_kw": intent.solar_export_kw,
        }

    @staticmethod
    def result(record):
        phase = record["phase"]
        if phase not in ("confirmed", "committed", "restored", "superseded"):
            raise ConfirmationError("The previous command needs reconciliation; it was not repeated")
        expiry = datetime.fromisoformat(record["expires_at"]) if record.get("expires_at") else None
        manual = next((step for step in record["steps"] if step["key"] == "manual"), {})
        power = manual.get("requested", {}).get("power_kw")
        power_confirmed = power is None or "power_kw" in manual.get("after", {})
        status = "confirmed" if power_confirmed else "partially_confirmed"
        message = (
            "Mode and expiry confirmed"
            if power_confirmed
            else "Mode and expiry confirmed; the provider does not expose power-limit readback"
        )
        if phase in ("restored", "superseded"):
            status, message = phase, "This command has already ended; it was not repeated"
        return CommandResult(record["request_id"], status, Route.CLOUD, message, expiry)

    async def execute(self, plan, snapshot, now):
        intent = plan.intent
        context = self.context(intent)
        async with self._lock:
            previous = await self.journal.receipt(intent.request_id)
            if previous is not None:
                if canonical(previous.get("context")) != canonical(context):
                    raise SafetyError("Request ID was reused with different parameters")
                return self.result(previous)
            pending = await self.journal.pending()
            if pending is not None:
                if intent.source != Source.MANUAL:
                    raise SafetyError("A manual override currently owns control")
                await self.journal.restore(pending["request_id"])
            provider = self.journal.provider
            baseline = await provider.read(["battery_levels", "battery_export_block", "manual"])
            if baseline["manual"]["enabled"] and intent.source != Source.MANUAL:
                raise SafetyError("The owner's native manual override currently owns control")
            levels = dict(baseline["battery_levels"])
            levels["charge_soc"] = min(levels["charge_soc"], plan.ceiling_soc)
            levels["discharge_soc"] = max(levels["discharge_soc"], plan.reserve_soc)
            if levels["discharge_soc"] >= levels["charge_soc"] or levels["backup_soc"] > levels["charge_soc"]:
                raise SafetyError("Effective battery SOC protections conflict")
            changes = []
            if levels != baseline["battery_levels"]:
                changes.append(("battery_levels", levels))
            # The native switch is a BLOCK, never an export permission. Its
            # installer setting and the separate site export cap remain intact.
            if intent.mode == Mode.DISCHARGE or intent.export_requested or intent.solar_export_kw is not None:
                changes.append(("battery_export_block", not intent.export_requested))
            if intent.solar_export_kw is not None:
                changes.append(("grid_export_limit", {"enabled": True, "limit_kw": intent.solar_export_kw}))
            expiry = self.clock() + timedelta(minutes=intent.duration_minutes)
            changes.append(
                (
                    "manual",
                    {
                        "enabled": True,
                        "mode": {Mode.CHARGE: "0", Mode.DISCHARGE: "1", Mode.HOLD: "2", Mode.SELF_CONSUMPTION: "3"}[
                            intent.mode
                        ],
                        "duration_minutes": intent.duration_minutes,
                        "power_kw": intent.power_kw,
                        "expected_end_time": expiry.timestamp(),
                    },
                )
            )
            record = await self.journal.apply(intent.request_id, changes, expires_at=expiry, context=context)
            return self.result(record)

    async def release(self):
        async with self._lock:
            return await self.journal.restore()

    async def reconcile(self):
        async with self._lock:
            return await self.journal.recover_expired()
