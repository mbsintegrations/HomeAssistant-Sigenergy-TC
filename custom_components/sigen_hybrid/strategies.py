"""Entry-owned rule scheduler; subscriptions/timers are removed on unload."""

import asyncio
import logging
from contextlib import suppress
from datetime import datetime, timedelta

from .core.models import Source, utcnow
from .core.strategies import choose_strategy

_LOGGER = logging.getLogger(__name__)


class StrategyRunner:
    def __init__(self, runtime, *, clock=utcnow):
        self.runtime, self.clock = runtime, clock
        self.preferences = {}
        self.state = {"state": "disabled"}
        self._lock = asyncio.Lock()
        self._unsubscribe = None
        self._resume = False
        self._resume_at = None
        self._last_request = None
        self._retry_at = None
        self._closing = False
        self._task = None

    async def setup(self):
        from homeassistant.components.frontend import async_system_store
        store = await async_system_store(self.runtime.hass)
        key = f"sigen_hybrid_tc_{self.runtime.entry.entry_id}"

        def update():
            document = store.data.get(key) or {}
            self.preferences = document.get("settings", {}) if isinstance(document, dict) else {}
            if document.get("changed_route") == "strategy_control":
                self._resume = self.preferences.get("strategy_control", {}).get("enabled") is True
                self._resume_at = self.clock()
            self.runtime.async_update_listeners()

        update()
        self._resume = False  # A restart must not silently clear an owner's pause.
        self._unsubscribe = store.async_subscribe(key, update)

    async def tick(self, _now=None):
        if self._closing or self._lock.locked():
            return
        async with self._lock:
            self._task = asyncio.current_task()
            try:
                await self._tick()
            except Exception as error:
                _LOGGER.warning("Strategy evaluation failed (%s)", type(error).__name__)
                self.state = {"state": "unavailable", "reason": "Check strategy configuration and control status"}
            finally:
                self._task = None
                self.runtime.async_update_listeners()

    async def _tick(self):
        now, controls = self.clock(), self.runtime.controls
        if controls is None or not controls.enabled:
            self.state = {"state": "disabled", "reason": "Plant control is not enabled"}
            return
        record = await controls.automation_record()
        active = record.get("active")
        master = self.preferences.get("strategy_control", {}).get("enabled") is True
        if self._resume and master:
            await controls.resume_automation(requested_at=self._resume_at)
            self._resume = False
            record = await controls.automation_record()
            active = record.get("active")
        if record.get("automation_pause", {}).get("paused") is True:
            self.state = {"state": "paused", "reason": "Owner changed plant settings; resume scheduling when ready"}
            return
        if active and active.get("context", {}).get("source") != Source.AUTOMATION.value:
            self.state = {"state": "manual_override"}
            return
        if controls._job is not None and not controls._job.done():
            self.state = {"state": "processing", "request_id": controls.operation.get("request_id")}
            return
        if active and active["phase"] != "confirmed":
            self.state = {"state": "recovery_pending"}
            return
        if any(end is not None and end > now for end in (
            self.runtime.controller.manual_until, self.runtime.controller.automation_paused_until,
        )):
            self.state = {"state": "manual_override"}
            return
        selected, invalid = None, None
        soc = self.runtime.reading("soc")
        if master and soc is not None:
            try:
                selected = choose_strategy(self.preferences.get("strategy", {}), now,
                                           self.runtime.hass.config.time_zone, soc.value)
            except (ValueError, KeyError, TypeError) as error:
                invalid = str(error)
        if selected is not None and selected.action in ("export", "battery_export") and not self.runtime.controller.limits.export_permitted:
            invalid, selected = "Grid export approval is not enabled", None
        if active:
            expiry = datetime.fromisoformat(active["expires_at"])
            expected = f"{selected.identity}:{selected.fingerprint()}" if selected else None
            same = active.get("context", {}).get("strategy_id") == expected
            if not master or not same or expiry <= now+timedelta(seconds=90):
                outcome = await controls.release_automation(active["request_id"])
                if outcome["phase"] not in ("restored", "idle"):
                    self.state = {"state": "paused", "reason": "Owner changes were preserved"}
                    return
                active = None
            else:
                self.state = {"state": "running", "strategy": selected.name, "expires_at": expiry.isoformat()}
                return
        if not master:
            self.state = {"state": "disabled"}
            return
        if invalid:
            self.state = {"state": "configuration_error", "reason": invalid}
            return
        if soc is None:
            self.state = {"state": "unavailable", "reason": "Fresh battery SOC is required"}
            return
        if selected is None:
            self.state = {"state": "waiting"}
            return
        if self._last_request and controls.operation.get("request_id") == self._last_request and controls.operation.get("phase") == "failed":
            self._retry_at = self._retry_at or now+timedelta(minutes=5)
            if now < self._retry_at:
                self.state = {"state": "backoff", "retry_at": self._retry_at.isoformat()}
                return
        intent = selected.intent(now, self.runtime.hass.config.time_zone, self.runtime.controller.limits)
        result = await controls.submit(intent)
        self._last_request, self._retry_at = intent.request_id, None
        self.state = {"state": "processing", "strategy": selected.name, "request_id": result["request_id"]}

    async def close(self):
        self._closing = True
        if self._unsubscribe is not None:
            self._unsubscribe()
            self._unsubscribe = None
        if self._task is not None and self._task is not asyncio.current_task():
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
