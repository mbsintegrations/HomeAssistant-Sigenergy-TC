"""Execute the actual reauth methods without sending credentials to a provider."""

import ast
import copy
from pathlib import Path
from types import SimpleNamespace

import pytest
import voluptuous as vol

from custom_components.sigen_hybrid.core.errors import AuthenticationError, CloudLoginFailure, TransportError


def flow_fixture(login):
    tree = ast.parse(Path("custom_components/sigen_hybrid/config_flow.py").read_text(encoding="utf-8"))
    flow = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "ConfigFlow")
    methods = [
        node
        for node in flow.body
        if isinstance(node, ast.AsyncFunctionDef) and node.name in {"async_step_reauth", "async_step_reauth_confirm"}
    ]
    credentials = next(
        node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "cloud_credentials"
    )
    wrapper = ast.ClassDef(name="ReauthFlow", bases=[], keywords=[], body=methods, decorator_list=[], type_params=[])
    scope = {
        "vol": vol,
        "async_cloud_login": login,
        "CloudLoginFailure": CloudLoginFailure,
        "AuthenticationError": AuthenticationError,
        "TransportError": TransportError,
        "selector": SimpleNamespace(
            TextSelector=lambda config: str,
            TextSelectorConfig=lambda **kwargs: kwargs,
            TextSelectorType=SimpleNamespace(PASSWORD="password"),
        ),
    }
    exec(
        compile(
            ast.fix_missing_locations(ast.Module(body=[credentials, wrapper], type_ignores=[])),
            "config_flow.py",
            "exec",
        ),
        scope,
    )
    instance = scope["ReauthFlow"]()
    entry = SimpleNamespace(
        entry_id="preserved-entry",
        unique_id="preserved-identity",
        options={
            "cloud": {
                "username": "owner@example.invalid",
                "password": "old-fixture-password",
                "region": "eu",
                "station_id": "42",
                "unofficial_opt_in": True,
            },
            "forecast": {"provider": "existing"},
            "safety": {"reserve_soc": 30},
            "control": {"enabled": True},
        },
    )
    instance._get_reauth_entry = lambda: entry
    instance.hass = object()
    instance.async_show_form = lambda **kwargs: {"type": "form", **kwargs}
    instance.async_abort = lambda **kwargs: {"type": "abort", **kwargs}
    instance.async_update_reload_and_abort = lambda target, **kwargs: {"type": "updated", "target": target, **kwargs}
    return instance, entry


async def test_successful_reauth_preserves_plant_identity_and_all_other_options():
    calls = []

    async def login(hass, credentials, **kwargs):
        calls.append((credentials, kwargs))
        return "42"

    flow, entry = flow_fixture(login)
    before = copy.deepcopy(entry.options)
    result = await flow.async_step_reauth_confirm({"password": "new-fixture-password"})
    assert result["type"] == "updated" and result["target"] is entry
    assert result["options"] == {**before, "cloud": {**before["cloud"], "password": "new-fixture-password"}}
    assert calls[0][1] == {"reauthenticate": True}
    assert entry.entry_id == "preserved-entry" and entry.unique_id == "preserved-identity"
    assert entry.options == before  # Actual mutation is delegated to HA's native helper.


async def test_different_station_is_rejected_without_retargeting_the_existing_entry():
    async def login(*args, **kwargs):
        return "999"

    flow, entry = flow_fixture(login)
    before = copy.deepcopy(entry.options)
    result = await flow.async_step_reauth_confirm({"password": "new-fixture-password"})
    assert result["type"] == "form" and result["errors"] == {"base": "wrong_account"}
    assert entry.options == before


@pytest.mark.parametrize(
    "error,reason",
    [
        (CloudLoginFailure("invalid_auth"), "invalid_auth"),
        (AuthenticationError("synthetic"), "invalid_auth"),
        (TransportError("synthetic"), "cannot_connect"),
    ],
)
async def test_auth_and_network_failures_have_different_safe_form_errors(error, reason):
    async def login(*args, **kwargs):
        raise error

    flow, entry = flow_fixture(login)
    result = await flow.async_step_reauth_confirm({"password": "fixture-password"})
    assert result["errors"] == {"base": reason}
    assert entry.options["cloud"]["password"] == "old-fixture-password"


async def test_reauth_form_never_prefills_the_stored_password():
    flow, entry = flow_fixture(None)
    result = await flow.async_step_reauth({})
    assert result["step_id"] == "reauth_confirm"
    key = next(iter(result["data_schema"].schema))
    assert key.default is vol.UNDEFINED
    assert "old-fixture-password" not in str(result)


async def test_removed_cloud_account_aborts_without_a_login_request():
    flow, entry = flow_fixture(None)
    entry.options = {}
    assert await flow.async_step_reauth_confirm() == {"type": "abort", "reason": "cloud_not_configured"}
