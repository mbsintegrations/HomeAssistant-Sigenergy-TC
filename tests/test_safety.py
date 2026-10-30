from dataclasses import replace
from datetime import datetime, timedelta, timezone

import pytest

from custom_components.sigen_hybrid.core.control import Controller
from custom_components.sigen_hybrid.core.errors import CapabilityError, SafetyError
from custom_components.sigen_hybrid.core.models import Intent, Mode, SafetyLimits, Snapshot, Source

NOW = datetime(2026, 10, 26, 12, tzinfo=timezone.utc)


def snapshot():
    return Snapshot(NOW, 50, 2, 1, 0, 1, 20, 5, 5)


@pytest.mark.parametrize(
    "patch",
    [
        {"observed_at": NOW - timedelta(seconds=31)},
        {"observed_at": NOW + timedelta(seconds=6)},
        {"soc": float("nan")},
        {"soc": 101},
        {"capacity_kwh": 0},
        {"on_grid": False},
        {"running": False},
    ],
)
def test_bad_telemetry_blocks_control(patch):
    with pytest.raises(SafetyError):
        Controller(SafetyLimits()).preview(Intent(Mode.HOLD), replace(snapshot(), **patch), NOW)


@pytest.mark.parametrize("power", [None, 0, -1, float("nan"), float("inf"), 6])
def test_invalid_charge_power_blocks_control(power):
    with pytest.raises(SafetyError):
        Controller(SafetyLimits()).preview(Intent(Mode.CHARGE, power_kw=power), snapshot(), NOW)


def test_installer_reserve_cannot_be_lowered_by_user_setting():
    snap = replace(snapshot(), backup_soc=60)
    limits = SafetyLimits(export_permitted=True)
    with pytest.raises(SafetyError, match="reserve"):
        Controller(limits).preview(Intent(Mode.DISCHARGE, power_kw=1), snap, NOW)


def test_charge_ceiling_combines_device_and_user_limits():
    with pytest.raises(SafetyError, match="ceiling"):
        Controller(SafetyLimits()).preview(
            Intent(Mode.CHARGE, power_kw=1), replace(snapshot(), soc=85, charge_cutoff_soc=80), NOW
        )


@pytest.mark.parametrize("intent", [Intent(Mode.DISCHARGE, power_kw=1), Intent(Mode.HOLD, export_requested=True)])
def test_export_permission_is_separate_and_defaults_off(intent):
    with pytest.raises(SafetyError, match="Export permission"):
        Controller(SafetyLimits()).preview(intent, snapshot(), NOW)


async def test_live_write_is_locked_even_after_valid_preview():
    controller = Controller(SafetyLimits())
    intent = Intent(Mode.CHARGE, power_kw=1)
    assert (await controller.execute(intent, snapshot(), NOW)).status == "preview"
    with pytest.raises(CapabilityError):
        await controller.execute(intent, snapshot(), NOW, dry_run=False)


async def test_manual_ownership_and_expiry():
    controller = Controller(SafetyLimits(), demo=True)
    await controller.execute(Intent(Mode.HOLD, duration_minutes=30), snapshot(), NOW, dry_run=False)
    with pytest.raises(SafetyError, match="manual override"):
        controller.preview(Intent(Mode.SELF_CONSUMPTION, source=Source.AUTOMATION), snapshot(), NOW)
    later = NOW + timedelta(minutes=31)
    assert controller.preview(
        Intent(Mode.SELF_CONSUMPTION, source=Source.PLANNER), replace(snapshot(), observed_at=later), later
    )


async def test_execution_receipt_prevents_duplicate_execution_and_id_reuse():
    controller = Controller(SafetyLimits(), demo=True)
    intent = Intent(Mode.HOLD)
    first = await controller.execute(intent, snapshot(), NOW, dry_run=False)
    second = await controller.execute(intent, snapshot(), NOW, dry_run=False)
    assert first == second
    assert len(controller.audit) == 1
    with pytest.raises(SafetyError, match="reused"):
        await controller.execute(replace(intent, duration_minutes=5), snapshot(), NOW, dry_run=False)


@pytest.mark.parametrize("patch", [{"reserve_soc": 95}, {"max_charge_kw": float("nan")}, {"max_duration_minutes": 1441}])
def test_invalid_safety_configuration(patch):
    with pytest.raises(ValueError):
        SafetyLimits(**patch)


@pytest.mark.parametrize("duration", [180, 1440])
async def test_custom_preview_and_demo_simulation_remain_bounded_without_live_writes(duration):
    controller = Controller(SafetyLimits(), demo=True)
    intent = Intent(Mode.HOLD, duration_minutes=duration)
    assert (await controller.execute(intent, snapshot(), NOW)).status == "preview"
    result = await controller.execute(intent, snapshot(), NOW, dry_run=False)
    assert result.status == "simulated"
    assert result.expires_at == NOW+timedelta(minutes=duration)
    assert controller.manual_until == result.expires_at
    live = Controller(SafetyLimits())
    assert (await live.execute(intent, snapshot(), NOW)).status == "preview"
    with pytest.raises(CapabilityError, match="Live writes are locked"):
        await live.execute(intent, snapshot(), NOW, dry_run=False)


@pytest.mark.parametrize("duration", [0, 1441, -1, 30.9, 1440.0, float("nan"), float("inf"), True, False, "1440", None])
async def test_invalid_manual_durations_never_reach_demo_expiry_or_live_dispatch(duration):
    controller = Controller(SafetyLimits(), demo=True)
    intent = Intent(Mode.HOLD, duration_minutes=duration)
    with pytest.raises(SafetyError, match="duration"):
        await controller.execute(intent, snapshot(), NOW, dry_run=False)
    assert controller.manual_until is None and controller.last_result is None and not controller.audit


def test_explicit_lower_duration_limit_remains_authoritative():
    controller = Controller(SafetyLimits(max_duration_minutes=90))
    assert controller.preview(Intent(Mode.HOLD, duration_minutes=90), snapshot(), NOW)
    with pytest.raises(SafetyError, match="configured bound"):
        controller.preview(Intent(Mode.HOLD, duration_minutes=120), snapshot(), NOW)


@pytest.mark.parametrize("maximum", [0, 1441, 90.5, float("nan"), float("inf"), True, False, "90"])
def test_configured_duration_limit_must_also_be_whole_minutes(maximum):
    with pytest.raises(ValueError, match="duration"):
        SafetyLimits(max_duration_minutes=maximum)
