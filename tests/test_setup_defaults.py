"""Setup preferences must use real system caps and preserve source identities."""

from dataclasses import replace
from types import SimpleNamespace

import pytest
import voluptuous as vol
from test_control_session import setup
from test_owner_control_runtime import runtime
from test_wizard import wizard

from custom_components.sigen_hybrid.core.errors import SafetyError
from custom_components.sigen_hybrid.core.models import Intent, Mode, SafetyLimits, Source
from custom_components.sigen_hybrid.core.power import effective_power_limit


async def test_unit_id_is_a_number_box_and_fractional_ids_cannot_select_another_device():
    flow = wizard()
    form = await flow.async_step_local()
    field = next(k for k in form["data_schema"].schema if str(k) == "inverter_unit_id")
    assert form["data_schema"].schema[field].config["mode"] == "box"
    data = {"host": "synthetic.invalid", "port": 502, "sole_modbus_client": True, "inverter_unit_id": 2.5}
    assert (await flow.async_step_local(data))["errors"]["inverter_unit_id"] == "invalid_inverter_unit"
    data["inverter_unit_id"] = 2.0
    await flow.async_step_local(data)
    assert type(flow._pending_data["inverter_unit_id"]) is int and flow._pending_data["inverter_unit_id"] == 2


async def test_new_setup_follows_plant_power_without_asking_for_arbitrary_kw():
    flow = wizard()
    flow._pending_options, flow._pending_data = {}, {"inverter_unit_id": 2}
    form = await flow.async_step_wizard_control()
    data = form["data_schema"]({})
    assert data["use_plant_power_limits"] is True
    assert not {"max_charge_kw", "max_discharge_kw"} & set(data)
    assert (await flow.async_step_wizard_control(data))["step_id"] == "dashboard"
    assert flow._pending_options["safety"]["max_charge_kw"] is None
    assert flow._pending_options["safety"]["max_discharge_kw"] is None
    assert flow._pending_options["control"]["local_enabled"] is True


async def test_custom_caps_are_an_explicit_followup_and_are_not_prefilled_with_three_kw():
    flow = wizard()
    flow._pending_options, flow._pending_data = {}, {}
    form = await flow.async_step_wizard_control()
    data = form["data_schema"]({"use_plant_power_limits": False})
    custom = await flow.async_step_wizard_control(data)
    assert custom["step_id"] == "wizard_power_limits"
    with pytest.raises(vol.Invalid):
        custom["data_schema"]({})
    result = await flow.async_step_wizard_power_limits({"max_charge_kw": 2, "max_discharge_kw": 4})
    assert result["step_id"] == "dashboard" and flow._pending_options["safety"]["max_discharge_kw"] == 4


async def test_existing_custom_limits_are_kept_until_owner_selects_automatic():
    flow = wizard(options=True)
    flow.config_entry = SimpleNamespace(data={}, options={"safety": {"max_charge_kw": 2, "max_discharge_kw": 3}})
    form = await flow.async_step_safety()
    data = form["data_schema"]({})
    assert data["use_plant_power_limits"] is False
    custom = await flow.async_step_safety(data)
    assert custom["step_id"] == "power_limits"
    assert custom["data_schema"]({}) == {"max_charge_kw": 2, "max_discharge_kw": 3}
    data["use_plant_power_limits"] = True
    saved = await flow.async_step_safety(data)
    assert saved["data"]["safety"]["max_charge_kw"] is None
    assert saved["data"]["control"]["enabled"] is False


def forecasts(flow):
    scope = flow.async_step_features.__func__.__globals__ if hasattr(flow, "async_step_features") else flow.async_step_forecast.__func__.__globals__
    scope["PROVIDERS"] = {key: {"name": key} for key in ("forecast_solar", "open_meteo_solar_forecast", "solcast")}
    scope["provider_entries"] = lambda hass, provider: [SimpleNamespace(entry_id=provider+"-entry", title="Same complete PV array")]
    return ["forecast_solar:forecast_solar-entry", "open_meteo_solar_forecast:open_meteo_solar_forecast-entry"]


async def test_initial_wizard_selects_both_forecasts_and_averaging_in_one_step():
    flow = wizard()
    await flow.async_step_demo()
    sources = forecasts(flow)
    form = await flow.async_step_features()
    data = form["data_schema"]({"forecast_sources": sources, "average": True})
    assert (await flow.async_step_features(data))["step_id"] == "dashboard"
    config = flow._pending_options["forecast"]
    assert config["average"] is True and config["provider"] == "ensemble"
    assert [row["provider"] for row in config["sources"]] == ["forecast_solar", "open_meteo_solar_forecast"]
    assert config["primary_source"] == sources[0]


async def test_options_forecast_uses_the_same_ensemble_and_checks_selection():
    flow = wizard(options=True)
    flow.config_entry = SimpleNamespace(options={"cloud": {"saved": True}})
    sources = forecasts(flow)
    saved = await flow.async_step_forecast({"forecast_sources": sources, "average": True, "primary_source": sources[1]})
    assert saved["data"]["forecast"]["primary_source"] == sources[1] and saved["data"]["cloud"] == {"saved": True}
    for invalid in [sources+["solcast:solcast-entry"], sources+sources[:1], ["forecast_solar:unloaded-entry"]]:
        result = await flow.async_step_forecast({"forecast_sources": invalid, "average": True})
        assert result["errors"]["forecast_sources"] == "invalid_forecast_source"


def test_automatic_limits_follow_changed_device_caps_and_custom_caps_only_tighten():
    clock, _, _, _, _, controller, snapshot = setup()
    controller.limits = SafetyLimits(max_charge_kw=None, max_discharge_kw=None)
    assert controller.preview(Intent(Mode.CHARGE, power_kw=4), snapshot, clock[0])
    with pytest.raises(SafetyError, match="exceeds"):
        controller.preview(Intent(Mode.CHARGE, power_kw=4), replace(snapshot, max_charge_kw=2), clock[0])
    assert effective_power_limit(3, 5) == 3 and effective_power_limit(None, 5) == 5
    for unavailable in (None, 0, float("nan"), 4294967.295):
        with pytest.raises(SafetyError):
            effective_power_limit(None, unavailable)


async def test_strategy_without_custom_power_uses_fresh_plant_default():
    controls, coordinator, appliance, _, _, _ = runtime()
    coordinator.controller.limits = SafetyLimits(max_charge_kw=None, max_discharge_kw=None)
    await controls.submit(Intent(Mode.CHARGE, source=Source.AUTOMATION, power_kw=None, request_id="automatic-plant-limit"))
    await controls._job
    assert controls.operation["phase"] == "confirmed"
    assert float(appliance.manual["powerLimitation"]) == coordinator.data.max_charge_kw
    await controls.cancel()
    await controls._job
    assert controls.operation["phase"] == "restored"
    await controls.close()
