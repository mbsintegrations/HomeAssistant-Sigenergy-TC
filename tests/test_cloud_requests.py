"""Actual request gateway with fake time and transport: no provider traffic."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from custom_components.sigen_hybrid.core.cloud_requests import CloudRequestGate, SerialCloudTransport
from custom_components.sigen_hybrid.core.errors import TransportError


class Clock:
    value = 1000.0

    def __call__(self):
        return self.value

    async def sleep(self, seconds):
        self.value += seconds
        await asyncio.sleep(0)


class Reply:
    def __init__(self, status=200, body=None, headers=None):
        self.status, self.body, self.headers = status, body or {"code": 0, "data": {}}, headers or {}

    async def text(self):
        return json.dumps(self.body)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


class Session:
    def __init__(self, clock, reply=None):
        self.clock, self.reply, self.calls = clock, reply or Reply(), []

    def request(self, method, url, **kwargs):
        self.calls.append((self.clock(), method, url, kwargs))
        return self.reply


async def consume(gate, session, method="GET", url="https://synthetic.invalid/device"):
    async with gate.request(session, method, url) as response:
        return await response.text()


async def test_concurrent_history_and_telemetry_are_serialised_and_paced():
    clock = Clock()
    gate = CloudRequestGate(clock=clock, sleep=clock.sleep)
    session = Session(clock)
    await asyncio.gather(
        *(
            consume(gate, session, url=f"https://synthetic.invalid/{kind}")
            for kind in ("flow", "history", "battery", "mode")
        )
    )
    assert [call[0] for call in session.calls] == [1000, 1006, 1012, 1018]
    assert gate.status["requests"] == 4
    assert all(call[3]["timeout"] == 25 for call in session.calls)


@pytest.mark.parametrize(
    "reply,reason",
    [
        (Reply(429, headers={"Retry-After": "1800"}), "rate_limited"),
        (Reply(body={"code": 429, "msg": "PRIVATE"}), "rate_limited"),
        (Reply(body={"code": 500, "msg": "Too many users"}), "session_conflict"),
        (Reply(401), "authentication_required"),
        (Reply(503), "unavailable"),
    ],
)
async def test_account_cooldown_blocks_all_endpoints_and_auth_without_retry(reply, reason):
    clock = Clock()
    gate = CloudRequestGate(clock=clock, sleep=clock.sleep)
    session = Session(clock, reply)
    with pytest.raises(TransportError) as error:
        await consume(gate, session)
    assert "PRIVATE" not in str(error.value) and gate.status["reason"] == reason
    for method, url in [
        ("GET", "https://synthetic.invalid/history"),
        ("GET", "https://synthetic.invalid/battery"),
        ("POST", "https://synthetic.invalid/auth/oauth/token"),
    ]:
        with pytest.raises(TransportError):
            await consume(gate, session, method, url)
    assert len(session.calls) == 1
    if reply.headers:
        assert gate.status["cooldown_seconds"] >= 1800


async def test_repeated_throttles_back_off_and_success_recovers_without_queue_replay():
    clock = Clock()
    gate = CloudRequestGate(clock=clock, sleep=clock.sleep)
    session = Session(clock, Reply(429))
    with pytest.raises(TransportError):
        await consume(gate, session)
    clock.value += 900
    with pytest.raises(TransportError):
        await consume(gate, session)
    assert gate.status["cooldown_seconds"] == 1800 and len(session.calls) == 2
    clock.value += 1800
    session.reply = Reply()
    assert await consume(gate, session)
    assert gate.status["reason"] is None and len(session.calls) == 3


async def test_transport_serialises_expired_token_checks_before_the_second_read():
    refreshed = False
    refreshes = 0
    calls = []

    async def data(*args, **kwargs):
        nonlocal refreshed, refreshes
        if not refreshed:
            refreshes += 1
            await asyncio.sleep(0)
            refreshed = True
        calls.append(args)
        return {"ok": True}

    transport = SerialCloudTransport(SimpleNamespace(data=data, envelope=data))
    await asyncio.gather(transport.data("history"), transport.envelope("flow"))
    assert refreshes == 1 and len(calls) == 2


async def test_explicit_credential_repair_unblocks_auth_but_preserves_request_spacing():
    clock = Clock()
    gate = CloudRequestGate(clock=clock, sleep=clock.sleep)
    session = Session(clock, Reply(401))
    with pytest.raises(TransportError):
        await consume(gate, session)
    gate.resume_authentication()
    session.reply = Reply()
    await consume(gate, session, "POST", "https://synthetic.invalid/auth/oauth/token")
    assert [call[0] for call in session.calls] == [1000, 1006]
    assert not gate.auth_blocked and gate.status["reason"] is None


@pytest.mark.parametrize("reason", ["rate_limited", "session_conflict", "unavailable"])
async def test_credential_repair_never_bypasses_non_authentication_cooldowns(reason):
    clock = Clock()
    gate = CloudRequestGate(clock=clock, sleep=clock.sleep)
    gate.pause(reason)
    original = gate.status.copy()
    gate.resume_authentication()
    assert gate.status == original
    session = Session(clock)
    with pytest.raises(TransportError):
        await consume(gate, session, "POST", "https://synthetic.invalid/auth/oauth/token")
    assert not session.calls
