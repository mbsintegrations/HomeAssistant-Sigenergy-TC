"""Verify handover, routing and duplicate prevention with synthetic actors."""

import asyncio
from types import SimpleNamespace

import pytest

from custom_components.sigen_hybrid.core.errors import SafetyError
from custom_components.sigen_hybrid.core.models import Intent, Mode, Route, Source
from custom_components.sigen_hybrid.local_controls import HybridOwnerControls


class Actor:
    def __init__(self, route, *, enabled=True):
        self.route, self.enabled = route, enabled
        self.runtime = SimpleNamespace(connections={"cloud": {"status": "connected"}})
        self._job, self.active, self.manual_supported = None, None, True
        self.operation, self.calls = {}, []
        self.history = []

    async def automation_record(self):
        return {"active": self.active, "history": self.history}

    async def submit(self, intent):
        self.calls.append(("submit", intent))
        return {"route": self.route}

    async def preview(self, intent):
        self.calls.append(("preview", intent))
        return {"route": self.route}

    async def setting(self, key, value, **kwargs):
        self.calls.append(("setting", key, value, kwargs))
        return {"route": self.route}

    async def cancel(self):
        self.calls.append(("cancel",))
        self.active = None
        self.operation = {"phase": "restored"}


def authority():
    cloud, local = Actor(Route.CLOUD), Actor(Route.MODBUS)
    return HybridOwnerControls(cloud, local), cloud, local


async def test_local_charge_and_native_cloud_discharge_keep_independent_pv_export():
    controls, cloud, local = authority()
    assert (await controls.submit(Intent(Mode.CHARGE, power_kw=2)))["route"] == "modbus"
    assert (await controls.submit(Intent(Mode.DISCHARGE, power_kw=2)))["route"] == "cloud"
    cloud.runtime.connections["cloud"]["status"] = "disconnected"
    assert (await controls.submit(Intent(Mode.HOLD)))["route"] == "modbus"


async def test_an_owner_can_handover_only_after_confirmed_release():
    controls, cloud, local = authority()
    local.active = {"request_id": "local", "context": {"source": "automation"}}
    assert (await controls.setting("native_mode", {}, source=Source.MANUAL, dry_run=False))["route"] == "cloud"
    assert local.calls == [("cancel",)]
    assert cloud.calls[0][0] == "setting"


@pytest.mark.parametrize("kwargs", [{"source": Source.AUTOMATION, "dry_run": False}, {"source": Source.MANUAL, "dry_run": True}])
async def test_automation_or_preview_cannot_release_another_routes_owner(kwargs):
    controls, cloud, local = authority()
    local.active = {"request_id": "manual", "context": {"source": "manual"}}
    with pytest.raises(SafetyError):
        await controls.setting("native_mode", {}, **kwargs)
    assert local.calls == cloud.calls == []


async def test_uncertain_release_blocks_takeover_and_never_sends_on_second_transport():
    controls, cloud, local = authority()
    local.active = {"request_id": "unknown", "phase": "uncertain"}

    async def uncertain():
        local.operation = {"phase": "recovery_pending"}

    local.cancel = uncertain
    with pytest.raises(SafetyError):
        await controls.setting("native_mode", {}, source=Source.MANUAL, dry_run=False)
    assert cloud.calls == []


async def test_running_job_blocks_new_commands_and_grid_settings_use_installer_metadata():
    controls, cloud, local = authority()
    cloud._job = asyncio.get_running_loop().create_future()
    with pytest.raises(SafetyError):
        await controls.submit(Intent(Mode.HOLD))
    assert local.calls == []
    cloud._job.set_result(None)
    assert (await controls.setting("grid_import_limit", {}, source=Source.MANUAL, dry_run=False))["route"] == "cloud"
    assert (await controls.setting("battery_levels", {}, source=Source.MANUAL, dry_run=False))["route"] == "modbus"


async def test_local_jobs_and_cancel_continue_while_cloud_polling_is_blocked():
    from test_control_session import Store
    from test_expanded_controls import LocalAppliance
    from test_owner_control_runtime import runtime

    from custom_components.sigen_hybrid.local_controls import LocalOwnerControls

    original, coordinator, _, _, clock, _ = runtime()
    coordinator.entry.data = {"host": "synthetic.invalid", "port": 502, "sole_modbus_client": True, "inverter_unit_id": 2}
    coordinator.entry.options["control"]["local_enabled"] = True
    appliance = LocalAppliance()

    async def serial(unit_id):
        assert unit_id == 2
        return "INVERTER-42"

    appliance.device_identity = serial
    coordinator.local = appliance
    local = LocalOwnerControls(coordinator, Store(), clock=lambda: clock[0])
    coordinator.controller.executor = local
    await coordinator._cloud_update_lock.acquire()
    try:
        await local.submit(Intent(Mode.HOLD))
        await asyncio.wait_for(local._job, timeout=1)
        assert local.operation["phase"] == "confirmed" and appliance.values["remote_ems"] == 1
        await local.cancel()
        await asyncio.wait_for(local._job, timeout=1)
        assert local.operation["phase"] == "restored" and appliance.values["remote_ems"] == 0
    finally:
        coordinator._cloud_update_lock.release()
        await local.close()
        await original.close()


async def test_request_ids_are_not_replayed_after_a_transport_change_or_restart():
    controls, cloud, local = authority()
    cloud.history = [{"request_id": "already-sent", "phase": "restored"}]
    with pytest.raises(SafetyError, match="already processed"):
        await controls.submit(Intent(Mode.CHARGE, power_kw=2, request_id="already-sent"))
    assert local.calls == cloud.calls == []


async def test_combined_writers_verify_the_same_inverter_and_keep_the_binding_offline():
    from test_control_session import Store

    controls, cloud, local = authority()
    serials, calls = ["INVERTER-A"], []

    async def local_serial(unit):
        assert unit == 2
        return "INVERTER-A"

    async def cloud_serials():
        calls.append("cloud-read")
        return serials

    runtime = SimpleNamespace(
        entry=SimpleNamespace(data={"host": "synthetic.invalid", "inverter_unit_id": 2},
                              options={"cloud": {"station_id": "42", "region": "eu", "username": "synthetic"}}),
        local=SimpleNamespace(device_identity=local_serial),
        cloud=SimpleNamespace(_connected=True, client=SimpleNamespace(station_id="42", aio_serials=cloud_serials)),
        _cloud_update_lock=asyncio.Lock(), source_binding_verified=False,
    )
    cloud.runtime = local.runtime = runtime
    store = Store()
    controls.binding_store = store
    await controls._ensure_source_binding()
    assert runtime.source_binding_verified and calls == ["cloud-read"]
    runtime.cloud._connected = False
    restarted = HybridOwnerControls(cloud, local, store)
    await restarted._ensure_source_binding()
    assert calls == ["cloud-read"]
    runtime.entry.options["cloud"]["station_id"] = "43"
    runtime.cloud.client.station_id = "43"
    runtime.cloud._connected = True
    serials[:] = ["DIFFERENT-INVERTER"]
    with pytest.raises(SafetyError, match="does not match"):
        await restarted._ensure_source_binding()
    assert cloud.calls == local.calls == []


async def test_cloud_control_does_not_borrow_unverified_local_plant_telemetry(monkeypatch):
    import importlib

    from test_owner_control_runtime import runtime

    controls, coordinator, _, _, _, _ = runtime()
    coordinator.source_binding_verified = False
    expected = object()

    async def cloud_telemetry(*args, **kwargs):
        return expected

    monkeypatch.setattr(importlib.import_module("custom_components.sigen_hybrid.controls"), "cloud_control_telemetry", cloud_telemetry)
    assert await controls.snapshot() is expected
    await controls.close()
