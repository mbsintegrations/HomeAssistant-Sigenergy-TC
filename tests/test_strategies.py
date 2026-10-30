from dataclasses import replace
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from test_owner_control_runtime import runtime

from custom_components.sigen_hybrid.core.models import Intent, Mode, SafetyLimits
from custom_components.sigen_hybrid.core.strategies import Strategy, choose_strategy
from custom_components.sigen_hybrid.strategies import StrategyRunner

NOW = datetime(2026, 10, 29, 19, tzinfo=timezone.utc)


def rule(**kwargs):
    return {"name": "Evening", "start": "08:00", "end": "01:00", "weekdays": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
            "condition": "above", "soc": 40, "action": "discharge", "priority": 50, "enabled": True, **kwargs}


def test_overnight_window_uses_start_weekday_and_ends_next_morning():
    value = Strategy.from_dict("r", rule(weekdays=["thu"], soc=75))
    morning = NOW.replace(day=30, hour=0)
    anchor, end = value.period(morning, "Europe/Dublin")
    assert anchor == "2026-10-29" and end == morning.replace(hour=1)
    assert value.period(morning.replace(hour=1), "Europe/Dublin") is None
    assert value.matches_soc(75.1) and not value.matches_soc(75)
    intent = value.intent(NOW, "Europe/Dublin", SafetyLimits(export_permitted=True))
    assert intent.reserve_soc == 75 and intent.deadline == NOW+timedelta(minutes=15)


@pytest.mark.parametrize("date,end", [(datetime(2026, 3, 29, tzinfo=timezone.utc), 3),
                                     (datetime(2026, 10, 25, tzinfo=timezone.utc), 4)])
def test_dst_windows_follow_local_end_instead_of_fixed_24_hour_arithmetic(date, end):
    value = Strategy.from_dict("r", rule(start="00:00", end="04:00", condition="none"))
    assert value.period(date, "Europe/Dublin")[1] == date.replace(hour=end)


def test_repeated_end_time_does_not_rearm_a_finished_window():
    value = Strategy.from_dict("r", rule(start="00:00", end="01:30", condition="none"))
    assert value.period(datetime(2026, 10, 25, 0, 15, tzinfo=timezone.utc), "Europe/Dublin")
    assert value.period(datetime(2026, 10, 25, 1, 15, tzinfo=timezone.utc), "Europe/Dublin") is None


def test_all_day_and_below_conditions_are_explicit_and_strict():
    value = Strategy.from_dict("r", rule(start="00:00", end="24:00", condition="below", soc=75))
    assert value.period(NOW, "UTC")[1] == NOW.replace(day=30, hour=0)
    assert value.matches_soc(74.9) and not value.matches_soc(75) and not value.matches_soc(float("nan"))
    assert value.intent(NOW, "UTC", SafetyLimits()).charge_ceiling_soc == 75


@pytest.mark.parametrize("bad", [{"enabled": "yes"}, {"soc": float("nan")}, {"priority": True},
                                  {"weekdays": ["thu", "thu"]}, {"action": "arbitrary"}, {"power_kw": float("inf")},
                                  {"start": "08:00", "end": "08:00"}, {"action": "export", "export_kw": None}])
def test_invalid_or_ambiguous_rules_are_rejected(bad):
    with pytest.raises((ValueError, TypeError)):
        Strategy.from_dict("r", rule(**bad))


def test_overlaps_choose_explicit_priority_but_equal_priority_is_an_error():
    values = {"a": rule(), "b": rule(name="Other", priority=60)}
    assert choose_strategy(values, NOW, "UTC", 50).identity == "b"
    values["b"]["priority"] = 50
    with pytest.raises(ValueError, match="priority"):
        choose_strategy(values, NOW, "UTC", 50)


def runner():
    controls, coordinator, appliance, store, clock, _ = runtime()
    coordinator.hass.config = SimpleNamespace(time_zone="UTC")
    coordinator.reading = lambda key: SimpleNamespace(value=coordinator.data.soc) if coordinator.data else None
    result = StrategyRunner(coordinator, clock=lambda: clock[0])
    result.preferences = {"strategy_control": {"enabled": True}, "strategy": {"r": rule(start="02:00")}}
    return result, controls, coordinator, appliance, store, clock


async def test_runner_dispatches_once_uses_native_soc_guard_and_releases_when_condition_fails():
    scheduler, controls, coordinator, appliance, store, _ = runner()
    await scheduler.tick()
    await controls._job
    assert appliance.manual["enable"] and float(appliance.levels["dischargeSOC"]) == 40
    assert store.value["active"]["context"]["strategy_id"].startswith("r:")
    writes = len([call for call in appliance.calls if call[0] != "GET"])
    await scheduler.tick()
    assert scheduler.state["state"] == "running"
    assert len([call for call in appliance.calls if call[0] != "GET"]) == writes
    coordinator.data = replace(coordinator.data, soc=39)
    await scheduler.tick()
    assert appliance.manual == {"enable": False} and store.value["active"] is None
    await controls.close()


async def test_manual_override_replaces_automation_but_a_late_rule_cannot_cancel_it():
    scheduler, controls, _, appliance, store, _ = runner()
    await scheduler.tick()
    await controls._job
    old = store.value["active"]["request_id"]
    await controls.submit(Intent(Mode.HOLD, request_id="owner"))
    await controls._job
    assert store.value["active"]["request_id"] == "owner"
    writes = len([call for call in appliance.calls if call[0] != "GET"])
    assert (await controls.release_automation(old))["phase"] == "not_owned"
    await scheduler.tick()
    assert scheduler.state["state"] == "manual_override"
    assert len([call for call in appliance.calls if call[0] != "GET"]) == writes
    await controls.close()


async def test_master_disabled_and_control_disabled_cannot_start_a_rule():
    scheduler, controls, _, appliance, _, _ = runner()
    scheduler.preferences["strategy_control"]["enabled"] = False
    await scheduler.tick()
    assert scheduler.state["state"] == "disabled" and not appliance.calls
    scheduler.preferences["strategy_control"]["enabled"] = True
    controls.enabled = False
    await scheduler.tick()
    assert not appliance.calls
    await controls.close()


async def test_two_tc_entries_cannot_both_write_the_same_plant_even_with_a_cached_session():
    scheduler, controls, coordinator, appliance, _, _ = runner()
    await controls._bind()
    coordinator.hass.config_entries=SimpleNamespace(async_entries=lambda domain:[SimpleNamespace(
        entry_id='other',disabled_by=None,options={'control':{'enabled':True},'cloud':{'station_id':'42','region':'eu'}})])
    appliance.calls.clear()
    await controls.submit(Intent(Mode.HOLD,request_id='conflicting-writer'))
    await controls._job
    assert controls.operation['phase']=='failed' and 'Another TC entry' in controls.operation['message']
    assert not any(call[0]!='GET' for call in appliance.calls)
    await controls.close()


async def test_cloud_outage_fresh_condition_revalidation_cannot_enable_solar_export_below_threshold():
    scheduler, controls, coordinator, appliance, _, _ = runner()
    coordinator.controller.limits = SafetyLimits(export_permitted=True)
    intent = Strategy.from_dict("r", rule(action="export", soc=75, export_kw=3)).intent(NOW, "UTC", coordinator.controller.limits)
    await controls.submit(intent)
    await controls._job
    assert controls.operation["phase"] == "failed" and not any(call[0] != "GET" for call in appliance.calls)
    await controls.close()
