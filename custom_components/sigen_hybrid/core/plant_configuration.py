"""Lazy native-app configuration reads, separate from TC-owned HA schedules.

Only fixed read operations observed in the owner web client are accepted. The
existing account session, request gate and selected plant identity are reused.
Reading a preset never imports, enables or dispatches it as an HA strategy.
"""

import re
import time
from copy import deepcopy
from datetime import datetime, timezone
from math import isfinite

from .errors import CapabilityError, SafetyError

AC_READS = {
    "charger_options": "device/acevse/more-setting/{station}",
    "charger_load_management": "device/acevse/more-setting/dlm/{station}",
    "charger_output": "device/acevse/more-setting/output-mode/{station}",
    "charger_offgrid": "device/acevse/more-setting/off-grid-charge/{station}",
}
STATION_READS = {
    "energy_saving": "device/owner/station/save-energy-mode/{station}",
    "service_provider": "device/owner/station/service-provider/{station}",
    "aggregator_allocation": "device/virtual-battery/setting/{station}",
}
CHARGER_READS = frozenset({"charger_schedules", "charger_records", "charger_ocpp", "charger_cards", "charger_auth", "charger_mode"})
SECTIONS = frozenset({"strategies", "profiles", "profile", "tariffs", "network", "preheating", "indicators", "energy_profile", "solar_priority", "backup_history", "backup_events"}) | CHARGER_READS | AC_READS.keys() | STATION_READS.keys()
PRIVATE_FIELD = re.compile(r"password|passwd|secret|token|credential|authorization|privatekey|certificate|rfidCardNumber|cardNumber|cardUid", re.I)


def safe_document(value, *, depth=0, budget=None):
    """Bound provider data and remove credentials before returning it to a UI."""
    budget = [12000] if budget is None else budget
    budget[0] -= 1
    if budget[0] < 0 or depth > 14:
        raise SafetyError("The native configuration exceeds the supported size")
    if value is None or type(value) in (bool, int):
        return value
    if type(value) is float and isfinite(value):
        return value
    if isinstance(value, str) and len(value) <= 4000:
        return value
    if isinstance(value, list) and len(value) <= 512:
        return [safe_document(item, depth=depth+1, budget=budget) for item in value]
    if isinstance(value, dict) and len(value) <= 256:
        return {key: safe_document(item, depth=depth+1, budget=budget) for key, item in value.items()
                if isinstance(key, str) and len(key) <= 120 and key not in ("__proto__", "constructor", "prototype")
                and not PRIVATE_FIELD.search(key)}
    raise SafetyError("The native configuration format is unsupported")


class PlantConfiguration:
    """One cache per runtime; no idle polling, extra login or write capability."""

    def __init__(self, client, station_id, *, inventory=lambda: [], clock=time.monotonic):
        self.client, self.station_id = client, str(station_id)
        self.inventory, self.clock = inventory, clock
        self.cache, self.retry_after = {}, {}

    def identity(self):
        if not self.station_id.isascii() or not self.station_id.isdecimal() or str(self.client.station_id) != self.station_id:
            raise SafetyError("The connected plant changed; reopen its configuration")

    def device(self, serial, kinds):
        rows = [row for row in self.inventory() if row.get("installed") is not False and row.get("type") in kinds]
        if serial is None and len(rows) == 1:
            serial = rows[0].get("serial") or rows[0].get("id")
        matches = [row for row in rows if serial and serial == (row.get("serial") or row.get("id"))]
        if len(matches) != 1 or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", str(serial)):
            raise CapabilityError("Select an exact installed device from this plant")
        return matches[0], serial

    async def get(self, path, **params):
        self.identity()
        value = await self.client._data("GET", path, **({"params": params} if params else {}))
        self.identity()
        return safe_document(value)

    async def read(self, section, *, serial=None, profile_id=None, page=1):
        if section not in SECTIONS:
            raise CapabilityError("Unknown native configuration section")
        if type(page) is not int or not 1 <= page <= 100000:
            raise SafetyError("Select a valid native history page")
        if page != 1 and section not in ("charger_records", "backup_history", "backup_events"):
            raise SafetyError("This configuration is not paginated")
        self.identity()
        if section in CHARGER_READS or section in AC_READS or section == "network":
            kinds = ("inverter", "ac") if section == "network" else ("ac",) if section in AC_READS else ("ac", "dc")
            _, serial = self.device(serial, kinds)
        key = section, serial, profile_id, page
        now = self.clock()
        if key in self.cache and now-self.cache[key][0] < 300:
            return deepcopy(self.cache[key][1])
        if now < self.retry_after.get(key, 0):
            raise CapabilityError("This configuration read is cooling down; retry later")
        # Validate identities even on cache hits: cached data is never shared
        # between plants or arbitrary device serials supplied by a service caller.
        try:
            station = int(self.station_id)
            if section == "strategies":
                current = await self.get(f"device/energy-profile/mode/current/{station}")
                mode = current.get("currentMode") if isinstance(current, dict) else None
                if type(mode) is not int or mode not in (0, 1, 2, 5, 7, 9):
                    raise SafetyError("The active native operating mode is unknown")
                # Native app uses POST for this query. It is a fixed list/read
                # operation, not a rule-save, switch or activation endpoint.
                self.identity()
                rules = await self.client._data("POST", "aipv-biz/api/v1/sigenai/personalization/rules",
                                                json={"stationId": station, "workingMode": mode})
                self.identity()
                rules = safe_document(rules)
                items = rules.get("personalizationRulesList") if isinstance(rules, dict) else None
                if not isinstance(items, list) or any(not isinstance(row, dict) for row in items):
                    raise SafetyError("The plant did not return its personal strategies")
                value = {"rules": items, "current": current}
            elif section == "profiles":
                modes = await self.get(f"device/energy-profile/mode/all/{station}")
                current = await self.get(f"device/energy-profile/mode/current/{station}")
                profiles = modes.get("energyProfileItems") if isinstance(modes, dict) else None
                if not isinstance(profiles, list) or any(not isinstance(row, dict) for row in profiles):
                    raise SafetyError("The plant did not return its strategy list")
                value = {"profiles": profiles, "current": current}
            elif section == "profile":
                if type(profile_id) is not int or profile_id <= 0:
                    raise SafetyError("Select an advertised plant strategy")
                catalogue = await self.read("profiles")
                if profile_id not in [row.get("profileId") for row in catalogue["value"]["profiles"]]:
                    raise SafetyError("The selected strategy belongs to another plant or no longer exists")
                value = await self.get(f"device/energy-profile/setting/info/{station}", profileId=profile_id, mode=9)
            elif section == "tariffs":
                value = {
                    "plan": await self.get(f"electricity-price/api/tariff/config/station/detail/{station}"),
                    "currency": await self.get(f"electricity-price/api/station/config/country-currency/{station}"),
                    "taxes_and_fees": await self.get(f"electricity-price/api/tax-and-fee/{station}"),
                }
            elif section == "energy_profile":
                value = await self.get(f"device/energy-profile/setting/{station}")
            elif section == "solar_priority":
                profile = (await self.read("energy_profile"))["value"]
                value = profile.get("pvPriority") if isinstance(profile, dict) else None
                if not isinstance(value, list):
                    raise SafetyError("The plant did not return its solar priority groups")
            elif section in STATION_READS:
                value = await self.get(STATION_READS[section].format(station=station))
            elif section in ("backup_history", "backup_events"):
                path = "data-process/station/backup-history" if section == "backup_history" else "data-process/station/backup-event"
                value = await self.get(path, stationId=station, current=page, size=50)
            elif section in AC_READS:
                value = await self.get(AC_READS[section].format(station=station), snCode=serial)
                if section == "charger_options":
                    value = {"settings": value, "parameters": await self.get("device/acevse/param", stationId=station, snCode=serial)}
            elif section in CHARGER_READS:
                device, serial = self.device(serial, ("ac", "dc"))
                family = "acevse" if device["type"] == "ac" else "dcevse"
                if section == "charger_schedules":
                    value = await self.get(f"device/{family}/schedule/list/{station}", snCode=serial)
                    if not isinstance(value, list):
                        raise SafetyError("The plant did not return a charger schedule list")
                elif section == "charger_records":
                    path = "device/acevse/charge/record/page" if family == "acevse" else "data-process/dcevse/record/page"
                    value = await self.get(path, stationId=station, snCode=serial, current=page, size=50)
                elif section == "charger_ocpp":
                    value = await self.get(f"device/{family}/ocpp/status", stationId=station, snCode=serial)
                elif section == "charger_cards":
                    path = f"device/acevse/card/v1/list/{station}" if family == "acevse" else f"device/dcevse/card/list/{station}"
                    cards = await self.get(path, snCode=serial)
                    auth = f"device/acevse/authentication/mode/{station}" if family == "acevse" else f"device/dcevse/auth/mode/{station}"
                    value = {"cards": cards, "authentication_mode": await self.get(auth, snCode=serial)}
                elif section == "charger_mode":
                    value = await self.get(f"device/charge/mode/{'ac' if family == 'acevse' else 'dc'}", stationId=station, snCode=serial)
                else:
                    path = f"device/acevse/authentication/mode/{station}" if family == "acevse" else f"device/dcevse/auth/mode/{station}"
                    value = await self.get(path, snCode=serial)
            elif section == "network":
                device, serial = self.device(serial, ("inverter", "ac"))
                path = "device/aio/network/read" if device["type"] == "inverter" else "device/acevse/network/read"
                field = "aioSnCode" if device["type"] == "inverter" else "snCode"
                value = await self.get(path, **{"stationId": station, field: serial})
            elif section == "preheating":
                value = await self.get(f"device/dischargesetting/packPreheating/new/{station}", stationId=station)
            else:
                # The owner client distinguishes the front light (0) and
                # strip lighting (1). Omitting type does not read either one
                # reliably and must not become an invented default setting.
                value = {
                    "front": await self.get("device/station/light-board/light/info", stationId=station, type=0),
                    "strips": await self.get("device/station/light-board/light/info", stationId=station, type=1),
                }
            result = {"section": section, "value": value, "source": "cloud", "serial": serial, "page": page,
                      "observed_at": datetime.now(timezone.utc).isoformat(), "read_only": True}
            if len(self.cache) >= 128:
                del self.cache[next(iter(self.cache))]
            self.cache[key] = self.clock(), deepcopy(result)
            return result
        except Exception:
            self.retry_after[key] = self.clock()+300
            raise
