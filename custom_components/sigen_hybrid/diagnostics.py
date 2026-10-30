"""Allowlisted diagnostics; never export credentials or raw account payloads."""

from dataclasses import asdict


async def async_get_config_entry_diagnostics(hass, entry):
    runtime = entry.runtime_data
    return {
        "version": 1,
        "demo": entry.data.get("demo", False),
        "controller": runtime.controller.diagnostics(),
        "snapshot": asdict(runtime.data) if runtime.data else None,
        "cloud_configured": runtime.cloud is not None,
        "cloud_status": "unavailable" if runtime.cloud_error else "ready" if runtime.cloud_data else "not_connected",
        "cloud_forecast_available": bool(runtime.cloud_data.get("forecast_available")),
        "cloud_telemetry_available": bool(runtime.cloud_data.get("telemetry_available")),
        "cloud_telemetry_schema": runtime.cloud_data.get("telemetry_schema", {}),
        "forecast_available": bool(runtime.forecast_data.get("available")),
        "forecast_series_has_gaps": runtime.forecast_data.get("series_has_gaps"),
        "connections": getattr(runtime, "connections", {}),
        "capabilities": getattr(runtime, "capabilities", {}),
    }
