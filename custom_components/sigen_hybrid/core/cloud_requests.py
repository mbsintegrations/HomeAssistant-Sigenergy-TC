"""Account-wide Cloud pacing and cooldown, including history and token requests."""

import asyncio
import json
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from math import isfinite

from .errors import TransportError


class CloudRequestGate:
    """A conservative client budget, not a claim about Sigenergy's quota."""

    def __init__(self, *, clock=time.monotonic, sleep=asyncio.sleep, spacing=6):
        self.clock, self.sleep, self.spacing = clock, sleep, spacing
        self._lock = asyncio.Lock()
        self._last = float("-inf")
        self._until = float("-inf")
        self._failures = 0
        self.reason = None
        self.requests = 0
        self.auth_blocked = False

    @property
    def status(self):
        return {
            "cooldown_seconds": round(max(0, self._until - self.clock())),
            "reason": self.reason if self.clock() < self._until or self.auth_blocked else None,
            "requests": self.requests,
            "minimum_spacing_seconds": self.spacing,
        }

    def pause(self, reason, *, retry_after=0):
        self._failures = min(self._failures + 1, 8)
        base = (
            900
            if reason in ("rate_limited", "session_conflict")
            else 300
            if reason == "authentication_required"
            else 60
        )
        duration = max(float(retry_after), min(3600, base * 2 ** (self._failures - 1)))
        self._until = max(self._until, self.clock() + duration)
        self.reason = reason
        self.auth_blocked |= reason == "authentication_required"

    def resume_authentication(self):
        """One explicit credential repair may retry auth, preserving other cooldowns."""
        self.auth_blocked = False
        if self.reason == "authentication_required":
            self.reason = None
            self._until = self.clock()

    @staticmethod
    def retry_after(headers):
        raw = headers.get("Retry-After", "")
        try:
            value = float(raw)
            return max(0, value) if isfinite(value) else 0
        except TypeError, ValueError:
            try:
                stamp = parsedate_to_datetime(raw)
                return max(0, (stamp - datetime.now(timezone.utc)).total_seconds()) if stamp.tzinfo else 0
            except TypeError, ValueError, OverflowError:
                return 0

    @asynccontextmanager
    async def request(self, session, method, url, **kwargs):
        async with self._lock:
            if self.auth_blocked:
                raise TransportError("Cloud sign-in requires attention")
            if self.clock() < self._until:
                raise TransportError("Cloud requests are cooling down")
            await self.sleep(max(0, self.spacing - (self.clock() - self._last)))
            if self.clock() < self._until:
                raise TransportError("Cloud requests are cooling down")
            self._last = self.clock()
            self.requests += 1
            kwargs.setdefault("timeout", 25)
            try:
                async with session.request(method, url, **kwargs) as response:
                    body = await response.text()
                    try:
                        payload = json.loads(body)
                    except TypeError, ValueError:
                        payload = {}
                    code = payload.get("code") if isinstance(payload, dict) else None
                    message = (
                        str(payload.get("msg", payload.get("message", ""))).lower() if isinstance(payload, dict) else ""
                    )
                    reason = (
                        "session_conflict"
                        if "too many users" in message
                        else "rate_limited"
                        if response.status == 429
                        or str(code) in ("429", "1110", "1201")
                        or "rate limit" in message
                        or "too many requests" in message
                        else "authentication_required"
                        if response.status == 401 or str(code) == "401"
                        else "unavailable"
                        if response.status >= 500 or response.status == 403
                        else None
                    )
                    if reason:
                        self.pause(reason, retry_after=self.retry_after(response.headers))
                        raise TransportError("Cloud request paused: " + reason)
                    # Preserve failures across partial recovery; reset after a
                    # quiet period, rather than after one successful endpoint.
                    if self.clock() - self._until > 3600:
                        self._failures = 0
                    self.auth_blocked = False
                    yield response
            except OSError, TimeoutError:
                self.pause("unavailable")
                raise TransportError("Cloud network unavailable") from None


class SerialCloudTransport:
    """Coalesce token refreshes by serialising upstream authenticated operations."""

    def __init__(self, transport):
        self.transport = transport
        self._lock = asyncio.Lock()

    async def data(self, *args, **kwargs):
        async with self._lock:
            return await self.transport.data(*args, **kwargs)

    async def envelope(self, *args, **kwargs):
        async with self._lock:
            return await self.transport.envelope(*args, **kwargs)
