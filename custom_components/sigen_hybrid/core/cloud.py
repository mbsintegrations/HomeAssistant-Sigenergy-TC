"""Optional owner-app reads with shared session, pacing and cooldown.

No browser-session reuse, hidden endpoints, generic API escape hatch, automatic
VPP onboarding or cloud retry of an uncertain local write.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import datetime, timezone
from typing import Any

from .errors import AuthenticationError, CapabilityError, CloudLoginFailure, TransportError
from .owner_devices import (
    battery_inventory,
    battery_module_data,
    device_dynamic_schema,
    device_read_error,
    device_topology_schema,
    system_inventory,
)
from .power import app_power_limits
from .telemetry import cloud_measurements, flow_schema

_LOGGER = logging.getLogger(__name__)
_AUTH_HTTP_PREFIX = re.compile(r"^Sigenergy Cloud authentication failed: HTTP ([1-5][0-9]{2})(?:;|$)")


def _safe_login_log(error: Exception, status: int | None = None):
    """Log only local exception class and bounded HTTP status; never provider text."""
    if isinstance(status, bool) or not isinstance(status, int) or not 100 <= status <= 599:
        status = None
    _LOGGER.warning("Cloud login failure: exception=%s status=%s", type(error).__name__, status)


async def async_discover_station(client: Any, *, timeout_seconds: float = 20) -> str:
    """Authenticate once and return the discovered owner plant without leaking responses."""
    try:
        try:
            from aiohttp import ClientError
            from sigenergy_cloud import SigenergyCloudAPIError, SigenergyCloudAuthError, SigenergyCloudRateLimitError
        except ImportError as error:
            _safe_login_log(error)
            raise CloudLoginFailure("cloud_login_failed") from None
        try:
            async with asyncio.timeout(timeout_seconds):
                await client.connect()
            station = client.station_id
            if isinstance(station, bool) or not isinstance(station, (str, int)):
                raise CloudLoginFailure("no_cloud_plant")
            station_id = str(station).strip()
            if not station_id or station_id.casefold() == "none":
                raise CloudLoginFailure("no_cloud_plant")
            return station_id
        except CloudLoginFailure:
            raise
        except SigenergyCloudAuthError as error:
            # This dependency labels all non-200 OAuth HTTP responses as auth
            # failures. Read only its fixed status prefix, never the body.
            match = _AUTH_HTTP_PREFIX.match(str(error))
            status = int(match.group(1)) if match else None
            _safe_login_log(error, status)
            reason = (
                "cannot_connect" if status in (403, 429) or (status is not None and status >= 500) else "invalid_auth"
            )
            raise CloudLoginFailure(reason) from None
        except SigenergyCloudRateLimitError as error:
            _safe_login_log(error, 429)
            raise CloudLoginFailure("cannot_connect") from None
        except SigenergyCloudAPIError as error:
            status = getattr(error, "status_code", None)
            if isinstance(status, bool) or not isinstance(status, int) or not 100 <= status <= 599:
                status = None
            _safe_login_log(error, status)
            reason = "cannot_connect" if status == 429 or (status is not None and status >= 500) else "no_cloud_plant"
            raise CloudLoginFailure(reason) from None
        except (TimeoutError, OSError, ClientError) as error:
            _safe_login_log(error)
            raise CloudLoginFailure("cannot_connect") from None
        except KeyError as error:
            _safe_login_log(error)
            reason = "no_cloud_plant" if error.args == ("stationId",) else "cloud_login_failed"
            raise CloudLoginFailure(reason) from None
        except Exception as error:
            _safe_login_log(error)
            raise CloudLoginFailure("cloud_login_failed") from None
    finally:
        # The temporary setup client must release an owned session even when
        # the flow is cancelled while authentication or cleanup is in progress.
        cleanup = asyncio.create_task(client.close())
        try:
            await asyncio.shield(cleanup)
        except asyncio.CancelledError:
            try:
                await cleanup
            except Exception:
                pass
            raise
        except Exception as error:
            _safe_login_log(error)
            raise CloudLoginFailure("cloud_login_failed") from None


class CloudAdapter:
    """Narrow adapter around MIT sigenergy-cloud; optional and explicitly opted in."""

    def __init__(
        self,
        client: Any,
        expected_station_id: str,
        *,
        unofficial_opt_in: bool,
        refresh_seconds: float = 900,
        live_refresh_seconds: float | None = None,
    ):
        if not unofficial_opt_in:
            raise CapabilityError("Private app API access requires explicit opt-in")
        if not expected_station_id or refresh_seconds < 300:
            raise ValueError("Explicit station identity and conservative cloud polling are required")
        self.client = client
        self.station_id = expected_station_id
        self.refresh_seconds = refresh_seconds
        self.live_refresh_seconds = live_refresh_seconds or refresh_seconds
        if self.live_refresh_seconds < 60:
            raise ValueError("Cloud polling must be at least sixty seconds")
        self._details_fetched = float("-inf")
        self._lock = asyncio.Lock()
        self._connected = False
        self._fetched = float("-inf")
        self._retry_after = float("-inf")
        self._cache: dict = {}
        self._capacity = None
        self._owner_controls = {}
        self._module_static: dict = {}
        self._module_inventory: list = []
        self._device_inventory = []
        self._module_inventory_fetched = float("-inf")
        self._module_topology_schema = []
        self._module_read_diagnostics = {}

    async def _battery_modules(self):
        """Discover identities daily; reuse this session and the 15-minute cache."""
        if not hasattr(self.client, "battery_module_dynamic"):
            return []
        self._module_read_diagnostics = {}
        try:
            if time.monotonic() - self._module_inventory_fetched >= 86400:
                topology = await self.client.device_topology()
                self._module_inventory = battery_inventory(topology)
                self._device_inventory = system_inventory(topology, self._owner_controls)
                self._module_topology_schema = device_topology_schema(topology)
                self._module_inventory_fetched = time.monotonic()
                self._module_static = {}
            self._module_read_diagnostics["topology"] = self._module_topology_schema
            self._module_read_diagnostics["inventory_count"] = len(self._module_inventory)
            live = {}
            for aio in dict.fromkeys(item.get("aio_serial") for item in self._module_inventory):
                if aio:
                    try:
                        live[aio] = await self.client.device_tree_live_values(aio)
                    except Exception as error:
                        self._stop_module_burst(error)
                        live[aio] = []
            modules = []
            for identity in self._module_inventory:
                serial = identity["serial"]
                if serial not in self._module_static:
                    try:
                        self._module_static[serial] = await self.client.battery_module_static(serial)
                    except Exception as error:
                        self._stop_module_burst(error)
                        pass
                dynamic_error = None
                try:
                    dynamic = await self.client.battery_module_dynamic(serial)
                except Exception as error:
                    dynamic_error = device_read_error(error)
                    self._module_read_diagnostics["dynamic_error"] = dynamic_error
                    self._stop_module_burst(error)
                    dynamic = {}
                try:
                    pack = await self.client.battery_module_pack(serial)
                except Exception as error:
                    self._stop_module_burst(error)
                    pack = {}
                completed = datetime.now(timezone.utc)
                module = battery_module_data(
                    identity,
                    dynamic,
                    pack,
                    self._module_static.get(serial, {}),
                    live.get(identity.get("aio_serial"), []),
                    completed,
                )
                module["read_diagnostics"] = device_dynamic_schema(dynamic, completed)
                if dynamic_error is not None:
                    module["read_diagnostics"]["error"] = dynamic_error
                aio = identity.get("aio_serial")
                module["read_diagnostics"]["selected_aio_category"] = (
                    "CMU" if isinstance(aio, str) and aio.upper().startswith("CMU") else "other" if aio else "missing"
                )
                modules.append(module)
            return modules
        except Exception as error:
            self._module_read_diagnostics["collector_error"] = device_read_error(error)
            return []

    @staticmethod
    def _stop_module_burst(error):
        if isinstance(error, TransportError):
            raise error
        status = getattr(error, "status_code", None)
        if (
            type(error).__name__ in ("SigenergyCloudRateLimitError", "SigenergyCloudAuthError")
            or isinstance(error, (OSError, TimeoutError))
            or isinstance(status, int)
            and not isinstance(status, bool)
            and (status in (401, 403, 429) or status >= 500)
        ):
            raise TransportError("Optional device reads are unavailable; wait for the next cloud cycle") from None

    async def connect(self):
        try:
            await self.client.connect()
            if str(self.client.station_id) != self.station_id:
                await self.client.close()
                raise AuthenticationError("Cloud station does not match the explicitly configured station")
            try:
                station = await self.client.refresh_station()
                if str(self.client.station_id) != self.station_id:
                    raise AuthenticationError("Cloud station changed during discovery")
                self._capacity = station.get("batteryCapacity") if isinstance(station, dict) else None
                if isinstance(station, dict):
                    self._owner_controls = {
                        key: station[key] for key in ("hasGateway", "hasAcCharger", "hasEv", "hasPv", "pvCapacity", "hasInstantSetting", "acSnList", "dcSnList")
                        if key in station
                    }
            except AuthenticationError:
                raise
            except Exception:
                self._capacity = None
            self._connected = True
        except AuthenticationError:
            raise
        except CloudLoginFailure as error:
            if error.reason == "invalid_auth":
                raise AuthenticationError("Cloud sign-in requires reauthentication") from None
            raise TransportError("Cloud discovery is temporarily unavailable") from None
        except Exception:
            raise TransportError("Cloud connection is temporarily unavailable") from None

    async def refresh(self) -> dict:
        async with self._lock:
            now = time.monotonic()
            if now < self._retry_after:
                raise TransportError("Cloud is in backoff; local monitoring is unaffected")
            if self._cache and now - self._fetched < self.live_refresh_seconds:
                return dict(self._cache)
            try:
                if not self._connected:
                    await self.connect()
                if str(self.client.station_id) != self.station_id:
                    raise AuthenticationError("Cloud station no longer matches the selected plant")
                details_due = not self._cache or now - self._details_fetched >= self.refresh_seconds
                details = dict(self._cache)
                if details_due:
                    details["modes"] = await self.client.available_operational_modes()
                current = await self.client.current_operational_mode()
                flow = await self.client.energy_flow()
                telemetry_clock = datetime.now(timezone.utc).isoformat()
                telemetry = cloud_measurements(flow, self._capacity)
                if details_due:
                    manual = await self.client.instant_manual_control()
                    details.update(manual_enabled=bool(manual.enabled), manual_end_time=manual.end_time)
                    try:
                        details["manual_control_power"] = app_power_limits(await self.client.battery_power_limit())
                    except Exception as error:
                        self._stop_module_burst(error)
                        details["manual_control_power"] = {}
                    details["manual_control_power_observed_at"] = datetime.now(timezone.utc).isoformat()
                    try:
                        prediction = await self.client.prediction_data()
                        forecast_available = isinstance(prediction, dict) and bool(prediction)
                    except Exception as error:
                        self._stop_module_burst(error)
                        prediction, forecast_available = None, False
                    details.update(
                        prediction=prediction,
                        forecast_available=forecast_available,
                        battery_modules=await self._battery_modules(),
                        module_read_diagnostics=self._module_read_diagnostics,
                    )
                    self._details_fetched = time.monotonic()
                self._cache = {
                    **details,
                    "owner_controls": dict(self._owner_controls),
                    "device_inventory": list(self._device_inventory),
                    "mode": current,
                    "telemetry": telemetry,
                    "telemetry_observed_at": telemetry_clock,
                    "telemetry_schema": flow_schema(flow),
                    "telemetry_available": any(
                        telemetry.get(key) is not None for key in ("pv_kw", "home_kw", "grid_kw", "battery_kw", "soc")
                    ),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                self._fetched = time.monotonic()
                return dict(self._cache)
            except AuthenticationError:
                self._retry_after = time.monotonic() + self.live_refresh_seconds
                raise
            except Exception:
                self._retry_after = time.monotonic() + self.live_refresh_seconds
                raise TransportError("Cloud refresh failed; no write was attempted") from None

    async def close(self):
        await self.client.close()
        self._connected = False

    async def set_native_mode(self, mode: int):
        raise CapabilityError("Native cloud writes await account validation and acceptance testing")

    async def instant_control(self, mode: str, duration: int, power_kw: float | None):
        raise CapabilityError("Cloud manual writes await identity, SOC and duration validation")
