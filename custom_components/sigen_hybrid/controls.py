"""Owner-authorized command jobs and a durable cloud control session.

No browser token, second login, arbitrary endpoint or automatic command replay.
The coordinator and its monitoring transports continue independently of jobs.
"""

from __future__ import annotations

import asyncio
import copy
from dataclasses import asdict
from datetime import datetime
from uuid import uuid4

from .core.control_providers import CloudControlSettings
from .core.control_session import CloudControlSession
from .core.control_telemetry import cloud_control_telemetry, validate_owner_station
from .core.errors import CapabilityError, SafetyError, SigenError
from .core.models import Route, utcnow
from .core.owner_settings import prepare_setting, setting_preview
from .core.recovery import RecoveryJournal


class OwnerControls:
    route = Route.CLOUD
    safe_home_discharge = True

    def __init__(self, runtime, store, *, clock=utcnow):
        self.runtime, self.store, self.clock = runtime, store, clock
        cloud = runtime.entry.options.get("cloud", {})
        self.station_id, self.region = str(cloud.get("station_id", "")), cloud.get("region")
        self.enabled = (
            runtime.entry.options.get("control", {}).get("enabled") is True
            and not runtime.entry.data.get("demo", False)
            and runtime.entry.options.get("connections", {}).get("cloud", bool(cloud)) is True
            and bool(cloud)
        )
        self._session = None
        self._lock = asyncio.Lock()
        self._job = None
        self._intent = None
        self._setting_request = None
        self.operation = {"phase": "idle"}
        self._claim = None
        self._closing = False
        self._recovery_tasks = set()
        self.manual_supported = None

    async def cancel(self):
        if not self.enabled or self._closing:
            raise CapabilityError("Plant control is not enabled")
        if self._job is not None and not self._job.done():
            self._job.cancel()
            await asyncio.gather(self._job, return_exceptions=True)
        self.operation = {
            "request_id": str(uuid4()),
            "phase": "cancelling",
            "message": "Releasing this integration's manual control",
        }
        self._job = self.runtime.entry.async_create_background_task(
            self.runtime.hass, self._release(), "sigenergy_tc_release_control"
        )
        self._notify()
        return dict(self.operation)

    async def _release(self):
        try:
            async with self.runtime._cloud_update_lock, self._lock:
                saved = await self.store.async_load() if self._session is None else None
                if self._session is None and (not saved or not saved.get("active")):
                    self.operation = {
                        **self.operation,
                        "phase": "idle",
                        "message": "No command from this integration is active",
                    }
                    return
                session = await self._bind()
                result = await session.release()
                self._update_setting_cache(result)
                self.operation = {
                    **self.operation,
                    "phase": result["phase"],
                    "message": "Control released"
                    if result["phase"] in ("idle", "restored")
                    else "Owner changes were preserved; review the previous command",
                }
                if result["phase"] in ("idle", "restored"):
                    self.runtime.controller.manual_until = None
                elif result["phase"] == "superseded":
                    self._owner_handoff(result)
                    if "manual" in result.get("released_on_conflict", []):
                        self.operation["message"] = "Manual control stopped; owner-changed settings were preserved"
        except SigenError as error:
            self.operation = {**self.operation, "phase": "recovery_pending", "message": str(error)}
        except Exception:
            self.operation = {
                **self.operation,
                "phase": "recovery_pending",
                "message": "Control release needs reconciliation",
            }
        finally:
            self._notify()

    def diagnostics(self):
        return {
            "control_api_version": 1,
            "live_writes_locked": not self.enabled,
            "operation": dict(self.operation),
        }

    def _notify(self):
        if not self._closing:
            self.runtime.async_update_listeners()

    async def _bind(self):
        if not self.enabled or self._closing:
            raise CapabilityError("Plant control has not been enabled by the owner")
        entries = getattr(self.runtime.hass, "config_entries", None)
        own = self.runtime.entry.options.get("cloud", {})
        if entries is not None:
            for entry in entries.async_entries("sigen_hybrid"):
                other = entry.options.get("cloud", {})
                if (entry.entry_id != self.runtime.entry.entry_id and not getattr(entry, "disabled_by", None)
                    and entry.options.get("control", {}).get("enabled") is True
                    and entry.options.get("connections", {}).get("cloud", bool(other))
                    and str(other.get("station_id")) == str(own.get("station_id"))
                    and other.get("region", "eu") == own.get("region", "eu")):
                    raise SafetyError("Another TC entry has control enabled for this plant")
        if self._session is not None:
            return self._session
        cloud = self.runtime.cloud
        if cloud is None or not getattr(cloud, "_connected", False):
            raise CapabilityError("The cloud connection is not ready for owner control")
        if str(cloud.station_id) != self.station_id or str(cloud.client.station_id) != self.station_id:
            raise SafetyError("The active cloud plant does not match the selected plant")
        if self.region not in ("eu", "us", "apac", "cn"):
            raise SafetyError("A selected cloud region is required")
        identity = f"cloud:{self.region}:{self.station_id}"
        claims = self.runtime.hass.data.setdefault("sigen_hybrid", {}).setdefault("control_plants", {})
        if claims.get(identity, self.runtime.entry.entry_id) != self.runtime.entry.entry_id:
            raise SafetyError("Another Sigenergy TC entry already owns control of this plant")
        claims[identity] = self.runtime.entry.entry_id
        self._claim = (claims, identity)
        provider = CloudControlSettings(cloud.client, self.station_id, region=self.region, clock=self.clock)
        station = validate_owner_station(
            await provider._request("GET", "device/owner/station/home"), self.station_id, require_normal=False
        )
        self.manual_supported = station.get("hasInstantSetting") is True
        provider.gateway = station.get("hasGateway") is True
        for key, field in (("ac_charging", "acSnList"), ("dc_charging", "dcSnList")):
            serials = station.get(field)
            present = station.get("hasAcCharger" if key == "ac_charging" else "hasEv") is True
            if present and isinstance(serials, list) and len(serials) == 1:
                serial = serials[0]
                # Reuse the constructor's exact discovered-serial validation.
                bound = CloudControlSettings(
                    cloud.client, self.station_id, **{"ac_serial" if key == "ac_charging" else "dc_serial": serial}
                )
                provider.devices[key] = bound.devices[key]
        journal = RecoveryJournal(self.store, provider, plant_identity=identity, clock=self.clock)
        self._session = CloudControlSession(journal, clock=self.clock)
        pending = await journal.pending()
        if pending and pending.get("expires_at") and pending.get("context", {}).get("source") == "manual":
            self.runtime.controller.manual_until = datetime.fromisoformat(pending["expires_at"])
        elif not pending:
            history = (await journal.export())["history"]
            if history and history[-1]["phase"] == "superseded":
                self._owner_handoff(history[-1])
        return self._session

    def _owner_handoff(self, record):
        deadline = record.get("expires_at")
        if deadline:
            self.runtime.controller.automation_paused_until = datetime.fromisoformat(deadline)
        self.runtime.controller.manual_until = None

    async def snapshot(self):
        session = await self._bind()
        if self.manual_supported is not True:
            raise CapabilityError("Native manual control is not advertised for this plant")
        local = self.runtime.data
        if local is not None and not self.runtime.local_error and getattr(local, "source", None) == "modbus":
            try:
                local.validate(self.clock(), self.runtime.controller.limits.telemetry_max_age)
                return local
            except SigenError:
                pass
        return await cloud_control_telemetry(
            session.journal.provider,
            self.runtime.entry.options.get("safety", {}),
            clock=self.clock,
            max_age=self.runtime.controller.limits.telemetry_max_age,
        )

    async def execute(self, plan, snapshot, now):
        # Controller calls this only inside its own serial command authority.
        async with self._lock:
            session = await self._bind()
            return await session.execute(plan, snapshot, now)

    async def preview(self, intent):
        async with self.runtime._cloud_update_lock:
            snapshot = await self.snapshot()
            return asdict(await self.runtime.controller.execute(intent, snapshot, self.clock(), dry_run=True))

    async def submit(self, intent):
        if not self.enabled or self._closing:
            raise CapabilityError("Plant control is not enabled")
        if self._job is not None and not self._job.done():
            if self._intent == intent:
                return dict(self.operation)
            raise SafetyError("A plant command is already being processed")
        if self._intent is not None and self._intent.request_id == intent.request_id:
            if self._intent != intent:
                raise SafetyError("Request ID was reused with different parameters")
            return dict(self.operation)
        self._intent = intent
        self._setting_request = None
        self.operation = {"request_id": intent.request_id, "phase": "queued", "message": "Checking plant state"}
        self._job = self.runtime.entry.async_create_background_task(
            self.runtime.hass, self._run(intent), "sigenergy_tc_owner_command"
        )
        self._notify()
        return dict(self.operation)

    async def setting(self, key, value, *, request_id, source, dry_run=True, serial=None):
        """Preview or queue one closed owner setting; no arbitrary payload dispatch."""
        from .core.recovery import canonical

        if not self.enabled or self._closing:
            raise CapabilityError("Plant control is not enabled")
        request = {"key": key, "value": copy.deepcopy(value), "request_id": request_id, "source": source.value, "serial": serial,
                   "pause_automation": source.value == "manual" and key not in ("ac_charging", "dc_charging")}
        canonical(request)
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128:
            raise SafetyError("A valid command request ID is required")
        if self._job is not None and not self._job.done():
            if self._setting_request == request and not dry_run:
                return dict(self.operation)
            raise SafetyError("A plant command is already being processed")
        if dry_run:
            async with self.runtime._cloud_update_lock, self._lock:
                session, resolved = await self._prepare_setting(request)
                return await setting_preview(session.journal.provider, key, resolved)
        self._intent = None
        self._setting_request = request
        self.operation = {"request_id": request_id, "setting": key, "phase": "queued", "message": "Checking plant state"}
        self._job = self.runtime.entry.async_create_background_task(
            self.runtime.hass, self._run_setting(request), "sigenergy_tc_owner_setting"
        )
        self._notify()
        return dict(self.operation)

    async def _prepare_setting(self, request):
        session = await self._bind()
        provider = session.journal.provider
        station = validate_owner_station(
            await provider._request("GET", "device/owner/station/home"),
            self.station_id,
            require_normal=not (
                request["key"] == "grid_connection" and request["value"] is True
                or request["key"] in ("ac_charging", "dc_charging") and request["value"] is False
            ),
        )
        value = await prepare_setting(
            provider, request["key"], request["value"], owner_limits=self.runtime.controller.limits,
            station=station, serial=request["serial"],
        )
        return session, value

    async def _run_setting(self, request):
        from .core.models import Source
        from .core.recovery import canonical

        try:
            async with self.runtime._cloud_update_lock, self._lock:
                session = await self._bind()
                previous = await session.journal.receipt(request["request_id"])
                if previous is not None:
                    if canonical(previous.get("context")) != canonical(request):
                        raise SafetyError("Request ID was reused with different parameters")
                    if previous["phase"] not in ("committed", "restored", "superseded"):
                        raise SafetyError("Reconcile the previous setting before retrying")
                    self.operation = {
                        "request_id": request["request_id"], "setting": request["key"],
                        "phase": "confirmed" if previous["phase"] == "committed" else previous["phase"],
                        "message": "This request was already processed; it was not repeated",
                    }
                    return
                await session.reconcile()
                if await session.journal.pending():
                    raise SafetyError("Stop the active manual command before changing plant settings")
                if request["source"] != Source.MANUAL.value:
                    if (await session.journal.automation_pause()).get("paused") is True:
                        raise SafetyError("Scheduling is paused after an owner change")
                    until = self.runtime.controller.automation_paused_until
                    if until is not None and until > self.clock():
                        raise SafetyError("Owner control currently has priority over automation")
                session, resolved = await self._prepare_setting(request)
                if (await session.journal.provider.read(["manual"]))["manual"]["enabled"]:
                    raise SafetyError("Stop the native manual command before changing plant settings")
                record = await session.journal.apply(
                    request["request_id"], [(request["key"], resolved)], context=request,
                )
                self.operation = {
                    "request_id": request["request_id"], "setting": request["key"],
                    "phase": "confirmed", "message": "Setting confirmed by fresh provider readback",
                }
                if record["phase"] != "committed":
                    raise SafetyError("The setting was not committed")
                self._update_setting_cache(record)
        except asyncio.CancelledError:
            self.operation = {"request_id": request["request_id"], "phase": "interrupted"}
            raise
        except SigenError as error:
            await self._failed(request["request_id"], str(error))
        except Exception:
            await self._failed(request["request_id"], "Setting failed; inspect recovery before retrying")
        finally:
            self._notify()

    def _update_setting_cache(self, record):
        if self._session is None or record.get("phase") not in ("committed", "restored"):
            return
        for step in record.get("steps", []):
            if step["key"] != "native_mode":
                continue
            value = step["before"] if record["phase"] == "restored" else step["after"]
            choices = getattr(self._session.journal.provider, "mode_options", [])
            selected = next((item for item in choices if (item["mode"], item["profile_id"]) ==
                             (value["mode"], value["profile_id"])), None)
            if selected is not None:
                self.runtime.cloud_data["mode"] = selected["label"]

    async def _run(self, intent):
        try:
            # Background cloud polling must not interleave with a command's
            # recovery snapshot. Independent Modbus monitoring stays active.
            async with self.runtime._cloud_update_lock:
                session = await self._bind()
                await session.reconcile()  # Explicit execution may first release interrupted work.
                from .core.models import Source
                if intent.source != Source.MANUAL and (await session.journal.automation_pause()).get("paused") is True:
                    raise SafetyError("Scheduling is paused after an owner change")
                if self.runtime.data is not None and self.runtime.local_error is None and hasattr(self.runtime, "async_request_refresh"):
                    if (self.clock()-self.runtime.data.observed_at).total_seconds() > self.runtime.controller.limits.telemetry_max_age:
                        await self.runtime.async_request_refresh()
                snapshot = await self.snapshot()
                if intent.source != Source.MANUAL and intent.mode.value in ("charge", "discharge"):
                    from dataclasses import replace
                    if type(intent.power_kw) not in (int, float):
                        raise SafetyError("Automatic charge/discharge requires an explicit power limit")
                    maximum = snapshot.max_charge_kw if intent.mode.value == "charge" else snapshot.max_discharge_kw
                    intent = replace(intent, power_kw=min(intent.power_kw, maximum))
                result = await self.runtime.controller.execute(intent, snapshot, self.clock(), dry_run=False)
                self.operation = {**asdict(result), "phase": result.status}
        except asyncio.CancelledError:
            self.operation = {
                "request_id": intent.request_id,
                "phase": "interrupted",
                "message": "Reconcile the previous command before retrying",
            }
            raise
        except SigenError as error:
            await self._failed(intent.request_id, str(error))
        except Exception:
            await self._failed(intent.request_id, "Control failed; inspect recovery before retrying")
        finally:
            self._notify()

    async def automation_record(self):
        saved = await self.store.async_load() if self._session is None else await self._session.journal.export()
        return saved or {}

    async def resume_automation(self, *, requested_at=None):
        async with self.runtime._cloud_update_lock, self._lock:
            session = await self._bind()
            pause = await session.journal.automation_pause(clear=True, if_not_after=requested_at)
            if pause.get("paused") is not True:
                self.runtime.controller.automation_paused_until = None

    async def release_automation(self, request_id):
        """Never cancel or restore a manual command that replaced this rule."""
        from .core.models import Source
        job = self._job
        if job is not None and not job.done() and self._intent is not None and self._intent.source == Source.AUTOMATION and self._intent.request_id == request_id:
            job.cancel()
            await asyncio.gather(job, return_exceptions=True)
        async with self.runtime._cloud_update_lock, self._lock:
            session = await self._bind()
            pending = await session.journal.pending()
            if not pending or pending["request_id"] != request_id or pending.get("context", {}).get("source") != Source.AUTOMATION.value:
                return {"phase": "not_owned"}
            result = await session.release()
            self._update_setting_cache(result)
            self.operation = {"request_id": request_id, "phase": result["phase"], "message": "Scheduled control ended"}
            self._notify()
            return result

    async def _failed(self, request_id, message):
        try:
            pending = await self._session.journal.pending() if self._session is not None else None
            uncertain = pending is not None and pending["phase"] != "confirmed"
        except Exception:
            uncertain = True
        self.operation = {"request_id": request_id, "phase": "uncertain" if uncertain else "failed", "message": message}

    async def reconcile(self, _now=None):
        if self._closing:
            return
        task = asyncio.current_task()
        self._recovery_tasks.add(task)
        try:
            await self._reconcile()
        finally:
            self._recovery_tasks.discard(task)

    async def _reconcile(self):
        if not self.enabled or self._closing or self._job is not None and not self._job.done():
            return
        # No cloud traffic at all for idle journals, including after a restart.
        saved = await self.store.async_load() if self._session is None else None
        if self._session is None and (not saved or not saved.get("active")):
            return
        async with self.runtime._cloud_update_lock, self._lock:
            try:
                session = await self._bind()
                result = await session.reconcile()
                self._update_setting_cache(result)
                if result["phase"] in ("idle", "restored"):
                    self.runtime.controller.manual_until = None
                if result["phase"] in ("restored", "superseded"):
                    if result["phase"] == "superseded":
                        self._owner_handoff(result)
                    self.operation = {
                        "request_id": result["request_id"],
                        "phase": result["phase"],
                        "message": "Manual control ended; native settings restored"
                        if result["phase"] == "restored"
                        else "Owner changes were preserved; review the previous command",
                    }
                self._notify()
            except SigenError:
                self.operation = {
                    **self.operation,
                    "phase": "recovery_pending",
                    "message": "Waiting to reconcile the previous command",
                }
                self._notify()

    async def close(self):
        self._closing = True
        tasks = [task for task in self._recovery_tasks if task is not asyncio.current_task()]
        if self._job is not None and not self._job.done():
            tasks.append(self._job)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        # Do not start network recovery on shutdown: interruption is durable and
        # native expiry/SOC limits remain. Startup reconciles without replay.
        if self._claim is not None:
            claims, identity = self._claim
            if claims.get(identity) == self.runtime.entry.entry_id:
                claims.pop(identity)
