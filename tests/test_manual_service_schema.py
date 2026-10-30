"""Exercise the registered HA service schema without importing HA's runtime."""

import ast
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace

import pytest
import voluptuous as vol

from custom_components.sigen_hybrid.core.errors import SigenError
from custom_components.sigen_hybrid.core.models import (
    Intent,
    Mode,
    Source,
    validate_duration_minutes,
    validate_manual_power,
)


async def manual_schema(*, capture=False):
    tree = ast.parse(Path("custom_components/sigen_hybrid/__init__.py").read_text())
    setup = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "async_setup")
    registered = {}
    callbacks = {}

    async def frontend(hass):
        pass

    def register(domain, name, function, **kwargs):
        assert domain == "sigen_hybrid"
        registered[name] = kwargs["schema"]
        callbacks[name] = function

    scope = {
        "DOMAIN": "sigen_hybrid",
        "Mode": Mode,
        "vol": vol,
        "validate_duration_minutes": validate_duration_minutes,
        "validate_manual_power": validate_manual_power,
        "ConfigEntryState": SimpleNamespace(LOADED="loaded"),
        "HomeAssistantError": RuntimeError,
        "Intent": Intent,
        "Source": Source,
        "SigenError": SigenError,
        "asdict": asdict,
        "async_register_frontend": frontend,
        "SupportsResponse": SimpleNamespace(OPTIONAL="optional", ONLY="only"),
        "async_register_history": lambda hass: None,
        "async_register_forecast": lambda hass: None,
        "async_register_owner_configuration": lambda hass: None,
        "SETTINGS": __import__("custom_components.sigen_hybrid.core.owner_settings", fromlist=["SETTINGS"]).SETTINGS,
    }
    exec(compile(ast.Module(body=[setup], type_ignores=[]), "__init__.py", "exec"), scope)
    hass = SimpleNamespace(services=SimpleNamespace(async_register=register))
    from test_control_session import NOW

    scope["utcnow"] = lambda: NOW
    assert await scope["async_setup"](hass, {})
    return (hass, registered, callbacks) if capture else registered["manual_control"]


@pytest.mark.parametrize("duration", [180, 1440])
async def test_native_manual_service_accepts_custom_duration_and_keeps_default_preview(duration):
    schema = await manual_schema()
    result = schema({"config_entry": "synthetic", "mode": "hold", "duration_minutes": duration})
    assert result["duration_minutes"] == duration and result["dry_run"] is True
    assert schema({"config_entry": "synthetic", "mode": "hold"})["duration_minutes"] == 30


@pytest.mark.parametrize("duration", [1441, 0, 30.9, 1440.0, True, False, float("nan"), float("inf"), "1440"])
async def test_service_does_not_truncate_or_coerce_invalid_duration(duration):
    schema = await manual_schema()
    with pytest.raises(vol.Invalid):
        schema({"config_entry": "synthetic", "mode": "hold", "duration_minutes": duration})


@pytest.mark.parametrize("power", [True, False, float("nan"), float("inf"), 0, -1, 101])
async def test_service_rejects_invalid_power_before_any_control_job(power):
    schema = await manual_schema()
    with pytest.raises(vol.Invalid):
        schema({"config_entry": "synthetic", "mode": "charge", "power_kw": power})


async def test_registered_service_denies_non_admin_writes_before_any_plant_request():
    from test_owner_control_runtime import runtime

    controls, coordinator, appliance, _, _, _ = runtime()
    hass, schemas, callbacks = await manual_schema(capture=True)

    async def user(_user_id):
        return SimpleNamespace(is_admin=False)

    hass.auth = SimpleNamespace(async_get_user=user)
    hass.config_entries = SimpleNamespace(
        async_get_entry=lambda _: SimpleNamespace(domain="sigen_hybrid", state="loaded", runtime_data=coordinator)
    )
    call = SimpleNamespace(
        data=schemas["manual_control"]({"config_entry": "synthetic", "mode": "hold", "dry_run": False}),
        context=SimpleNamespace(user_id="ordinary-user"),
    )
    with pytest.raises(RuntimeError, match="administrator"):
        await callbacks["manual_control"](call)
    assert not appliance.calls and controls._job is None


async def test_registered_automation_service_uses_lower_priority_and_executes_the_real_job_path():
    from test_owner_control_runtime import runtime

    controls, coordinator, appliance, _, _, _ = runtime()
    hass, schemas, callbacks = await manual_schema(capture=True)
    hass.config_entries = SimpleNamespace(
        async_get_entry=lambda _: SimpleNamespace(domain="sigen_hybrid", state="loaded", runtime_data=coordinator)
    )
    call = SimpleNamespace(
        data=schemas["manual_control"]({"config_entry": "synthetic", "mode": "hold", "dry_run": False}),
        context=SimpleNamespace(user_id=None),
    )
    response = await callbacks["manual_control"](call)
    assert response["phase"] == "queued" and controls._intent.source == Source.AUTOMATION
    await controls._job
    assert controls.operation["phase"] == "confirmed" and appliance.manual["enable"] is True
    await controls.close()


async def test_owner_setting_service_defaults_to_preview_and_has_a_closed_setting_allowlist():
    _, schemas, _ = await manual_schema(capture=True)
    schema = schemas["owner_setting"]
    value = {"config_entry": "synthetic", "setting": "grid_connection", "value": False, "request_id": "preview"}
    assert schema(value)["dry_run"] is True
    with pytest.raises(vol.Invalid):
        schema({**value, "setting": "grid_code"})
    with pytest.raises(vol.Invalid):
        schema({**value, "endpoint": "arbitrary"})


async def test_owner_setting_service_checks_admin_before_queueing_any_job():
    from test_owner_control_runtime import runtime

    controls, coordinator, appliance, _, _, _ = runtime()
    hass, schemas, callbacks = await manual_schema(capture=True)

    async def user(_user_id):
        return SimpleNamespace(is_admin=False)

    hass.auth = SimpleNamespace(async_get_user=user)
    hass.config_entries = SimpleNamespace(
        async_get_entry=lambda _: SimpleNamespace(domain="sigen_hybrid", state="loaded", runtime_data=coordinator)
    )
    call = SimpleNamespace(data=schemas["owner_setting"]({
        "config_entry": "synthetic", "setting": "grid_connection", "value": False,
        "request_id": "admin", "dry_run": False,
    }), context=SimpleNamespace(user_id="ordinary-user"))
    with pytest.raises(RuntimeError, match="administrator"):
        await callbacks["owner_setting"](call)
    assert not appliance.calls and controls._job is None
