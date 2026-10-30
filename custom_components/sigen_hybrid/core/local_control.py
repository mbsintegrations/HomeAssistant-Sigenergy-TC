"""HA-managed local leases with durable SOC limits and serial-bound recovery.

Modbus V2.9 has no documented device expiry. The HA timer restores settings;
native SOC thresholds remain in force if HA stops. Explicit local ownership is
required. This does not turn on remote EMS during installation or monitoring.
"""

import hashlib
from datetime import datetime, timedelta

from .control_providers import ModbusControlSettings, number
from .control_session import CloudControlSession
from .errors import SafetyError
from .models import CommandResult, Mode, Route, Source, utcnow
from .native_settings import UNLIMITED, matches
from .recovery import canonical

LOCAL_SETTINGS = frozenset({"battery_levels", "battery_power_limits", "pv_power_limit", "grid_export_limit", "grid_import_limit", "backup_reserve"})
SCALARS = {"backup_soc", "charge_cutoff_soc", "discharge_cutoff_soc", "pv_limit_kw", "grid_export_limit_kw", "grid_import_limit_kw"}


class LocalControlSettings(ModbusControlSettings):
    release_on_conflict = ("remote_ems",)
    KEYS = ModbusControlSettings.KEYS | SCALARS | LOCAL_SETTINGS | {"manual"}

    def __init__(self, *args, clock=utcnow, **kwargs):
        super().__init__(*args, **kwargs)
        self.clock = clock

    def validate(self, key, value):
        if key in LOCAL_SETTINGS:
            from .control_providers import CloudControlSettings
            CloudControlSettings.validate(self, key, value)
        elif key in ("backup_soc", "charge_cutoff_soc", "discharge_cutoff_soc"):
            if not 0 <= number(value) <= 100 or abs(value*10-round(value*10)) > 1e-6:
                raise SafetyError("Local SOC limits use 0.1 percent steps")
        elif key in ("pv_limit_kw", "grid_export_limit_kw", "grid_import_limit_kw"):
            if not 0 <= number(value) <= UNLIMITED or abs(value*1000-round(value*1000)) > 1e-6:
                raise SafetyError("Local power limits must use whole watts")
        else:
            super().validate(key, value)

    async def read(self, keys):
        result = {}
        for key in keys:
            if key == "manual":
                result[key] = {"enabled": (await super().read(["remote_ems"]))["remote_ems"]}
            elif key == "battery_levels":
                data = await super().read(["backup_soc", "charge_cutoff_soc", "discharge_cutoff_soc"])
                result[key] = {"backup_soc": data["backup_soc"], "charge_soc": data["charge_cutoff_soc"], "discharge_soc": data["discharge_cutoff_soc"], "peak_shaving_soc": None}
            elif key == "backup_reserve":
                result[key] = {"soc": (await super().read(["backup_soc"]))["backup_soc"]}
            elif key == "battery_power_limits":
                raw = await super().read(["charge_limit_kw", "discharge_limit_kw"])
                result[key] = {field: None if raw[source] == UNLIMITED else raw[source] for field, source in (("charge_kw", "charge_limit_kw"), ("discharge_kw", "discharge_limit_kw"))}
            elif key == "pv_power_limit":
                raw = (await super().read(["pv_limit_kw"]))["pv_limit_kw"]
                result[key] = {"limit_kw": None if raw == UNLIMITED else raw}
            elif key in ("grid_export_limit", "grid_import_limit"):
                raw = (await super().read([key+"_kw"]))[key+"_kw"]
                result[key] = {"enabled": raw != UNLIMITED, "limit_kw": raw}
            else:
                result.update(await super().read([key]))
        return result

    async def setting_changes(self, key, value):
        self.validate(key, value)
        if key == "battery_levels":
            current = (await self.read([key]))[key]
            if value["peak_shaving_soc"] is not None:
                raise SafetyError("Peak-shaving reserve requires its native cloud control")
            levels = [("backup_soc", value["backup_soc"]), ("discharge_cutoff_soc", value["discharge_soc"])]
            ceiling = ("charge_cutoff_soc", value["charge_soc"])
            return [ceiling, *levels] if value["charge_soc"] >= current["charge_soc"] else [*levels, ceiling]
        if key == "backup_reserve":
            return [("backup_soc", value["soc"])]
        if key == "battery_power_limits":
            return [("charge_limit_kw", self.max_charge_kw if value["charge_kw"] is None else value["charge_kw"]),
                    ("discharge_limit_kw", self.max_discharge_kw if value["discharge_kw"] is None else value["discharge_kw"])]
        if key == "pv_power_limit":
            return [("pv_limit_kw", UNLIMITED if value["limit_kw"] is None else value["limit_kw"])]
        if key in ("grid_export_limit", "grid_import_limit"):
            current = (await self.read([key]))[key]
            if not value["enabled"] or value["limit_kw"] > current["limit_kw"]:
                raise SafetyError("Local grid control may tighten the current cap; increasing it requires verified installer metadata from cloud")
            if await self.transport.read("grid_sensor_connected") != 1:
                raise SafetyError("A connected grid sensor is required")
            return [(key+"_kw", value["limit_kw"])]
        raise SafetyError("This setting needs its native cloud control")

    def validate_restore(self, key, value):
        if key.endswith("_kw") and value == UNLIMITED:
            return
        self.validate(key, value)

    def preflight(self, changes, baseline):
        for key, value in changes:
            self.validate(key, value)

    async def validate_context(self, context, baseline):
        expected = context.get("expected_revision")
        if expected is None:
            return
        key = context["key"]
        if key == "battery_levels":
            current = {"backup_soc": baseline["backup_soc"], "charge_soc": baseline["charge_cutoff_soc"],
                       "discharge_soc": baseline["discharge_cutoff_soc"], "peak_shaving_soc": None}
        elif key == "battery_power_limits":
            current = {field: None if baseline[source] == UNLIMITED else baseline[source] for field, source in (("charge_kw", "charge_limit_kw"), ("discharge_kw", "discharge_limit_kw"))}
        elif key == "backup_reserve":
            current = {"soc": baseline["backup_soc"]}
        elif key == "pv_power_limit":
            raw = baseline["pv_limit_kw"]
            current = {"limit_kw": None if raw == UNLIMITED else raw}
        else:
            raw = baseline[key+"_kw"]
            current = {"enabled": raw != UNLIMITED, "limit_kw": raw}
        actual = hashlib.sha256(canonical({"plant": await self.identity(), "value": current}).encode()).hexdigest()
        if actual != expected:
            raise SafetyError("This local setting changed; reopen it before applying")

    async def write_checked(self, key, value, expected, *, context=None, before_send=None):
        self.validate_restore(key, value)
        current = (await self.read([key]))[key]
        if not matches(current, expected):
            raise SafetyError("Another controller changed this local setting")
        if key == "remote_mode" and await self.transport.read("remote_ems") != 0:
            raise SafetyError("Another remote EMS controller is already active")
        deadline = context.get("deadline") if context else None
        if deadline and datetime.fromisoformat(deadline) <= self.clock():
            raise SafetyError("The scheduled control window ended before dispatch")
        if key == "remote_ems" and value is True:
            if (await self.transport.read("grid_sensor_connected") != 1
                or await self.transport.read("grid_state") != 0 or await self.transport.read("running_state") != 1):
                raise SafetyError("Local activation requires fresh running, on-grid readings")
            soc = number(await self.transport.read("soc"))
            mode = (context or {}).get("mode")
            floor = await self.transport.read("discharge_cutoff_soc")
            ceiling = await self.transport.read("charge_cutoff_soc")
            if not 0 <= soc <= 100 or mode == "charge" and soc >= ceiling or mode == "discharge" and soc <= floor:
                raise SafetyError("The battery reached its SOC bound before activation")
            if deadline and datetime.fromisoformat(deadline) <= self.clock():
                raise SafetyError("The scheduled window ended while verifying activation")
        if before_send:
            await before_send(value)
        await self.identity()
        await self.transport.write_confirmed(key, int(value) if key == "remote_ems" else value)

    async def restore_checked(self, key, value, expected):
        # Restore remote EMS first (reverse journal order) before changing mode.
        await self.write_checked(key, value, expected)

    @staticmethod
    def matches(key, requested, observed):
        return matches(requested, observed)

    @staticmethod
    def command_expiry(record):
        step = next((step for step in record["steps"] if step["key"] == "remote_ems" and step["requested"] is True), None)
        if step is None or not step.get("attempted_at"):
            return None
        expiry = datetime.fromisoformat(step["attempted_at"])+timedelta(minutes=record["context"]["duration_minutes"])
        deadline = record["context"].get("deadline")
        return min(expiry, datetime.fromisoformat(deadline)) if deadline else expiry


class LocalControlSession(CloudControlSession):
    route = Route.MODBUS
    safe_home_discharge = True

    @staticmethod
    def result(record):
        expiry = datetime.fromisoformat(record["expires_at"]) if record.get("expires_at") else None
        return CommandResult(record["request_id"], "confirmed" if record["phase"] == "confirmed" else record["phase"],
                             Route.MODBUS, "Local control confirmed", expiry)

    async def execute(self, plan, snapshot, now):
        intent = plan.intent
        context = self.context(intent)
        async with self._lock:
            previous = await self.journal.receipt(intent.request_id)
            if previous:
                saved_context = {key: value for key, value in previous.get("context", {}).items() if key != "local_expires_at"}
                if canonical(saved_context) != canonical(context):
                    raise SafetyError("Request ID was reused with different parameters")
                return self.result(previous)
            pending = await self.journal.pending()
            if pending:
                if intent.source != Source.MANUAL:
                    raise SafetyError("An owner command already controls this plant")
                released = await self.journal.restore()
                if released["phase"] != "restored":
                    raise SafetyError("Release the previous local command before continuing")
            provider = self.journal.provider
            if (await provider.read(["remote_ems"]))["remote_ems"]:
                raise SafetyError("Another remote EMS controller is active; it must release control first")
            if await provider.transport.read("grid_sensor_connected") != 1:
                raise SafetyError("A connected grid sensor is required for local control")
            expiry = self.clock()+timedelta(minutes=intent.duration_minutes)
            if intent.deadline:
                expiry = min(expiry, intent.deadline)
            context["local_expires_at"] = expiry.isoformat()
            changes = [("charge_cutoff_soc", plan.ceiling_soc), ("discharge_cutoff_soc", plan.reserve_soc)]
            charge = min(provider.max_charge_kw, snapshot.max_charge_kw)
            discharge = min(provider.max_discharge_kw, snapshot.max_discharge_kw)
            mode = 2
            if intent.mode == Mode.CHARGE:
                charge, discharge, mode = intent.power_kw, 0, 4
            elif intent.mode == Mode.DISCHARGE:
                charge, discharge, mode = 0, intent.power_kw, 5
                if not intent.export_requested:
                    changes.append(("grid_export_limit_kw", 0))
            elif intent.mode == Mode.HOLD:
                charge = discharge = 0
            if intent.solar_export_kw is not None:
                current = await provider.read(["grid_export_limit_kw"])
                if intent.solar_export_kw > current["grid_export_limit_kw"]:
                    raise SafetyError("Local solar export cannot raise the existing site cap")
                changes.append(("grid_export_limit_kw", intent.solar_export_kw))
            changes.extend([("charge_limit_kw", charge), ("discharge_limit_kw", discharge), ("remote_mode", mode), ("remote_ems", True)])
            record = await self.journal.apply(intent.request_id, changes, expires_at=expiry, context=context)
            return self.result(record)
