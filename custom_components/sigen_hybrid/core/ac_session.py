"""Explicit charger starts and durable, compare-before-restore Fast sessions."""

import asyncio
from copy import deepcopy
from datetime import datetime, timedelta
from uuid import uuid4

from .errors import SafetyError
from .recovery import RecoveryJournal, canonical


class ChargerSession:
    """One exact charger; native acknowledgments never imply energy delivery.

    Only an explicit start/stop sends a charger command. Restart/reconciliation
    reads state and restores an owned mode lease; it never replays a start.
    """

    def __init__(self, state_store, mode_store, provider, *, clock, operation_lock, notify=lambda: None, kind="ac"):
        self.state_store, self.mode_store, self.provider = state_store, mode_store, provider
        self.clock, self.operation_lock, self.notify = clock, operation_lock, notify
        self.kind = kind
        self.label = kind.upper()
        self.mode_key = f"{kind}_charge_mode"
        self.charging_key = f"{kind}_charging"
        self.state = {}
        self.previews = {}
        self._lock = asyncio.Lock()
        self.job = None
        self.closing = False

    async def load(self):
        saved = await self.state_store.async_load()
        if saved:
            if saved.get("version") != 1 or not isinstance(saved.get("session"), dict):
                raise SafetyError(f"Unsupported {self.label} session recovery data")
            self.state = saved["session"]

    @property
    def busy(self):
        return self.job is not None and not self.job.done()

    @property
    def can_stop(self):
        if self.state.get("stop_attempted") or self.state.get("phase") == "restoring":
            return False
        if self.state.get("active"):
            return True
        expires = self.state.get("expires_at")
        return bool(self.state.get("phase") == "waiting" and self.state.get("start_acknowledged")
                    and expires and datetime.fromisoformat(expires) > self.clock())

    def public(self):
        public = {key: self.state[key] for key in (
            "active", "phase", "message", "temporary_fast", "serial", "request_id", "started_at", "expires_at", "stop_attempted"
        ) if key in self.state}
        if public:
            public["can_stop"] = self.can_stop
        return public

    async def _save(self, **values):
        next_state = {**self.state, **values}
        await self.state_store.async_save({"version": 1, "session": deepcopy(next_state)})
        self.state = next_state
        self.notify()

    async def preview(self, user, serial):
        async with self._lock, self.operation_lock:
            if self.state.get("active") or self.busy:
                raise SafetyError(f"Finish the current {self.label} session before starting another")
            provider = await self.provider(serial, False)
            before = (await provider.read([self.mode_key]))[self.mode_key]
            if self.kind == "dc" and before["mode"] == 2:
                raise SafetyError("Switch out of V2X in mySigen before starting DC charging")
            identity = await provider.identity()
            now = self.clock()
            self.previews = {key: row for key, row in self.previews.items() if row["expires"] > now}
            if len(self.previews) >= 8:
                raise SafetyError("Close an existing charging preview before opening another")
            token = str(uuid4())
            self.previews[token] = {"user": user, "serial": provider.devices[self.charging_key],
                "identity": identity, "before": deepcopy(before), "expires": now + timedelta(minutes=3)}
            return {"token": token, "mode": before["mode"], "surplus": before["mode"] == 1}

    def consume(self, user, token, temporary_fast):
        row = self.previews.get(token)
        if row is None or row["user"] != user or row["expires"] <= self.clock():
            raise SafetyError("This charging preview expired; open it again")
        if self.state.get("active") or self.busy:
            raise SafetyError(f"Finish the current {self.label} session before starting another")
        if temporary_fast and row["before"]["mode"] != 1:
            raise SafetyError("A temporary Fast override requires a fresh Surplus-mode preview")
        self.previews.pop(token)
        return {**row, "temporary_fast": temporary_fast, "request_id": str(uuid4())}

    async def _journal(self, provider):
        identity = await provider.identity()
        if identity != self.state.get("identity"):
            raise SafetyError(f"The connected plant changed; {self.label} recovery was not sent")
        return RecoveryJournal(self.mode_store, provider, plant_identity=identity, clock=self.clock)

    async def start(self, request):
        async with self._lock, self.operation_lock:
            try:
                provider = await self.provider(request["serial"], True)
                if await provider.identity() != request["identity"]:
                    raise SafetyError("The plant changed since this charging preview")
                current = (await provider.read([self.mode_key]))[self.mode_key]
                if canonical(current) != canonical(request["before"]):
                    raise SafetyError("Charging settings changed; reopen Start Charging")
                if self.kind == "dc" and current["mode"] == 2:
                    raise SafetyError("Switch out of V2X in mySigen before starting DC charging")
                status = await provider.charger_state(self.charging_key)
                if status == 3:
                    raise SafetyError("This charger is already charging")
                if self.kind == "dc" and status in (0, 4, 7, 9):
                    raise SafetyError("Connect the vehicle and check the DC charger before starting")
                now = self.clock()
                self.state = {"active": True, "phase": "preparing", "request_id": request["request_id"],
                    "serial": request["serial"], "identity": request["identity"],
                    "temporary_fast": request["temporary_fast"], "start_attempted": False, "start_acknowledged": False,
                    "seen_charging": False, "started_at": now.isoformat(),
                    "expires_at": (now + timedelta(hours=24)).isoformat()}
                await self._save(message=f"Preparing {self.label} charging")
                if request["temporary_fast"]:
                    target = {**current, "mode": 0}
                    # The owner's grid power cap, battery assistance and SOC
                    # settings are retained. AC Fast temporarily permits grid use.
                    if self.kind == "ac" and target["grid_charging"] is not None:
                        target["grid_charging"] = True
                    journal = await self._journal(provider)
                    await journal.apply(request["request_id"], [(self.mode_key, target)],
                        expires_at=now + timedelta(hours=24), context={"key": self.mode_key, "serial": request["serial"]},
                        expected_baseline={self.mode_key: current})
                await self._save(phase="starting", start_attempted=True, message=f"Requesting {self.label} charging")
                await provider.write(self.charging_key, True)
                await self._save(start_acknowledged=True)
                status = await provider.charger_state(self.charging_key)
                await self._observe(provider, status)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                await self._save(phase="recovery_pending" if self.state.get("active") else "failed",
                    message=str(error) if isinstance(error, SafetyError) else f"{self.label} start outcome unconfirmed; checking charger state")

    async def _finish(self, provider, message):
        if self.state.get("temporary_fast"):
            journal = await self._journal(provider)
            pending = await journal.pending()
            if pending:
                await self._save(phase="restoring", message="Restoring previous Surplus settings")
                result = await journal.restore(self.state["request_id"])
                if result["phase"] == "superseded":
                    await self._save(active=False, phase="superseded", message="Newer owner settings preserved; Surplus restoration skipped")
                    return
                if result["phase"] != "restored":
                    raise SafetyError("Previous charging mode is not yet confirmed")
                message += "; previous Surplus settings restored"
        await self._save(active=False, phase="finished", message=message)

    async def _observe(self, provider, status):
        now = self.clock()
        if self.state.get("stop_attempted"):
            if status == 3:
                await self._save(phase="stopping", message="Stop requested; waiting for the charger")
            else:
                await self._finish(provider, f"{self.label} charging stopped")
            return
        if now >= datetime.fromisoformat(self.state["expires_at"]):
            await self._finish(provider, "Temporary session reached its 24-hour limit")
            return
        if not self.state.get("start_attempted"):
            await self._finish(provider, "Interrupted start was not replayed")
            return
        if status == 3:
            await self._save(phase="charging", seen_charging=True, ended_since=None,
                message="Temporary Fast charging active; Surplus returns after this session"
                if self.state.get("temporary_fast") else f"{self.label} charging active")
            return
        if self.state.get("seen_charging"):
            ended = self.state.get("ended_since")
            if ended and (now - datetime.fromisoformat(ended)).total_seconds() >= 60:
                await self._finish(provider, f"{self.label} charging session ended")
            else:
                await self._save(phase="finishing", ended_since=ended or now.isoformat(),
                    message=f"Checking whether the {self.label} charging session has ended")
            return
        if (now - datetime.fromisoformat(self.state["started_at"])).total_seconds() >= 180:
            if self.state.get("temporary_fast"):
                await self._finish(provider, "The vehicle did not start charging")
            else:
                await self._save(active=False, phase="waiting", message="Start accepted; charger is waiting for its configured charging conditions")
            return
        await self._save(phase="waiting", message="Start accepted; waiting for the vehicle or charging conditions"
            if self.state.get("start_acknowledged") else "Start outcome unconfirmed; checking the charger without resending")

    async def poll(self, _now=None):
        if self.closing or self.busy or not self.state.get("active") or self._lock.locked():
            return
        async with self._lock, self.operation_lock:
            try:
                provider = await self.provider(self.state["serial"], False)
                if await provider.identity() != self.state.get("identity"):
                    raise SafetyError("The connected plant changed; recovery is blocked")
                await self._observe(provider, await provider.charger_state(self.charging_key))
            except asyncio.CancelledError:
                raise
            except Exception:
                await self._save(phase="recovery_pending", message=f"Waiting for Cloud to verify the {self.label} session; no command was replayed")

    async def stop(self, serial):
        async with self._lock, self.operation_lock:
            if not self.can_stop or serial != self.state.get("serial"):
                raise SafetyError("This charger has no cancellable TC session")
            try:
                provider = await self.provider(serial, "stop")
                await self._journal(provider)  # Verify plant identity before a stop.
                await self._save(active=True, phase="stopping", stop_attempted=True, message=f"Stopping {self.label} charging")
                await provider.write(self.charging_key, False)
                await self._observe(provider, await provider.charger_state(self.charging_key))
            except asyncio.CancelledError:
                raise
            except Exception:
                await self._save(phase="recovery_pending", message="Stop outcome unconfirmed; checking before restoring Surplus")

    async def close(self):
        self.closing = True
        if self.busy:
            self.job.cancel()
            await asyncio.gather(self.job, return_exceptions=True)
