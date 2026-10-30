"""Reject test fixtures before promoting a dashboard to a live installation.

This reads exported JSON only. It never connects to HA or changes a dashboard.
Unavailable but registered real hardware is allowed; synthetic data is not.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ENTITY = re.compile(r"^(?:sensor|binary_sensor|weather|sun|number|select|switch|button)\.[a-z0-9_]+$")
FIXTURE_ENTITY = re.compile(r"^(?:sensor|binary_sensor)\.(?:sigen_review_|sigen_ui_|sigen_demo_|sigen_preview_)")
FIXTURE_SOURCES = {"demo", "simulated", "synthetic", "test_fixture", "production_modbus_bridge"}


def validate_live_profile(config, states, registered_entities=None):
    """Return path/reason findings without including household values or secrets."""
    states = {row["entity_id"]: row for row in states} if isinstance(states, list) else states
    registered = set(registered_entities) if registered_entities is not None else set(states)
    findings = []

    def issue(path, reason):
        findings.append({"path": path, "reason": reason})

    def walk(value, path):
        if isinstance(value, dict):
            for key in ("demo", "sample_data", "simulated", "show_preview_controls"):
                if value.get(key) is True:
                    issue(f"{path}.{key}", "Test/demo configuration is enabled")
            preview = value.get("screenshot_preview")
            if isinstance(preview, dict) and preview.get("enabled") is True:
                issue(f"{path}.screenshot_preview", "Fixed screenshot readings are enabled")
            for key in ("snapshot_at", "recorded_history", "forecast_series"):
                if value.get(key):
                    issue(f"{path}.{key}", "Static preview data must not be used in the live profile")
            for key, item in value.items():
                walk(item, f"{path}.{key}")
        elif isinstance(value, list):
            for index, item in enumerate(value):
                walk(item, f"{path}[{index}]")
        elif isinstance(value, str) and ENTITY.fullmatch(value):
            row = states.get(value)
            attrs = row.get("attributes", {}) if row else {}
            if FIXTURE_ENTITY.match(value) or attrs.get("sample_data") is True or attrs.get("data_source") in FIXTURE_SOURCES:
                issue(path, "Binding uses a test fixture or development bridge")
            elif value not in registered:
                issue(path, "Binding has no matching configured HA entity")

    walk(config, "config")
    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path, help="The intended live dashboard/profile JSON")
    parser.add_argument("states", type=Path, help="Current HA states JSON from the intended live installation")
    parser.add_argument("--registry", type=Path, help="Optional entity registry JSON; permits configured offline entities")
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8-sig"))
    states = json.loads(args.states.read_text(encoding="utf-8-sig"))
    registry = None
    if args.registry:
        registry = [row["entity_id"] for row in json.loads(args.registry.read_text(encoding="utf-8-sig"))]
    findings = validate_live_profile(config, states, registry)
    print(json.dumps({"live_profile_clean": not findings, "findings": findings}, indent=2))
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
