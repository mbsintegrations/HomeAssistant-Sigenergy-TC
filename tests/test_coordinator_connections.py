"""Exercise the actual coordinator with synthetic independent transports."""

import ast
import asyncio
import importlib
import logging
import sys
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.sigen_hybrid.core.cloud import CloudAdapter
from custom_components.sigen_hybrid.core.connections import (
    capabilities,
    connection_states,
    enabled_connections,
    select_reading,
)
from custom_components.sigen_hybrid.core.control import Controller
from custom_components.sigen_hybrid.core.energy import DailyEnergyCounters
from custom_components.sigen_hybrid.core.errors import AuthenticationError
from custom_components.sigen_hybrid.core.models import SafetyLimits, Snapshot

NOW = datetime(2026, 10, 28, tzinfo=timezone.utc)


class CoordinatorDouble:
    def __init__(self, *args, **kwargs):
        self.data = None
        self.notifications = 0
        self.hass = args[0]

    def async_update_listeners(self):
        self.notifications += 1


def coordinator(local=None, cloud=None):
    tree = ast.parse(Path("custom_components/sigen_hybrid/coordinator.py").read_text())
    scope = {
        "__package__": "custom_components.sigen_hybrid",
        "DataUpdateCoordinator": CoordinatorDouble,
        "asyncio": asyncio,
        "timedelta": timedelta,
        "LOGGER": logging.getLogger(__name__),
        "DOMAIN": "sigen_hybrid",
        "DEFAULT_POLL_SECONDS": 45,
        "Controller": Controller,
        "SafetyLimits": SafetyLimits,
        "Snapshot": Snapshot,
        "replace": replace,
        "DailyEnergyCounters": DailyEnergyCounters,
        "utcnow": lambda: NOW,
        "capabilities": capabilities,
        "connection_states": connection_states,
        "enabled_connections": enabled_connections,
        "select_reading": select_reading,
        "AuthenticationError": AuthenticationError,
    }

    async def forecast(*args):
        return {"available": True}

    scope["async_forecast_overview"] = forecast
    exec(
        compile(
            ast.Module(body=[n for n in tree.body if isinstance(n, (ast.ClassDef, ast.FunctionDef))], type_ignores=[]),
            "coordinator.py",
            "exec",
        ),
        scope,
    )
    entry = SimpleNamespace(
        data={"host": "synthetic.invalid"}, options={"cloud": {"saved": True}, "api": {"saved": True}}
    )
    return scope["SigenCoordinator"](SimpleNamespace(), entry, local, cloud)


class Local:
    fail = False

    async def snapshot(self):
        if self.fail:
            raise TimeoutError
        return Snapshot(NOW, 60, 0, 2, 1, -1, 20, 5, 5)


class Cloud:
    fail = False

    async def refresh(self):
        if self.fail:
            raise TimeoutError
        return {"updated_at": NOW.isoformat(), "telemetry": {"pv_kw": 2}, "telemetry_available": True}



async def test_internet_outage_never_erases_local_readings_or_forecast():
    local, cloud = Local(), Cloud()
    runtime = coordinator(local, cloud)
    runtime.data = await runtime._async_update_data()
    cloud.fail = True
    await runtime.async_cloud_update()
    assert runtime.reading("pv_kw").value == 0 and runtime.reading("pv_kw").source == "modbus"
    assert runtime.connections["cloud"]["status"] == "disconnected"
    assert runtime.forecast_data["available"]
    assert "api" not in runtime.connections


async def test_local_outage_uses_cloud_but_never_creates_a_fake_control_snapshot():
    local, cloud = Local(), Cloud()
    runtime = coordinator(local, cloud)
    runtime.data = await runtime._async_update_data()
    original = runtime.data
    await runtime.async_cloud_update()
    local.fail = True
    runtime.data = await runtime._async_update_data()
    assert runtime.data is original and runtime.local_error
    assert runtime.reading("pv_kw").source == "cloud"
    cloud.fail = True
    await runtime.async_cloud_update()
    assert runtime.reading("pv_kw") is None
    local.fail = False
    runtime.data = await runtime._async_update_data()
    assert runtime.reading("pv_kw").source == "modbus" and runtime.local_error is None


async def test_cloud_only_monitoring_never_creates_a_control_snapshot():
    runtime = coordinator(None, Cloud())
    runtime.entry.data = {"cloud_only": True}
    assert await runtime._async_update_data() is None
    await runtime.async_cloud_update()
    assert runtime.data is None and runtime.reading("pv_kw").source == "cloud"
    assert not runtime.capabilities["manual_control"]["supported"]


@pytest.mark.parametrize("blocked_gate", [False, True])
async def test_expired_credentials_request_native_reauth_without_erasing_local_data(blocked_gate):
    class ExpiredCloud(Cloud):
        client = SimpleNamespace(
            request_gate=SimpleNamespace(auth_blocked=blocked_gate, status={"reason": "authentication_required"})
        )

        async def refresh(self):
            if blocked_gate:
                raise TimeoutError("Transport wrapped an expired-token response")
            raise AuthenticationError("Credentials require repair")

    runtime = coordinator(Local(), ExpiredCloud())
    reauth = []
    runtime.entry.async_start_reauth = lambda hass: reauth.append(hass)
    runtime.data = await runtime._async_update_data()
    original = runtime.data
    await runtime.async_cloud_update()
    assert runtime.cloud_error == "authentication_required"
    assert reauth == [runtime.hass]
    assert runtime.data is original and runtime.reading("pv_kw").source == "modbus"


async def test_cloud_refreshes_do_not_overlap_and_transient_failure_can_recover():
    class WatchedCloud(Cloud):
        active = 0
        maximum = 0

        async def refresh(self):
            self.active += 1
            self.maximum = max(self.maximum, self.active)
            try:
                await asyncio.sleep(0)
                return await super().refresh()
            finally:
                self.active -= 1

    cloud = WatchedCloud()
    runtime = coordinator(None, cloud)
    cloud.fail = True
    await runtime.async_cloud_update()
    assert runtime.cloud_error
    cloud.fail = False
    await asyncio.gather(runtime.async_cloud_update(), runtime.async_cloud_update())
    assert cloud.maximum == 1 and runtime.cloud_error is None
    assert not runtime._cloud_tasks


async def test_startup_cloud_creation_failure_is_retried_on_later_update(monkeypatch):
    calls, adapters = [], []

    async def factory(hass, options):
        calls.append(options)
        if len(calls) == 1:
            raise OSError("Synthetic startup outage")
        return SimpleNamespace()

    class Adapter(CloudAdapter):
        def __init__(self, client, *args, **kwargs):
            # Exercise the actual adapter constructor; a permissive fake hid
            # a broken station-identity keyword in the startup retry path.
            super().__init__(client, *args, **kwargs)
            adapters.append(kwargs)

        async def refresh(self):
            return await Cloud().refresh()

    monkeypatch.setitem(
        sys.modules,
        "custom_components.sigen_hybrid.cloud_client",
        SimpleNamespace(async_create_cloud_client=factory),
    )
    monkeypatch.setattr(importlib.import_module("custom_components.sigen_hybrid.core.cloud"), "CloudAdapter", Adapter)
    runtime = coordinator()
    runtime.entry.data = {"cloud_only": True}
    runtime.entry.options = {"cloud": {"station_id": "7", "unofficial_opt_in": True}}
    await runtime.async_cloud_update()
    assert runtime.cloud is None and runtime.cloud_error
    await runtime.async_cloud_update()
    assert len(calls) == 2 and runtime.cloud_error is None
    assert runtime.cloud.station_id == "7"
    assert adapters == [{"expected_station_id": "7", "unofficial_opt_in": True, "live_refresh_seconds": 60}]


async def test_unload_cancels_running_and_queued_cloud_reads_before_closing():
    events = []

    class WaitingCloud(Cloud):
        async def refresh(self):
            events.append("reading")
            try:
                await asyncio.Event().wait()
            finally:
                events.append("read_finished")

        async def close(self):
            events.append("closed")

    runtime = coordinator(None, WaitingCloud())
    tasks = [asyncio.create_task(runtime.async_cloud_update()) for _ in range(2)]
    await asyncio.sleep(0)
    await runtime.async_close()
    assert all(task.cancelled() for task in tasks)
    assert events == ["reading", "read_finished", "closed"]
    assert not runtime._cloud_tasks
    await runtime.async_cloud_update()
    assert events[-1] == "closed"


async def test_counter_storage_failure_cannot_leave_transport_connections_open():
    closed = []

    class Store:
        async def async_save(self, _data):
            raise OSError("Synthetic disk failure")

    class Provider:
        async def close(self):
            closed.append(self)

    local, cloud = Provider(), Provider()
    runtime = coordinator(local, cloud)
    runtime.energy_store = Store()
    with pytest.raises(OSError):
        await runtime.async_close()
    assert set(closed) == {local, cloud}
