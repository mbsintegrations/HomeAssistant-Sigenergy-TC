"""Local owner jobs and a single authority across the local/cloud backends."""

import asyncio
import hashlib

from .controls import OwnerControls
from .core.connections import enabled_connections
from .core.errors import CapabilityError, SafetyError
from .core.local_control import LOCAL_SETTINGS, LocalControlSession, LocalControlSettings
from .core.models import Mode, Route, Source
from .core.owner_settings import prepare_setting
from .core.recovery import RecoveryJournal, canonical


def local_write_configured(entry):
    control = entry.options.get("control", {})
    return (control.get("enabled") is True and control.get("local_enabled") is True
            and enabled_connections(entry.data, entry.options)["modbus"]
            and not entry.data.get("shared_read_only")
            and (entry.data.get("sole_modbus_client") is True or entry.data.get("allow_shared_writes") is True)
            and type(entry.data.get("inverter_unit_id")) is int and 1 <= entry.data["inverter_unit_id"] <= 246)


class LocalOwnerControls(OwnerControls):
    route = Route.MODBUS

    def __init__(self, runtime, store, *, clock):
        super().__init__(runtime, store, clock=clock)
        self._local_io_lock = asyncio.Lock()
        self.enabled = local_write_configured(runtime.entry) and runtime.local is not None
        self.manual_supported = True

    @property
    def operation_lock(self):
        return self._local_io_lock

    async def snapshot(self):
        snapshot = self.runtime.data
        if self.runtime.local_error or snapshot is None:
            raise CapabilityError("Fresh local readings are required for local control")
        snapshot.validate(self.clock(), self.runtime.controller.limits.telemetry_max_age)
        return snapshot

    async def _bind(self):
        if not self.enabled or self._closing:
            raise CapabilityError("Local write ownership is not configured")
        if self._session is not None:
            return self._session
        transport, entry = self.runtime.local, self.runtime.entry
        if transport.read_only:
            raise SafetyError("The local monitoring connection is read-only")
        serial = await transport.device_identity(entry.data["inverter_unit_id"])
        endpoint = hashlib.sha256(f"{entry.data['host']}:{entry.data.get('port',502)}".encode()).hexdigest()
        identity = f"modbus:{endpoint}:{serial}"

        async def identity_reader():
            if await transport.device_identity(entry.data["inverter_unit_id"]) != serial:
                raise SafetyError("The physical inverter changed; local control is blocked")
            return identity

        claims = self.runtime.hass.data.setdefault("sigen_hybrid", {}).setdefault("control_plants", {})
        claim_identity = "modbus-device:"+hashlib.sha256(serial.encode()).hexdigest()
        if claims.get(claim_identity, entry.entry_id) != entry.entry_id:
            raise SafetyError("Another TC configuration owns local control of this plant")
        claims[claim_identity] = entry.entry_id
        self._claim = (claims, claim_identity)
        snapshot = self.runtime.data
        if snapshot is None:
            raise SafetyError("Read the inverter's actual battery power ratings before local control")
        provider = LocalControlSettings(transport, identity_reader, max_charge_kw=snapshot.max_charge_kw,
                                        max_discharge_kw=snapshot.max_discharge_kw, clock=self.clock)
        self._session = LocalControlSession(RecoveryJournal(self.store, provider, plant_identity=identity, clock=self.clock), clock=self.clock)
        return self._session

    async def _prepare_setting(self, request):
        key = request["key"]
        if key not in LOCAL_SETTINGS:
            raise CapabilityError("This setting requires the native cloud connection")
        session = await self._bind()
        provider = session.journal.provider
        value = await prepare_setting(provider, key, request["value"], owner_limits=self.runtime.controller.limits, station={})
        snapshot = self.runtime.data
        if snapshot is not None and (self.clock()-snapshot.observed_at).total_seconds() > self.runtime.controller.limits.telemetry_max_age:
            await self.runtime.async_request_refresh()
        await self.snapshot()
        current = (await provider.read([key]))[key]
        if request.get("expected_revision") is not None:
            if setting_revision(await provider.identity(), current) != request["expected_revision"]:
                raise SafetyError("This local setting changed; reopen it before applying")
        # Check the scalar translation before the job's journal is created.
        await provider.setting_changes(key, value)
        return session, value


def setting_revision(identity, value):
    return hashlib.sha256(canonical({"plant": identity, "value": value}).encode()).hexdigest()


class HybridOwnerControls:
    """One command job at a time; never silently fail over a running command."""

    safe_home_discharge = True

    def __init__(self, cloud, local, binding_store=None):
        self.cloud, self.local = cloud, local
        self.binding_store = binding_store
        self._active = local if local.enabled else cloud
        self._lock = asyncio.Lock()

    @property
    def enabled(self):
        return self.cloud.enabled or self.local.enabled

    @property
    def manual_supported(self):
        return True if self.local.enabled else self.cloud.manual_supported

    @property
    def route(self):
        return self._active.route

    @property
    def operation(self):
        return self._active.operation

    @property
    def _job(self):
        return next((actor._job for actor in (self.cloud, self.local) if actor._job and not actor._job.done()), self._active._job)

    async def _ensure_source_binding(self):
        if self.binding_store is None or not self.cloud.enabled:
            return
        runtime = self.cloud.runtime
        if runtime.local is None or type(runtime.entry.data.get("inverter_unit_id")) is not int:
            return
        runtime.source_binding_verified = False
        entry, transport = runtime.entry, runtime.local
        options = entry.options["cloud"]
        configuration = hashlib.sha256(canonical({"host": entry.data["host"], "port": entry.data.get("port", 502),
            "unit": entry.data["inverter_unit_id"], "station": str(options["station_id"]),
            "region": options.get("region", "eu"), "account": options.get("username", "").strip().lower()}).encode()).hexdigest()
        serial = await transport.device_identity(entry.data["inverter_unit_id"])
        saved = await self.binding_store.async_load()
        if saved and saved.get("version") == 1 and saved.get("configuration") == configuration and saved.get("inverter_serial") == serial:
            runtime.source_binding_verified = True
            return
        cloud = runtime.cloud
        if cloud is None or not cloud._connected or str(cloud.client.station_id) != str(options["station_id"]):
            raise SafetyError("Connect cloud once to verify that both controls target the same plant")
        async with runtime._cloud_update_lock:
            serials = await cloud.client.aio_serials()
        if str(cloud.client.station_id) != str(options["station_id"]) or not isinstance(serials, list) or serial not in serials:
            raise SafetyError("The local inverter does not match the cloud plant; check Connections before control")
        await self.binding_store.async_save({"version": 1, "configuration": configuration, "inverter_serial": serial})
        runtime.source_binding_verified = True

    async def _select(self, actor, *, source=None, dry_run=False, request_id=None):
        if self._job is not None and not self._job.done():
            raise SafetyError("A plant command is already being processed")
        if not actor.enabled:
            raise CapabilityError("The selected control connection is not configured")
        other = self.cloud if actor is self.local else self.local
        saved = await other.automation_record()
        receipts = [*(saved.get("history") or []), *([saved["active"]] if saved.get("active") else [])]
        if request_id is not None and any(row.get("request_id") == request_id for row in receipts):
            self._active = other
            raise SafetyError("This request ID was already processed on the other connection; inspect its result rather than resend")
        await self._ensure_source_binding()
        if saved.get("active"):
            if dry_run or source != Source.MANUAL:
                raise SafetyError("Release the previous command before changing its control connection")
            # A fresh owner request can hand over, but only after confirmed
            # release. Network failure never causes a blind actuator failover.
            await other.cancel()
            if other._job is not None:
                await other._job
            if other.operation.get("phase") not in ("idle", "restored", "superseded"):
                raise SafetyError("The previous command could not be safely released")
        self._active = actor
        return actor

    def _manual_actor(self, intent):
        cloud_online = self.cloud.enabled and self.cloud.runtime.connections.get("cloud", {}).get("status") == "connected"
        # The native battery-export block allows PV export independently. The
        # local home-only alternative caps the entire grid point at zero.
        if intent.mode == Mode.DISCHARGE and cloud_online:
            return self.cloud
        return self.local if self.local.enabled else self.cloud

    async def submit(self, intent):
        async with self._lock:
            for pending in (self.cloud, self.local):
                if pending._job is not None and not pending._job.done() and getattr(pending, "_intent", None) == intent:
                    return await pending.submit(intent)
            actor = await self._select(self._manual_actor(intent), source=intent.source, request_id=intent.request_id)
            return await actor.submit(intent)

    async def preview(self, intent):
        if self._job is not None and not self._job.done():
            raise SafetyError("A plant command is already being processed")
        actor = self._manual_actor(intent)
        await self._ensure_source_binding()
        self._active = actor
        return await actor.preview(intent)

    async def execute(self, plan, snapshot, now):
        actor = self.local if plan.route == Route.MODBUS else self.cloud
        return await actor.execute(plan, snapshot, now)

    async def setting(self, key, value, **kwargs):
        async with self._lock:
            local_setting = key in LOCAL_SETTINGS and not (self.cloud.enabled and key in ("grid_export_limit", "grid_import_limit"))
            actor = self.local if self.local.enabled and local_setting else self.cloud
            if actor._job is not None and not actor._job.done():
                return await actor.setting(key, value, **kwargs)
            actor = await self._select(actor, source=kwargs.get("source"), dry_run=kwargs.get("dry_run", True), request_id=kwargs.get("request_id"))
            return await actor.setting(key, value, **kwargs)

    async def cancel(self):
        async with self._lock:
            actors = []
            for actor in (self.cloud, self.local):
                if actor.enabled and (await actor.automation_record()).get("active"):
                    actors.append(actor)
            if len(actors) > 1:
                raise SafetyError("Multiple pending control records need individual reconciliation")
            actor = actors[0] if actors else self._active
            self._active = actor
            return await actor.cancel()

    async def automation_record(self):
        records = [await actor.automation_record() for actor in (self.cloud, self.local)]
        active = [record["active"] for record in records if record.get("active")]
        if len(active) > 1:
            raise SafetyError("Multiple pending control records need reconciliation")
        pause = next((record.get("automation_pause") for record in records if record.get("automation_pause", {}).get("paused") is True), {})
        return {"active": active[0] if active else None, "automation_pause": pause}

    async def resume_automation(self, **kwargs):
        for actor in (self.cloud, self.local):
            if actor.enabled and (await actor.automation_record()).get("automation_pause", {}).get("paused"):
                await actor.resume_automation(**kwargs)

    async def release_automation(self, request_id):
        for actor in (self.cloud, self.local):
            if ((await actor.automation_record()).get("active") or {}).get("request_id") == request_id:
                self._active = actor
                return await actor.release_automation(request_id)
        return {"phase": "not_owned"}

    async def reconcile(self, now=None):
        if self._job is not None and not self._job.done():
            return
        for actor in (self.cloud, self.local):
            saved = await actor.automation_record()
            if saved.get("active"):
                self._active = actor
                await actor.reconcile(now)

    async def close(self):
        await self.cloud.close()
        await self.local.close()

    def diagnostics(self):
        return {**self._active.diagnostics(), "live_writes_locked": not self.enabled,
                "local_control_enabled": self.local.enabled, "cloud_control_enabled": self.cloud.enabled,
                "command_timer": "home_assistant" if self.route == Route.MODBUS else "device"}
