"""Exercise the registered preview action with uncached and invalid zones."""

import asyncio
import json
from datetime import datetime, timezone
from decimal import Decimal
from threading import get_ident
from types import SimpleNamespace
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pytest

from custom_components.sigen_hybrid.core import tariffs
from custom_components.sigen_hybrid.core.models import SafetyLimits, Snapshot
from custom_components.sigen_hybrid.core.planner import Forecast, charging_plan
from custom_components.sigen_hybrid.core.tariffs import TariffPlan


async def plan_service(now, resolve):
    from test_manual_service_schema import manual_schema

    hass, schemas, callbacks = await manual_schema(capture=True)
    runtime = SimpleNamespace(
        data=Snapshot(now, 20, 0, 1, 1, 0, 20, 5, 5),
        last_update_success=True,
        local_error=None,
        controller=SimpleNamespace(limits=SafetyLimits(max_charge_kw=5)),
        entry=SimpleNamespace(options={}),
    )
    hass.config_entries = SimpleNamespace(
        async_get_entry=lambda _: SimpleNamespace(domain="sigen_hybrid", state="loaded", runtime_data=runtime)
    )
    forecast_calls = []

    async def forecast(*args):
        forecast_calls.append(args)
        return {"available": True, "solar_24h_kwh": 0, "provider": "synthetic"}

    callback = callbacks["preview_plan"]
    callback.__globals__.update(
        utcnow=lambda: now,
        dt_util=SimpleNamespace(async_get_time_zone=resolve),
        TariffPlan=TariffPlan,
        Forecast=Forecast,
        charging_plan=charging_plan,
        async_forecast=forecast,
        json=json,
    )
    return callback, schemas["preview_plan"], forecast_calls


def tariff_data(zone):
    return {
        "unit": "major_currency_per_kwh", "timezone": zone, "currency": "EUR",
        "default_import": "0.30", "default_export": "0.18",
        "windows": [{"start": "01:00", "end": "02:00", "rate": "0.09"}],
    }


@pytest.mark.parametrize("now", [
    datetime(2026, 3, 29, tzinfo=timezone.utc),
    datetime(2026, 10, 25, tzinfo=timezone.utc),
    datetime(2026, 11, 27, tzinfo=timezone.utc),
])
async def test_registered_plan_resolves_uncached_zone_off_loop_once_and_reuses_it(monkeypatch, now):
    loop_thread = get_ident()
    resolved = []

    def cold_lookup(name):
        assert get_ident() != loop_thread
        zone = ZoneInfo.no_cache(name)
        resolved.append(zone)
        return zone

    async def resolve(name):
        return await asyncio.to_thread(cold_lookup, name)

    def forbidden_lookup(*args):
        pytest.fail("Tariff construction and slot evaluation must reuse the resolved timezone")

    monkeypatch.setattr(tariffs, "ZoneInfo", forbidden_lookup, raising=False)
    callback, schema, forecasts = await plan_service(now, resolve)
    original_rate = TariffPlan.rate_at
    evaluated = []

    def rate_at(self, when, direction="import"):
        assert self.zone is resolved[0]
        evaluated.append(when)
        return original_rate(self, when, direction)

    monkeypatch.setattr(TariffPlan, "rate_at", rate_at)
    result = await callback(SimpleNamespace(data=schema({
        "config_entry": "synthetic", "tariff_json": json.dumps(tariff_data("Europe/Dublin")),
        "demand_24h_kwh": 10,
    })))
    assert len(resolved) == len(forecasts) == 1
    assert len(evaluated) == 48
    assert result["advisory_only"] is True and result["export_permitted"] is False
    assert result["unserved_kwh"] == 0 and result["slots"]


@pytest.mark.parametrize("zone", ["Invalid/Uncached", "", None, 42, ["UTC"]])
async def test_invalid_tariff_zone_rejected_before_forecast_or_planning(zone):
    async def resolve(name):
        try:
            return await asyncio.to_thread(ZoneInfo.no_cache, name)
        except ZoneInfoNotFoundError:
            return None

    callback, schema, forecasts = await plan_service(datetime(2026, 11, 27, tzinfo=timezone.utc), resolve)
    with pytest.raises(RuntimeError, match="Plan rejected"):
        await callback(SimpleNamespace(data=schema({
            "config_entry": "synthetic", "tariff_json": json.dumps(tariff_data(zone)),
            "demand_24h_kwh": 10,
        })))
    assert not forecasts


def test_tariff_plan_requires_resolved_timezone():
    with pytest.raises(ValueError, match="resolved tariff timezone"):
        TariffPlan("UTC", "EUR", Decimal("0.3"), Decimal("0"), zone=None)
