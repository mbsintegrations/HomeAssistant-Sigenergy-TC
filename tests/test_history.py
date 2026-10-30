from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from custom_components.sigen_hybrid.core.history import (
    HistoryBroker,
    parse_energy,
    parse_tariff_soc,
    validate_range,
)

UTC = timezone.utc
ZONE = ZoneInfo("Europe/Dublin")
NOW = datetime(2026, 10, 27, 19, tzinfo=UTC)
DAY = {"date": "2026-10-27", "start_time": "2026-10-27T00:00:00Z", "end_time": "2026-10-28T00:00:00Z"}


def series(identity, *points, **extra):
    return {
        "id": identity,
        "points": [{"time": clock, "value": value, **flags} for clock, value, flags in points],
        **extra,
    }


def energy_body(unit="kW"):
    return {
        "chartData": {
            "unit": unit,
            "dataSeries": [
                series("FROM_SOLAR", ("20261027 12:00", 2, {})),
                series("TO_LOAD", ("20261027 12:00", -1.5 if unit == "kW" else -15, {})),
                series("TO_EVAC", ("20261027 12:00", -0.5 if unit == "kW" else -5, {})),
            ],
        }
    }


def test_energy_parser_preserves_signs_units_gaps_and_excludes_predictions():
    body = {
        "data": {
            "chartData": {
                "unit": "W",
                "dataSeries": [
                    series(
                        "FROM_SOLAR",
                        ("20261027 12:00", 500, {}),
                        ("20261027 12:05", None, {}),
                        ("20261027 12:10", 900, {"isForecast": True}),
                        ("20261027 20:00", 1000, {}),
                        ("20261026 23:55", 1000, {}),
                        ("bad-time", 10, {}),
                    ),
                    series("TO_LOAD", ("20261027 12:00", -1200, {})),
                    series("BATTERY", ("20261027 12:00", 42, {}), predicted=True),
                    series("UNKNOWN", ("20261027 12:00", 999, {})),
                ],
            }
        }
    }
    result = parse_energy(
        body,
        period="day",
        zone=ZONE,
        start=datetime(2026, 10, 27, tzinfo=UTC),
        end=datetime(2026, 10, 28, tzinfo=UTC),
        now=NOW,
    )
    assert [item["key"] for item in result] == ["solar_power", "home_power"]
    assert [point["value"] for point in result[0]["points"]] == [0.5, None]
    assert result[1]["points"][0]["value"] == -1.2
    body["data"]["chartData"]["unit"] = "%"
    assert (
        parse_energy(
            body,
            period="day",
            zone=ZONE,
            start=datetime(2026, 10, 27, tzinfo=UTC),
            end=datetime(2026, 10, 28, tzinfo=UTC),
            now=NOW,
        )
        == []
    )


def test_tariff_soc_keeps_actual_zero_and_unknown_and_drops_invalid_soc():
    body = {
        "dataSeries": [
            series("SOC", ("20261027 12:00", 0, {}), ("20261027 12:05", 101, {})),
            series("BUY_TARIFF", ("20261027 12:00", 0.09, {})),
        ]
    }
    result = parse_tariff_soc(
        body,
        zone=ZONE,
        start=datetime(2026, 10, 27, tzinfo=UTC),
        end=datetime(2026, 10, 28, tzinfo=UTC),
        now=NOW,
        currency="EUR",
    )
    assert result[0]["unit"] == "%" and [p["value"] for p in result[0]["points"]] == [0, None]
    assert result[1]["unit"] == "EUR/kWh" and result[1]["points"][0]["value"] == 0.09


def test_calendar_validation_accepts_dst_day_and_rejects_ambiguous_api_hour():
    start, end, first, last = validate_range(
        "day", "2026-10-25", "2026-10-25T00:00:00+01:00", "2026-10-26T00:00:00Z", ZONE, NOW
    )
    assert (end - start).total_seconds() == 25 * 3600 and first == last == "20261025"
    body = {
        "chartData": {
            "unit": "kW",
            "dataSeries": [
                series("FROM_SOLAR", ("20261025 00:30", 1, {}), ("20261025 01:30", 2, {}), ("20261025 02:30", 3, {}))
            ],
        }
    }
    parsed = parse_energy(body, period="day", zone=ZONE, start=start, end=end, now=NOW)
    assert [p["value"] for p in parsed[0]["points"]] == [1, 3]


@pytest.mark.parametrize(
    "period,date,start,end",
    [
        ("day", "2026-10-27", "2026-10-27T00:00:00", "2026-10-28T00:00:00Z"),
        ("day", "2026-10-27", "2026-10-27T01:00:00Z", "2026-10-28T01:00:00Z"),
        ("week", "2026-10-27", "2026-10-27T00:00:00Z", "2026-10-29T00:00:00Z"),
        ("month", "2026-10-27", "2026-10-02T00:00:00+01:00", "2026-11-02T00:00:00Z"),
        ("day", "2026-10-28", "2026-10-28T00:00:00Z", "2026-10-29T00:00:00Z"),
    ],
)
def test_invalid_or_unbounded_calendar_ranges_are_rejected(period, date, start, end):
    with pytest.raises(ValueError):
        validate_range(period, date, start, end, ZONE, NOW)


class Client:
    def __init__(self):
        self.calls = []
        self.failure = False

    async def history_energy(self, **kwargs):
        self.calls.append(("energy", kwargs))
        if self.failure:
            raise RuntimeError("PRIVATE PROVIDER RESPONSE")
        return energy_body("kW" if kwargs["date_flag"] == 1 else "kWh")

    async def history_tariff_soc(self, **kwargs):
        self.calls.append(("tariff", kwargs))
        return {
            "dataSeries": [
                series("SOC", ("20261027 12:00", 75, {})),
                series("BUY_TARIFF", ("20261027 12:00", 0.09, {})),
            ]
        }


async def test_related_chart_requests_share_cache_and_caller_cannot_mutate_it():
    import asyncio

    client = Client()
    broker = HistoryBroker(client, timezone="Europe/Dublin", currency="EUR", now=lambda: NOW)
    first, second = await asyncio.gather(broker.get("power", "day", **DAY), broker.get("load", "day", **DAY))
    assert len(client.calls) == 1 and second["cached"] is True
    assert first["series"][1]["points"][0]["value"] == -1.5
    assert second["series"][0]["points"][0]["value"] == 1.5
    first["series"][1]["points"][0]["value"] = 999
    third = await broker.get("power", "day", **DAY)
    assert third["series"][1]["points"][0]["value"] == -1.5


async def test_period_energy_is_positive_and_not_confused_with_signed_day_power():
    client = Client()
    broker = HistoryBroker(client, timezone="Europe/Dublin", currency="EUR", now=lambda: NOW)
    result = await broker.get("load", "month", "2026-10-27", "2026-10-01T00:00:00+01:00", "2026-11-01T00:00:00Z")
    assert result["chartType"] == "bar" and result["series"][0]["unit"] == "kWh"
    assert result["series"][0]["points"][0]["value"] == 15
    combined = await broker.get("power", "month", "2026-10-27", "2026-10-01T00:00:00+01:00", "2026-11-01T00:00:00Z")
    assert combined["series"][1]["points"][0]["value"] == -15
    assert client.calls[0][1] == {"start_date": "20261001", "end_date": "20261031", "date_flag": 3}


async def test_tariff_soc_selected_result_does_not_mutate_shared_cache():
    client = Client()
    broker = HistoryBroker(client, timezone="Europe/Dublin", currency="EUR", now=lambda: NOW)
    result = await broker.get("soc", "day", **DAY)
    result["series"][0]["points"][0]["value"] = 1
    result = await broker.get("price", "day", **DAY)
    assert len(client.calls) == 1 and result["series"][0]["points"][0]["value"] == 75


async def test_current_history_ttl_and_failed_read_backoff_are_conservative():
    client = Client()
    clock = [0]
    broker = HistoryBroker(client, timezone="Europe/Dublin", currency="EUR", now=lambda: NOW, clock=lambda: clock[0])
    await broker.get("power", "day", **DAY)
    clock[0] = 899
    assert (await broker.get("power", "day", **DAY))["cached"] is True
    assert len(client.calls) == 1
    clock[0] = 901
    client.failure = True
    failed = await broker.get("power", "day", **DAY)
    assert failed["source"] == "cloud_unavailable" and len(client.calls) == 2
    failed = await broker.get("price", "day", **DAY)
    assert failed["series"] == [] and len(client.calls) == 2 and "PRIVATE" not in str(failed)


async def test_unsupported_cloud_kinds_and_lifetime_soc_do_not_make_provider_requests():
    client = Client()
    broker = HistoryBroker(client, timezone="Europe/Dublin", currency="EUR", now=lambda: NOW)
    for kind, period in [("grid_voltage", "day"), ("soc", "lifetime")]:
        result = await broker.get(kind, period, **DAY)
        assert result["source"] == "local_recorder" and result["series"] == []
    assert not client.calls


async def test_completed_day_uses_long_cache_and_year_uses_verified_flag_four():
    client = Client()
    clock = [0]
    broker = HistoryBroker(client, timezone="Europe/Dublin", currency="EUR", now=lambda: NOW, clock=lambda: clock[0])
    yesterday = {"date": "2026-10-26", "start_time": "2026-10-26T00:00:00Z", "end_time": "2026-10-27T00:00:00Z"}
    await broker.get("power", "day", **yesterday)
    clock[0] = 901
    assert (await broker.get("power", "day", **yesterday))["cached"] is True
    assert len(client.calls) == 1
    clock[0] = 86401
    await broker.get("power", "day", **yesterday)
    assert len(client.calls) == 2
    clock[0] += 2
    result = await broker.get("power", "year", "2026-10-27", "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z")
    assert result["chartType"] == "bar"
    assert client.calls[-1][1] == {"start_date": "20260101", "end_date": "20261231", "date_flag": 4}


async def test_lifetime_uses_verified_annual_buckets_before_recorder_cutoff_and_one_cached_read():
    import asyncio

    class LifetimeClient(Client):
        async def history_energy(self, **kwargs):
            self.calls.append(("energy", kwargs))
            return {
                "chartData": {
                    "unit": "kWh",
                    "dataSeries": [
                        series(
                            "FROM_SOLAR",
                            ("20100101 00:00", 10, {}),
                            ("20260101 00:00", 129.25, {}),
                            ("20270101 00:00", 999, {}),
                            ("20250101 00:00", 999, {"isForecast": True}),
                            ("20261027 00:00", 999, {}),
                            ("19990101 00:00", 999, {}),
                        ),
                        series("TO_LOAD", ("20260101 00:00", -249.01, {})),
                    ],
                }
            }

    client = LifetimeClient()
    broker = HistoryBroker(client, timezone="Europe/Dublin", currency="EUR", now=lambda: NOW)
    bounds = {"date": "2026-10-27", "start_time": "2026-10-27T18:35:00Z", "end_time": NOW.isoformat()}
    power, solar = await asyncio.gather(
        broker.get("power", "lifetime", **bounds), broker.get("solar", "lifetime", **bounds)
    )
    assert client.calls == [("energy", {"start_date": "20261027", "end_date": "20261231", "date_flag": 5})]
    assert solar["cached"] is True and power["chartType"] == "bar"
    assert power["series"][0]["unit"] == "kWh"
    assert [point["value"] for point in power["series"][0]["points"]] == [10, 129.25]
    assert power["series"][1]["points"][0]["value"] == -249.01
    assert power["start"] == int(datetime(2010, 1, 1, tzinfo=UTC).timestamp() * 1000)
    assert power["end"] == int(datetime(2027, 1, 1, tzinfo=UTC).timestamp() * 1000)
    assert solar["series"][0]["points"] == power["series"][0]["points"]
    power["series"][0]["points"][0]["value"] = 999
    assert (await broker.get("solar", "lifetime", **bounds))["series"][0]["points"][0]["value"] == 10


async def test_lifetime_default_recorder_epoch_does_not_trigger_an_unbounded_cloud_scan():
    client = Client()
    broker = HistoryBroker(client, timezone="Europe/Dublin", currency="EUR", now=lambda: NOW)
    result = await broker.get("power", "lifetime", "2026-10-27", "1970-01-01T00:00:00Z", NOW.isoformat())
    assert client.calls[0][1] == {"start_date": "20261027", "end_date": "20261231", "date_flag": 5}
    assert result["chartType"] == "bar" and all(not item["points"] for item in result["series"])
    for start, end, date in [
        ("1969-01-01T00:00:00Z", NOW.isoformat(), "2026-10-27"),
        (NOW.isoformat(), "2027-01-01T00:00:00Z", "2026-10-27"),
        ("2026-01-01T00:00:00Z", NOW.isoformat(), "2026-10-28"),
    ]:
        with pytest.raises(ValueError):
            await broker.get("power", "lifetime", date, start, end)
    assert len(client.calls) == 1
