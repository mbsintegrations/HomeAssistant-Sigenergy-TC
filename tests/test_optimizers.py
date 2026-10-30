from datetime import datetime, timedelta, timezone

import pytest

from custom_components.sigen_hybrid.core.optimizers import ModuleTelemetry


def test_absent_optimizer_readings_are_unknown_not_zero():
    now = datetime.now(timezone.utc)
    data = ModuleTelemetry("tigo", "synthetic-module", now)
    assert data.power_w is None and data.energy_kwh is None
    assert data.is_fresh(now)
    assert not data.is_fresh(now + timedelta(hours=2))


def test_invalid_module_power_rejected():
    with pytest.raises(ValueError):
        ModuleTelemetry("tigo", "synthetic-module", datetime.now(timezone.utc), power_w=float("nan"))
