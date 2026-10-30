"""Prove native client initialization stays off the HA event-loop thread."""

import ast
import asyncio
import sys
from pathlib import Path
from threading import get_ident
from types import SimpleNamespace


async def test_cloud_client_initialization_uses_executor_and_shared_session(monkeypatch):
    source = Path("custom_components/sigen_hybrid/cloud_client.py").read_text()
    tree = ast.parse(source)
    module = ast.Module(
        body=[n for n in tree.body if isinstance(n, (ast.Assign, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))],
        type_ignores=[],
    )
    session = object()
    calls = []
    loop_thread = get_ident()

    def client(username, password, **kwargs):
        calls.append((get_ident(), username, password, kwargs))
        return "client"

    async def executor(function, *args):
        return await asyncio.to_thread(function, *args)

    monkeypatch.setitem(sys.modules, "sigenergy_cloud", SimpleNamespace(SigenergyCloudClient=client))
    scope = {"async_get_clientsession": lambda hass: session, "__package__": "custom_components.sigen_hybrid"}
    exec(compile(module, "cloud_client.py", "exec"), scope)
    hass = SimpleNamespace(async_add_executor_job=executor, data={})
    credentials = {"username": " owner@example.invalid ", "password": "fake", "region": "eu"}
    result, duplicate = await asyncio.gather(
        scope["async_create_cloud_client"](hass, credentials), scope["async_create_cloud_client"](hass, credentials)
    )
    assert result is duplicate
    assert await scope["async_create_cloud_client"](hass, credentials) is result
    assert result.client == "client" and len(calls) == 1
    assert calls[0][0] != loop_thread
    assert calls[0][1:3] == ("owner@example.invalid", "fake")
    assert calls[0][3]["region"] == "eu"
    assert calls[0][3]["session"]._session is session
    assert calls[0][3]["session"]._context["client-server"] == "eu"
    assert calls[0][3]["session"]._context["lang"] == "en_US"


async def test_cloud_headers_do_not_mutate_shared_session_or_drop_authorization():
    source = Path("custom_components/sigen_hybrid/cloud_client.py").read_text()
    tree = ast.parse(source)
    module = ast.Module(body=[n for n in tree.body if isinstance(n, (ast.Assign, ast.ClassDef))], type_ignores=[])
    scope = {}
    exec(compile(module, "cloud_client.py", "exec"), scope)
    calls = []
    session = SimpleNamespace(
        headers={"User-Agent": "HA-shared"},
        post=lambda url, **kwargs: calls.append((url, kwargs)),
        request=lambda method, url, **kwargs: calls.append((url, kwargs)),
    )
    wrapper = scope["CloudSession"](session)
    headers = {"Authorization": "synthetic-token"}
    wrapper.post("https://example.invalid/auth", data={"synthetic": True})
    wrapper.request("GET", "https://example.invalid/station", headers=headers)
    assert all(c[1]["headers"]["User-Agent"] == scope["CLOUD_USER_AGENT"] for c in calls)
    assert calls[1][1]["headers"]["Authorization"] == "synthetic-token"
    assert headers == {"Authorization": "synthetic-token"}
    assert session.headers == {"User-Agent": "HA-shared"}
    wrapper.request("GET", "https://example.invalid/station", headers={"user-agent": "explicit"})
    assert calls[-1][1]["headers"] == {"user-agent": "explicit"}


def test_owner_context_preserves_explicit_headers_and_shared_defaults_without_credentials():
    source = Path("custom_components/sigen_hybrid/cloud_client.py").read_text()
    tree = ast.parse(source)
    module = ast.Module(body=[n for n in tree.body if isinstance(n, (ast.Assign, ast.ClassDef))], type_ignores=[])
    scope = {}
    exec(compile(module, "cloud_client.py", "exec"), scope)
    calls = []
    shared_headers = {"User-Agent": "HA-shared", "X-Shared": "preserved"}
    session = SimpleNamespace(
        headers=shared_headers, request=lambda method, url, **kwargs: calls.append((method, kwargs))
    )
    wrapper = scope["CloudSession"](session, region="eu")
    explicit = {"Authorization": "synthetic-token", "LANG": "explicit-language", "client-SERVER": "eu"}
    wrapper.request("GET", "https://example.invalid/device", headers=explicit)
    sent = calls[0][1]["headers"]
    assert sent["Authorization"] == "synthetic-token"
    assert sent["LANG"] == "explicit-language" and "lang" not in sent
    assert sent["client-SERVER"] == "eu" and "client-server" not in sent
    assert sent["AUTH-CLIENT-ID"] == "sigen" and sent["sg-platform"] == "web"
    assert sent["sg-app-version"] == sent["sg-v"] == "4.1.0"
    assert not {"sg-bui", "sg-session", "sg-log-id", "sg-ts", "Cookie", "Referer"} & sent.keys()
    assert explicit == {"Authorization": "synthetic-token", "LANG": "explicit-language", "client-SERVER": "eu"}
    assert shared_headers == {"User-Agent": "HA-shared", "X-Shared": "preserved"}
    import pytest

    with pytest.raises(ValueError):
        scope["CloudSession"](session, region="eu\r\nInjected: header")


async def test_owner_client_reuses_one_login_across_refreshes_and_entry_reload():
    from custom_components.sigen_hybrid.core.owner_devices import OwnerDeviceReads

    calls = []

    async def login():
        calls.append("login")
        await asyncio.sleep(0)

    async def close():
        calls.append("close_shared_wrapper")

    client = OwnerDeviceReads(SimpleNamespace(connect=login, close=close))
    await asyncio.gather(client.connect(), client.connect())
    await client.close()
    await client.connect()
    assert calls.count("login") == 1
