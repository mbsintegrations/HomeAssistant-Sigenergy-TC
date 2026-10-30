"""Exercise real wizard methods with minimal HA form doubles, not a HA runtime."""

import ast
from pathlib import Path
from types import SimpleNamespace

import pytest
import voluptuous as vol

from custom_components.sigen_hybrid.core.connections import enabled_connections
from custom_components.sigen_hybrid.core.errors import AuthenticationError, CloudLoginFailure, TransportError
from custom_components.sigen_hybrid.core.models import SafetyLimits


class FlowDouble:
    def __init_subclass__(cls, **kwargs):
        pass

    async def async_set_unique_id(self, value):
        self.unique_id = value

    def _abort_if_unique_id_configured(self):
        pass

    def async_show_form(self, **kwargs):
        return {"type": "form", **kwargs}

    def async_create_entry(self, **kwargs):
        return {"type": "create_entry", **kwargs}


class SelectorDouble:
    TextSelectorType = SimpleNamespace(PASSWORD="password")

    def __getattr__(self, name):
        return lambda *args, **kwargs: args[0] if args else kwargs


async def discovered_station(hass, credentials):
    return "discovered-station"


def wizard(login=discovered_station, *, options=False):
    source = Path("custom_components/sigen_hybrid/config_flow.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    target = next(
        node
        for node in tree.body
        if isinstance(node, ast.ClassDef) and node.name == ("OptionsFlow" if options else "ConfigFlow")
    )
    helpers = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name in ("cloud_credentials", "owner_limits_schema")
    ]
    module = ast.Module(body=[*helpers, target], type_ignores=[])
    scope = {
        "config_entries": SimpleNamespace(ConfigFlow=FlowDouble, OptionsFlow=FlowDouble),
        "async_cloud_login": login,
        "enabled_connections": enabled_connections,
        "AuthenticationError": AuthenticationError,
        "TransportError": TransportError,
        "CloudLoginFailure": CloudLoginFailure,
        "SafetyLimits": SafetyLimits,
        "DOMAIN": "sigen_hybrid",
        "vol": vol,
        "selector": SelectorDouble(),
        "provider_entries": lambda hass, provider: [],
        "PROVIDERS": {
            "solcast": {
                "name": "Solcast",
                "install": "Install the provider first",
                "url": "https://example.invalid/provider",
            }
        },
    }
    exec(compile(module, "config_flow.py", "exec"), scope)
    flow = scope["OptionsFlow" if options else "ConfigFlow"]()
    flow.hass = SimpleNamespace()
    return flow


@pytest.mark.asyncio
async def test_cloud_only_setup_never_requests_modbus():
    flow = wizard()
    assert (await flow.async_step_connections({"modbus": False, "cloud": False, "api": False}))["errors"][
        "base"
    ] == "connection_required"
    assert (await flow.async_step_connections({"modbus": False, "cloud": True}))["step_id"] == "features"
    result = await flow.async_step_features({"forecast_provider": "none", "optimizer_monitoring": False})
    assert result["step_id"] == "wizard_cloud"
    assert "host" not in flow._pending_data
    assert flow._pending_options["connections"] == {"modbus": False, "cloud": True}


async def test_additional_read_only_modbus_setup_keeps_cloud_and_saves_one_atomic_entry_update():
    flow = wizard(options=True)
    flow.config_entry = SimpleNamespace(data={"cloud_only": True}, options={"cloud": {"username": "synthetic"}})
    updates = []
    flow.hass.config_entries = SimpleNamespace(async_update_entry=lambda entry, **kwargs: updates.append(kwargs))
    result = await flow.async_step_modbus(
        {
            "host": "synthetic.invalid",
            "port": 502,
            "sole_modbus_client": False,
            "shared_read_only": True,
            "poll_seconds": 60,
        }
    )
    assert result["type"] == "create_entry" and len(updates) == 1
    assert updates[0]["data"]["shared_read_only"] is True
    assert updates[0]["options"]["connections"] == {"modbus": True, "cloud": True}
    assert result["data"] == updates[0]["options"]


@pytest.mark.asyncio
async def test_options_disable_source_without_deleting_credentials_or_changing_other_sources():
    flow = wizard(options=True)
    flow.config_entry = SimpleNamespace(
        data={"host": "synthetic.invalid"},
        options={"cloud": {"username": "synthetic"}, "api": {"app_key": "synthetic"}},
    )
    result = await flow.async_step_connections({"modbus": True, "cloud": False})
    assert result["data"]["cloud"] == {"username": "synthetic"}
    assert result["data"]["connections"] == {"modbus": True, "cloud": False}
    assert (await flow.async_step_connections({"modbus": False, "cloud": False, "api": False}))["errors"][
        "base"
    ] == "connection_required"


@pytest.mark.asyncio
async def test_demo_wizard_creates_only_after_review_and_excludes_cloud():
    flow = wizard()
    first = await flow.async_step_demo()
    assert first["step_id"] == "features"
    step = await flow.async_step_features(
        {"forecast_provider": "none", "optimizer_monitoring": True, "cloud_reads": True}
    )
    assert step["step_id"] == "dashboard"
    review = await flow.async_step_dashboard({"preset": "flow", "appearance": "auto", "charts": ["power"]})
    assert review["step_id"] == "review" and review["description_placeholders"]["cloud"] == "Disabled"
    result = await flow.async_step_review({})
    assert result["data"] == {"demo": True}
    assert result["options"]["dashboard"]["preset"] == "flow"
    assert "cloud" not in result["options"]


@pytest.mark.asyncio
async def test_missing_forecast_keeps_wizard_open_with_install_help_and_can_skip():
    flow = wizard()
    await flow.async_step_demo()
    result = await flow.async_step_features({"forecast_provider": "solcast", "optimizer_monitoring": False})
    assert result["errors"] == {"forecast_provider": "forecast_provider_missing"}
    assert "Installation guide" in result["description_placeholders"]["instructions"]
    result = await flow.async_step_features({"forecast_provider": "none", "optimizer_monitoring": False})
    assert result["step_id"] == "dashboard"


@pytest.mark.asyncio
async def test_optional_cloud_can_be_skipped_and_requires_opt_in_when_enabled():
    flow = wizard()
    await flow.async_step_local({"host": "synthetic.invalid", "port": 502, "sole_modbus_client": True})
    step = await flow.async_step_features(
        {"forecast_provider": "none", "optimizer_monitoring": False, "cloud_reads": True}
    )
    assert step["step_id"] == "wizard_cloud"
    denied = await flow.async_step_wizard_cloud({"enable": True, "unofficial_opt_in": False})
    assert denied["errors"]["base"] == "cloud_opt_in_required"
    missing = await flow.async_step_wizard_cloud({"enable": True, "unofficial_opt_in": True})
    assert missing["errors"]["base"] == "cloud_fields_required"
    skipped = await flow.async_step_wizard_cloud({"enable": False})
    assert skipped["step_id"] == "dashboard" and "cloud" not in flow._pending_options


@pytest.mark.asyncio
async def test_review_never_echoes_cloud_credentials():
    flow = wizard()
    await flow.async_step_local({"host": "synthetic.invalid", "port": 502, "sole_modbus_client": True})
    await flow.async_step_features({"forecast_provider": "none", "optimizer_monitoring": False, "cloud_reads": True})
    await flow.async_step_wizard_cloud(
        {
            "enable": True,
            "region": "eu",
            "username": "synthetic@example.invalid",
            "password": "synthetic-secret",
            "unofficial_opt_in": True,
        }
    )
    result = await flow.async_step_dashboard({"preset": "overview", "appearance": "night", "charts": []})
    assert "synthetic-secret" not in str(result)
    assert "synthetic@example.invalid" not in str(result)
    assert flow._pending_options["cloud"]["station_id"] == "discovered-station"


@pytest.mark.asyncio
async def test_cloud_only_setup_has_no_local_host_or_hardware_probe():
    flow = wizard()
    await flow.async_step_cloud_only()
    assert flow._pending_data == {"demo": False, "cloud_only": True}
    result = await flow.async_step_features(
        {"forecast_provider": "none", "optimizer_monitoring": False, "cloud_reads": True}
    )
    assert result["step_id"] == "wizard_cloud"
    assert "host" not in flow._pending_data


@pytest.mark.asyncio
async def test_cloud_form_requires_no_station_id_and_stores_discovered_identity():
    flow = wizard()
    await flow.async_step_cloud_only()
    form = await flow.async_step_wizard_cloud()
    fields = {str(key) for key in form["data_schema"].schema}
    assert "station_id" not in fields
    result = await flow.async_step_wizard_cloud(
        {
            "enable": True,
            "region": "eu",
            "username": "owner@example.invalid",
            "password": "fake",
            "unofficial_opt_in": True,
        }
    )
    assert result["step_id"] == "wizard_control"
    assert flow._pending_options["cloud"]["station_id"] == "discovered-station"


async def test_new_cloud_setup_explicitly_confirms_control_and_keeps_export_approval_off():
    flow = wizard()
    flow._pending_options = {"cloud": {"station_id": "synthetic"}}
    form = await flow.async_step_wizard_control()
    chosen = form["data_schema"]({})
    assert chosen["enable_control"] is True and chosen["export_permitted"] is False
    result = await flow.async_step_wizard_control(chosen)
    assert result["step_id"] == "dashboard"
    assert flow._pending_options["control"] == {"enabled": True}
    assert "enable_control" not in flow._pending_options["safety"]


async def test_changing_legacy_safety_limits_does_not_silently_enable_control():
    flow = wizard(options=True)
    flow.config_entry = SimpleNamespace(options={"safety": {"export_permitted": False}, "cloud": {"saved": True}})
    form = await flow.async_step_safety()
    chosen = form["data_schema"]({})
    assert chosen["enable_control"] is False
    result = await flow.async_step_safety(chosen)
    assert result["data"]["control"] == {"enabled": False}
    assert result["data"]["cloud"] == {"saved": True}


@pytest.mark.asyncio
@pytest.mark.parametrize("error,key", [(AuthenticationError, "invalid_auth"), (TransportError, "cannot_connect")])
async def test_cloud_login_error_does_not_save_credentials_or_echo_response(error, key):
    async def fail(hass, credentials):
        raise error("PRIVATE RESPONSE")

    flow = wizard(fail)
    await flow.async_step_cloud_only()
    result = await flow.async_step_wizard_cloud(
        {
            "enable": True,
            "region": "eu",
            "username": "owner@example.invalid",
            "password": "private",
            "unofficial_opt_in": True,
        }
    )
    assert result["step_id"] == "wizard_cloud" and result["errors"] == {"base": key}
    assert "cloud" not in flow._pending_options
    assert "PRIVATE RESPONSE" not in str(result) and "private" not in str(result)


@pytest.mark.asyncio
async def test_cloud_options_discovers_identity_without_manual_id():
    flow = wizard(options=True)
    flow.config_entry = SimpleNamespace(data={"cloud_only": True}, options={"dashboard": {"preset": "flow"}})
    form = await flow.async_step_cloud()
    assert "station_id" not in {str(key) for key in form["data_schema"].schema}
    result = await flow.async_step_cloud(
        {"region": "eu", "username": "owner@example.invalid", "password": "fake", "unofficial_opt_in": True}
    )
    assert result["type"] == "create_entry"
    assert result["data"]["cloud"]["station_id"] == "discovered-station"
    assert result["data"]["dashboard"]["preset"] == "flow"


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["invalid_auth", "cannot_connect", "no_cloud_plant", "cloud_login_failed"])
async def test_cloud_form_preserves_specific_safe_failure_reason(reason):
    async def fail(hass, credentials):
        raise CloudLoginFailure(reason)

    flow = wizard(fail)
    await flow.async_step_cloud_only()
    result = await flow.async_step_wizard_cloud(
        {
            "enable": True,
            "region": "eu",
            "username": "owner@example.invalid",
            "password": "fake",
            "unofficial_opt_in": True,
        }
    )
    assert result["errors"] == {"base": reason}
    assert "cloud" not in flow._pending_options


@pytest.mark.asyncio
async def test_dashboard_wizard_offers_photo_display_independently_of_layout():
    flow = wizard()
    await flow.async_step_demo()
    await flow.async_step_features({"forecast_provider": "none", "optimizer_monitoring": False})
    form = await flow.async_step_dashboard()
    field = next(key for key in form["data_schema"].schema if str(key) == "main_display")
    assert field.default() == "photo"
    assert form["data_schema"].schema[field]["options"] == [
        {"value": "house", "label": "House"},
        {"value": "flow", "label": "Flow"},
        {"value": "photo", "label": "Photo house"},
    ]
    await flow.async_step_dashboard(
        {"preset": "overview", "main_display": "photo", "appearance": "auto", "charts": ["power"]}
    )
    result = await flow.async_step_review({})
    assert result["options"]["dashboard"] == {
        "preset": "overview",
        "main_display": "photo",
        "appearance": "auto",
        "charts": ["power"],
    }


@pytest.mark.asyncio
async def test_dashboard_options_keep_photo_default_and_unrelated_options():
    flow = wizard(options=True)
    flow.config_entry = SimpleNamespace(
        options={
            "dashboard": {"preset": "overview", "main_display": "photo"},
            "forecast": {"provider": "forecast_solar"},
        }
    )
    form = await flow.async_step_dashboard()
    field = next(key for key in form["data_schema"].schema if str(key) == "main_display")
    assert field.default() == "photo"
    result = await flow.async_step_dashboard({"preset": "overview", "main_display": "flow", "charts": []})
    assert result["data"]["dashboard"]["main_display"] == "flow"
    assert result["data"]["forecast"] == {"provider": "forecast_solar"}
    flow.config_entry.options["dashboard"].pop("main_display")
    legacy = await flow.async_step_dashboard()
    field = next(key for key in legacy["data_schema"].schema if str(key) == "main_display")
    assert field.default() == "photo"
