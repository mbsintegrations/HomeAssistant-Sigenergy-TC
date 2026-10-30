"""Exercise the HA-facing command job path using synthetic appliances only."""

import asyncio
from types import SimpleNamespace

import pytest
from test_control_session import setup

from custom_components.sigen_hybrid.controls import OwnerControls
from custom_components.sigen_hybrid.core.errors import CapabilityError, SafetyError
from custom_components.sigen_hybrid.core.models import Intent, Mode


def runtime(*, enabled=True, store=None, appliance=None):
    clock, original, original_store, journal, session, controller, snapshot = setup()
    appliance, store = appliance or original, store or original_store
    old_read = appliance._data

    async def read(method, path, **kwargs):
        if path == "device/owner/station/home":
            return {"stationId": 42, "status": 1, "blockClient": False, "onGrid": True, "hasInstantSetting": True}
        return await old_read(method, path, **kwargs)

    appliance._data = read
    notifications = []
    entry = SimpleNamespace(
        entry_id="synthetic",
        data={},
        options={"cloud": {"station_id": "42", "region": "eu"}, "control": {"enabled": enabled}},
        async_create_background_task=lambda hass, coro, name: asyncio.create_task(coro, name=name),
    )
    result = SimpleNamespace(
        hass=SimpleNamespace(data={}),
        entry=entry,
        data=snapshot,
        local_error=None,
        controller=controller,
        cloud=SimpleNamespace(client=appliance, station_id="42", _connected=True),
        cloud_data={},
        _cloud_update_lock=asyncio.Lock(),
        async_update_listeners=lambda: notifications.append(True),
    )
    controls = OwnerControls(result, store, clock=lambda: clock[0])
    controller.executor = controls if enabled else None
    result.controls = controls
    return controls, result, appliance, store, clock, notifications


async def test_service_job_returns_quickly_then_runs_controller_and_publishes_real_result():
    controls, coordinator, appliance, store, clock, notifications = runtime()
    intent = Intent(Mode.DISCHARGE, power_kw=2, request_id="job")
    response = await controls.submit(intent)
    assert response["phase"] == "queued" and not appliance.calls
    await controls._job
    assert controls.operation["phase"] == "confirmed"
    assert appliance.manual["mode"] == "1" and appliance.export["currentEnable"] is True
    assert store.value["plant_identity"] == "cloud:eu:42" and len(notifications) >= 2
    writes = len([c for c in appliance.calls if c[0] != "GET"])
    assert (await controls.submit(intent))["phase"] == "confirmed"
    assert len([c for c in appliance.calls if c[0] != "GET"]) == writes
    await controls.close()


async def test_default_locked_runtime_never_queues_or_sends_a_request():
    controls, coordinator, appliance, store, clock, notifications = runtime(enabled=False)
    with pytest.raises(CapabilityError):
        await controls.submit(Intent(Mode.HOLD))
    await controls.reconcile()
    assert not appliance.calls and store.value is None


async def test_preview_cannot_trigger_recovery_writes_from_an_uncertain_journal():
    controls, coordinator, appliance, store, clock, notifications = runtime()
    appliance.lost_reply = True
    await controls.submit(Intent(Mode.CHARGE, power_kw=2))
    await controls._job
    assert store.value["active"]["phase"] == "uncertain"
    writes = len([c for c in appliance.calls if c[0] != "GET"])
    # A new runtime binds to the persisted journal, as it would after HA restart.
    restarted, _, _, _, _, _ = runtime(store=store, appliance=appliance)
    result = await restarted.preview(Intent(Mode.HOLD))
    assert result["status"] == "preview"
    assert len([c for c in appliance.calls if c[0] != "GET"]) == writes
    await controls.close()
    await restarted.close()


async def test_other_jobs_cannot_overlap_and_ids_cannot_be_reused():
    controls, coordinator, appliance, store, clock, notifications = runtime()
    intent = Intent(Mode.HOLD, request_id="same")
    await controls.submit(intent)
    with pytest.raises(SafetyError):
        await controls.submit(Intent(Mode.CHARGE, power_kw=2))
    await controls._job
    with pytest.raises(SafetyError, match="different parameters"):
        await controls.submit(Intent(Mode.CHARGE, power_kw=2, request_id="same"))
    await controls.close()


async def test_idle_recovery_makes_no_cloud_request():
    controls, coordinator, appliance, store, clock, notifications = runtime()
    await controls.reconcile()
    assert not appliance.calls


async def test_wrong_active_plant_is_rejected_without_writes():
    controls, coordinator, appliance, store, clock, notifications = runtime()
    coordinator.cloud.station_id = "99"
    await controls.submit(Intent(Mode.HOLD))
    await controls._job
    assert controls.operation["phase"] == "failed" and not appliance.calls
    await controls.close()


async def test_cancellation_releases_only_owned_control_and_restores_limits():
    controls, coordinator, appliance, store, clock, notifications = runtime()
    await controls.submit(Intent(Mode.DISCHARGE, power_kw=2))
    await controls._job
    response = await controls.cancel()
    assert response["phase"] == "cancelling"
    await controls._job
    assert controls.operation["phase"] == "restored"
    assert controls.operation["request_id"] == response["request_id"]
    assert appliance.manual == {"enable": False} and appliance.export["currentEnable"] is False
    assert coordinator.controller.manual_until is None
    await controls.close()


async def test_cancel_does_not_touch_an_unrelated_native_override():
    controls, coordinator, appliance, store, clock, notifications = runtime()
    appliance.manual = {"enable": True, "mode": "2", "endTime": clock[0].timestamp() + 1800}
    await controls.cancel()
    await controls._job
    assert controls.operation["phase"] == "idle" and appliance.manual["enable"] is True
    assert not appliance.calls
    await controls.close()


async def test_two_configuration_entries_cannot_control_the_same_plant_concurrently():
    first, coordinator, appliance, store, clock, notifications = runtime()
    await first.submit(Intent(Mode.HOLD))
    await first._job
    second, other, second_appliance, _, _, _ = runtime()
    other.hass = coordinator.hass
    other.entry.entry_id = "another-entry"
    await second.submit(Intent(Mode.HOLD))
    await second._job
    assert second.operation["phase"] == "failed" and not second_appliance.calls
    assert "already owns" in second.operation["message"]
    await first.close()
    await second.close()


async def test_owner_handoff_stops_our_override_and_keeps_automation_paused_across_restart():
    controls, coordinator, appliance, store, clock, notifications = runtime()
    await controls.submit(Intent(Mode.CHARGE, power_kw=2))
    await controls._job
    appliance.levels["chargeSOC"] = "85"
    await controls.cancel()
    await controls._job
    assert appliance.manual == {"enable": False} and appliance.levels["chargeSOC"] == "85"
    assert coordinator.controller.manual_until is None
    assert coordinator.controller.automation_paused_until > clock[0]
    await controls.close()
    restarted, other, _, _, _, _ = runtime(store=store, appliance=appliance)
    from custom_components.sigen_hybrid.core.models import Source

    await restarted.submit(Intent(Mode.HOLD, source=Source.AUTOMATION))
    await restarted._job
    assert restarted.operation["phase"] == "failed" and "owner change" in restarted.operation["message"]
    assert store.value["automation_pause"]["paused"] is True
    assert appliance.manual == {"enable": False}
    await restarted.close()
