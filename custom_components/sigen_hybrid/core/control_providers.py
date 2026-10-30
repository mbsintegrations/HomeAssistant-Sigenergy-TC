"""Closed, identity-bound plant setting providers for the recovery journal.

Cloud payloads follow the pinned sigenergy-cloud client's owner operations.
Reads and writes use the immutable selected station, never a mutable SDK default.
Installer settings, arbitrary URLs/registers and blind write retries are absent.
"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from math import isfinite

from .errors import CapabilityError, ConfirmationError, SafetyError, TransportError
from .models import validate_duration_minutes
from .recovery import canonical


def boolean(value):
    if type(value) is not bool:
        raise SafetyError("The provider did not return an explicit boolean setting")
    return value


def number(value):
    if type(value) not in (int, float) or not isfinite(value):
        raise SafetyError("A finite numeric setting is required")
    return value


def percent(value, *, optional=False):
    """Normalize numeric strings without truncating existing fractional SOCs."""
    if optional and value in (None, ""):
        return None
    if type(value) not in (int, float, str):
        raise SafetyError("A valid battery SOC value is required")
    try:
        parsed = Decimal(str(value))
    except InvalidOperation:
        raise SafetyError("A valid battery SOC value is required") from None
    if not parsed.is_finite() or not 0 <= parsed <= 100:
        raise SafetyError("Battery SOC is outside its valid range")
    return int(parsed) if parsed == parsed.to_integral_value() else float(parsed)


class CloudControlSettings:
    """Owner API settings with explicit station identity and fresh readback."""

    release_on_conflict = ("manual",)

    KEYS = frozenset(
        {
            "native_mode",
            "manual",
            "battery_export_block",
            "battery_levels",
            "grid_connection",
            "ac_charging",
            "dc_charging",
            "grid_export_limit",
            "grid_import_limit",
        }
    )

    def __init__(
        self,
        client,
        station_id,
        *,
        native_modes=(),
        profiles=(),
        clock=None,
        gateway=False,
        ac_serial=None,
        dc_serial=None,
        sleep=asyncio.sleep,
        region=None,
    ):
        station_id = str(station_id)
        if not station_id.isascii() or not station_id.isdecimal() or int(station_id) <= 0:
            raise ValueError("An explicitly selected cloud station is required")
        self.client, self.station_id = client, station_id
        if region is not None and region not in ("eu", "us", "apac", "cn"):
            raise ValueError("Unknown cloud region")
        self.region = region
        self.native_modes, self.profiles = frozenset(native_modes), frozenset(profiles)
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self._export_state = None
        self._battery_state = None
        self._grid_limits = {}
        self.gateway = gateway is True
        self.devices = {}
        self.sleep = sleep
        for kind, serial in (("ac_charging", ac_serial), ("dc_charging", dc_serial)):
            if serial is not None:
                if not isinstance(serial, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", serial):
                    raise ValueError("An exact discovered charger identity is required")
                self.devices[kind] = serial

    async def identity(self):
        return f"cloud:{self.region + ':' if self.region else ''}{self.client.station_id}"

    def validate(self, key, value):
        if key not in self.KEYS:
            raise SafetyError("This cloud setting is not in the owner-control allowlist")
        if key in ("grid_export_limit", "grid_import_limit"):
            if not isinstance(value, dict) or set(value) != {"enabled", "limit_kw"}:
                raise SafetyError("An enabled flag and finite grid power limit are required")
            boolean(value["enabled"])
            if not 0 <= number(value["limit_kw"]) <= 4_294_967.295:
                raise SafetyError("Grid power limit is outside the protocol range")
        elif key in ("battery_export_block", "grid_connection", "ac_charging", "dc_charging"):
            boolean(value)
            if key == "grid_connection" and not self.gateway or key.endswith("_charging") and key not in self.devices:
                raise CapabilityError("This control requires its discovered system device")
        elif key == "native_mode":
            if not isinstance(value, dict) or set(value) != {"mode", "profile_id"}:
                raise SafetyError("Mode and profile identity are required")
            mode, profile = value["mode"], value["profile_id"]
            if type(mode) is not int or type(profile) is not int:
                raise SafetyError("Mode and profile identities must be integers")
            if mode not in self.native_modes or mode == 9 and profile not in self.profiles:
                raise SafetyError("The selected operating mode/profile is not advertised by this plant")
        elif key == "battery_levels":
            fields = {"charge_soc", "discharge_soc", "peak_shaving_soc", "backup_soc"}
            if not isinstance(value, dict) or not fields <= set(value) or set(value) - fields - {"ja12_soc"}:
                raise SafetyError("All existing battery SOC settings must be preserved")
            for field in fields:
                item = value[field]
                if field == "peak_shaving_soc" and item is None:
                    continue
                if type(item) not in (int, float) or not 0 <= number(item) <= 100:
                    raise SafetyError("Battery SOC settings must be finite percentages")
            if "ja12_soc" in value:
                percent(value["ja12_soc"], optional=True)
            if not value["discharge_soc"] < value["charge_soc"] or value["backup_soc"] > value["charge_soc"]:
                raise SafetyError("Battery SOC settings conflict")
        else:
            if not isinstance(value, dict) or "enabled" not in value:
                raise SafetyError("Explicit manual control state is required")
            boolean(value["enabled"])
            if not value["enabled"]:
                if set(value) != {"enabled"}:
                    raise SafetyError("Disabled manual control must not change other settings")
                return
            if set(value) != {"enabled", "mode", "duration_minutes", "power_kw", "expected_end_time"}:
                raise SafetyError("Complete timed manual control settings are required")
            if value["mode"] not in ("0", "1", "2", "3"):
                raise SafetyError("Unknown native manual control mode")
            try:
                validate_duration_minutes(value["duration_minutes"])
            except ValueError:
                raise SafetyError("Manual duration must be 1–1440 whole minutes") from None
            number(value["expected_end_time"])
            power = value["power_kw"]
            if value["mode"] in ("0", "1"):
                if power is None or not 0.001 <= number(power) <= 1_000_000:
                    raise SafetyError("Charging/discharging needs an explicit positive kW limit")
                if abs(power * 1000 - round(power * 1000)) > 1e-6:
                    raise SafetyError("Power must be expressible in whole watts")
            elif power is not None:
                raise SafetyError("Hold/self-consumption do not accept a power setpoint")

    async def _request(self, method, path, **kwargs):
        try:
            if method == "GET":
                return await self.client._data(method, path, **kwargs)
            return await self.client._envelope(method, path, **kwargs)
        except Exception:
            # The provider may include account data in its original error text.
            raise TransportError("Cloud setting request failed; reconcile before retrying") from None

    async def export_block_state(self):
        """Native UI: True BLOCKS battery export; owner/installer flags may be unset."""
        data = await self._request("GET", f"device/energy-profile/battery/export/limitation/{self.station_id}")
        state = {"currentEnable": boolean(data["currentEnable"])}
        for field in ("ownerSetEnable", "installerSetEnable"):
            if field not in data:
                raise SafetyError("Battery export restriction metadata is incomplete")
            value = data[field]
            state[field] = None if value is None else boolean(value)
        self._export_state = state
        return dict(state)

    async def gateway_state(self):
        if not self.gateway:
            raise CapabilityError("No gateway was discovered for this plant")
        data = await self._request("GET", "device/gateway/gateway-status", params={"stationId": int(self.station_id)})
        state = data.get("onOffGridStatus")
        if type(state) is not int or state not in (0, 1, 2, 3):
            raise SafetyError("Gateway connection state is unknown")
        return data

    async def charger_state(self, key):
        if key not in self.devices:
            raise CapabilityError("No matching charger was discovered for this plant")
        family = "acevse" if key == "ac_charging" else "dcevse"
        path = f"device/{family}/charge/status" if key == "ac_charging" else "device/dcevse/status"
        status = await self._request(
            "GET", path, params={"stationId": int(self.station_id), "snCode": self.devices[key]}
        )
        if type(status) is not int or status not in (*range(11), 44):
            raise SafetyError("Charger state is unknown")
        if key == "dc_charging" and status == 8:
            raise SafetyError("Vehicle-to-grid discharge cannot be changed through charging controls")
        return status

    def preflight(self, changes, baseline):
        if any(key == "battery_export_block" and value is False for key, value in changes):
            if self._export_state is None or self._export_state["installerSetEnable"] is True:
                raise SafetyError("An installer battery-export restriction cannot be cleared")
        for key, value in changes:
            if key == "battery_levels":
                self._preserve_extra_soc(value, baseline[key])
            elif key in ("grid_export_limit", "grid_import_limit"):
                data = self._grid_limits.get(key)
                if not data:
                    raise SafetyError("Fresh installer grid-limit metadata is required")
                maximum = data.get("maxLimitationInstaller")
                try:
                    maximum = float(maximum)
                except (TypeError, ValueError):
                    raise SafetyError("The installer grid limit is unknown") from None
                if not isfinite(maximum) or not 0 <= maximum < 4_294_967.294:
                    raise SafetyError("A verified installer grid ceiling is required")
                if value["enabled"] and value["limit_kw"] > maximum:
                    raise SafetyError("The requested grid limit exceeds the installer ceiling")

    @staticmethod
    def _preserve_extra_soc(desired, current):
        if ("ja12_soc" in desired) != ("ja12_soc" in current) or (
            "ja12_soc" in desired and canonical(desired["ja12_soc"]) != canonical(current["ja12_soc"])
        ):
            raise SafetyError("The additional SOC setting must remain unchanged")

    def recovery_metadata(self):
        # The web UI restores the effective switch value, not an unset owner's
        # provenance or the vendor's modification history. Preserve that evidence.
        result = {"battery_export_block": dict(self._export_state)} if self._export_state is not None else {}
        if self._battery_state is not None:
            result["battery_levels"] = dict(self._battery_state)
        if self.devices:
            result["devices"] = dict(self.devices)
        if self._grid_limits:
            result["grid_limits"] = {key: dict(value) for key, value in self._grid_limits.items()}
        return result

    async def read(self, keys):
        result = {}
        for key in keys:
            if key not in self.KEYS:
                raise SafetyError("Unknown cloud control setting")
            if key in ("grid_export_limit", "grid_import_limit"):
                direction = "export" if key == "grid_export_limit" else "import"
                data = await self._request("GET", f"device/energy-profile/grid/limitation/{direction}/{self.station_id}")
                self._grid_limits[key] = dict(data)
                raw = data.get("maxLimitationOwner")
                if raw in (None, ""):
                    raw = data.get("maxLimitation")
                try:
                    limit = float(raw)
                except (TypeError, ValueError):
                    raise SafetyError("The current owner grid limit is unknown") from None
                result[key] = {"enabled": boolean(data["enable"]), "limit_kw": number(limit)}
                self.validate(key, result[key])
            elif key == "native_mode":
                data = await self._request("GET", f"device/energy-profile/mode/current/{self.station_id}")
                result[key] = {"mode": data["currentMode"], "profile_id": data["currentProfileId"]}
            elif key == "battery_export_block":
                result[key] = (await self.export_block_state())["currentEnable"]
            elif key == "battery_levels":
                data = await self._request("GET", f"device/energy-profile/battery/level/{self.station_id}")
                self._battery_state = {
                    field: data[field]
                    for field in ("chargeSOC", "dischargeSOC", "peakShavingSOC", "backupSOC", "ja12SOC")
                    if field in data
                }
                result[key] = {
                    "charge_soc": percent(data["chargeSOC"]),
                    "discharge_soc": percent(data["dischargeSOC"]),
                    "peak_shaving_soc": percent(data["peakShavingSOC"], optional=True),
                    "backup_soc": percent(data["backupSOC"]),
                }
                if "ja12SOC" in data:
                    percent(data["ja12SOC"], optional=True)
                    result[key]["ja12_soc"] = data["ja12SOC"]  # Preserve-only, not an editable option.
            elif key == "grid_connection":
                result[key] = (await self.gateway_state())["onOffGridStatus"] == 0
            elif key in ("ac_charging", "dc_charging"):
                result[key] = await self.charger_state(key) == 3
            else:
                data = await self._request("GET", f"device/energy-profile/instant/manunal/{self.station_id}")
                enabled = boolean(data["enable"])
                if not enabled:
                    result[key] = {"enabled": False}
                    continue
                mode, end = str(data["mode"]), float(data["endTime"])
                if mode not in ("0", "1", "2", "3") or not isfinite(end) or end <= 0:
                    raise SafetyError("Native manual state is incomplete")
                if end > 10_000_000_000:
                    end /= 1000
                value = {"enabled": True, "mode": mode, "end_time": end}
                raw_power = data.get("powerLimitation")
                if raw_power not in (None, ""):
                    value["power_kw"] = number(float(raw_power))
                result[key] = value
        return result

    async def write_checked(self, key, value, expected, *, context=None, before_send=None):
        """Recheck the owner value immediately before dispatch, including rollback."""
        current = (await self.read([key]))[key]
        if canonical(current) != canonical(expected):
            raise SafetyError("The owner changed this setting before dispatch")
        if key in ("grid_export_limit", "grid_import_limit"):
            self.preflight([(key, value)], {key: current})
        if key == "manual" and value.get("enabled") is True and value.get("mode") == "1":
            if not isinstance(context, dict) or type(context.get("export_requested")) is not bool:
                raise SafetyError("Discharge needs an explicit home/grid destination")
            state = await self.export_block_state()
            if state["currentEnable"] is not (not context["export_requested"]):
                raise SafetyError("Battery export protection changed before discharge")
            if context["export_requested"]:
                self.preflight([("battery_export_block", False)], {})
        if key == "manual" and value.get("enabled") is True and context and context.get("deadline"):
            deadline = datetime.fromisoformat(context["deadline"])
            remaining = int((deadline-self.clock()).total_seconds() // 60)
            if remaining < 1:
                raise SafetyError("The strategy window ended before dispatch")
            value = {**value, "duration_minutes": min(value["duration_minutes"], remaining)}
            value["expected_end_time"] = self.clock().timestamp()+value["duration_minutes"]*60
        if before_send is not None:
            await before_send(value)
        await self.write(key, value, expected_current=current)

    async def prepare_recovery(self, record):
        """Rebind the exact selected device/mode before post-restart restoration."""
        from .control_telemetry import validate_owner_station
        from .owner_settings import mode_catalogue

        key = record.get("context", {}).get("key")
        if key not in ("native_mode", "grid_connection", "ac_charging", "dc_charging"):
            return
        station = validate_owner_station(
            await self._request("GET", "device/owner/station/home"), self.station_id, require_normal=False,
        )
        if key == "native_mode":
            catalogue = mode_catalogue(await self._request("GET", f"device/energy-profile/mode/all/{self.station_id}"))
            self.mode_options = catalogue
            self.native_modes = frozenset(item["mode"] for item in catalogue)
            self.profiles = frozenset(item["profile_id"] for item in catalogue if item["mode"] == 9)
        elif key == "grid_connection":
            if station.get("hasGateway") is not True:
                raise SafetyError("The original gateway is not present for recovery")
            self.gateway = True
        else:
            kind = "ac" if key == "ac_charging" else "dc"
            serial = record.get("provider_metadata", {}).get("devices", {}).get(key)
            serials = station.get(f"{kind}SnList")
            present = station.get("hasAcCharger" if kind == "ac" else "hasEv") is True
            if not present or not isinstance(serials, list) or not serial or serial not in serials:
                raise SafetyError("The original charger is not present for recovery")
            bound = type(self)(self.client, self.station_id, **{"ac_serial" if kind == "ac" else "dc_serial": serial})
            self.devices[key] = bound.devices[key]

    async def write(self, key, value, *, expected_current=None):
        self.validate(key, value)
        station = int(self.station_id)  # Immutable binding, even if background reads change SDK.station_id.
        if key in ("grid_export_limit", "grid_import_limit"):
            direction = "export" if key == "grid_export_limit" else "import"
            await self._request("PUT", f"device/energy-profile/grid/limitation/{direction}", json={
                "stationId": station, "enable": value["enabled"],
                "maxLimitationOwner": f"{value['limit_kw']:.3f}", "maxLimitationInstaller": None,
            })
        elif key == "native_mode":
            await self._request(
                "PUT",
                "device/energy-profile/mode",
                json={"stationId": station, "operationMode": value["mode"], "profileId": value["profile_id"]},
            )
        elif key == "battery_export_block":
            if value is False:
                await self.export_block_state()
                self.preflight([(key, value)], {})
            await self._request(
                "PUT",
                "device/energy-profile/battery/export/limitation",
                json={"stationId": station, "installerSetEnable": None, "ownerSetEnable": value},
            )
        elif key == "battery_levels":
            current = (await self.read([key]))[key]
            if expected_current is not None and canonical(current) != canonical(expected_current):
                raise SafetyError("The owner changed the battery limits before dispatch")
            self._preserve_extra_soc(value, current)
            payload = {
                "stationId": station,
                "chargeSOC": format(Decimal(str(value["charge_soc"])), "f"),
                "dischargeSOC": format(Decimal(str(value["discharge_soc"])), "f"),
                "peakShavingSOC": None
                if value["peak_shaving_soc"] is None
                else format(Decimal(str(value["peak_shaving_soc"])), "f"),
                "backupSOC": format(Decimal(str(value["backup_soc"])), "f"),
            }
            # The native battery-level DTO sends only these four thresholds.
            # ja12SOC is returned by GET but written by another owner operation;
            # retain its original value in recovery evidence, never set it here.
            await self._request(
                "PUT",
                "device/energy-profile/battery/level",
                json=payload,
            )
        elif key == "grid_connection":
            state = await self.gateway_state()
            if state["onOffGridStatus"] == 1:
                raise SafetyError("Automatic outage operation cannot be overridden")
            if state.get("showButton") is not True:
                raise SafetyError("The gateway is not advertising owner switching permission")
            if state["onOffGridStatus"] not in (0, 2):
                raise SafetyError("Generator islanding needs its own native control workflow")
            if (state["onOffGridStatus"] == 0) == value:
                return
            response = await self._request(
                "POST",
                "device/gateway/ongrid-state/update",
                json={"stationId": station, "onGridState": 0 if value else 1},
            )
            if type(response.get("data")) is not int or response["data"] != 0:
                raise ConfirmationError("Gateway did not acknowledge the requested switch")
            for attempt in range(4):
                actual = await self.gateway_state()
                if actual["onOffGridStatus"] in (0, 2) and (actual["onOffGridStatus"] == 0) == value:
                    return
                if attempt != 3:
                    await self.sleep(2)
            raise ConfirmationError("Gateway switch was requested but its state is not yet confirmed")
        elif key in ("ac_charging", "dc_charging"):
            await self.charger_state(key)
            family = "acevse" if key == "ac_charging" else "dcevse"
            response = await self._request(
                "PUT",
                f"device/{family}/charge/start",
                params={"stationId": station, "snCode": self.devices[key], "enable": 0 if value else 1},
            )
            data = response.get("data")
            if not isinstance(data, dict) or data.get("successful") is not True:
                raise ConfirmationError("Charger did not acknowledge the requested action")
        else:
            enabled = value["enabled"]
            await self._request(
                "PUT",
                "device/energy-profile/instant/manunal",
                json={
                    "stationId": station,
                    "enable": enabled,
                    "mode": value["mode"] if enabled else "",
                    "duration": str(value["duration_minutes"]) if enabled else "",
                    "powerLimitation": f"{value['power_kw']:.3f}" if enabled and value["power_kw"] is not None else "",
                },
            )

    def validate_restore(self, key, value):
        if key == "manual":
            if not isinstance(value, dict) or type(value.get("enabled")) is not bool:
                raise SafetyError("Native manual state is incomplete")
            return  # Release to the native strategy; never replay an older timed command.
        self.validate(key, value)

    async def restore(self, key, value):
        self.validate_restore(key, value)
        await self.write(key, {"enabled": False} if key == "manual" else False if key.endswith("_charging") else value)

    async def restore_checked(self, key, value, expected):
        self.validate_restore(key, value)
        target = {"enabled": False} if key == "manual" else False if key.endswith("_charging") else value
        await self.write_checked(key, target, expected)

    @staticmethod
    def matches_restored(key, original, observed):
        if canonical(original) == canonical(observed):
            return True
        if key == "manual":
            return observed == {"enabled": False}
        if key.endswith("_charging"):
            return observed is False  # Recovery may stop; it must never resume a charging session.
        return False

    @staticmethod
    def matches_attempt(key, requested, observed, attempted_at):
        if key == "manual" and requested.get("enabled") is True and attempted_at:
            requested = {
                **requested,
                "expected_end_time": datetime.fromisoformat(attempted_at).timestamp()
                + requested["duration_minutes"] * 60,
            }
        return CloudControlSettings.matches(key, requested, observed)

    @staticmethod
    def command_expiry(record):
        step = next(
            (step for step in record["steps"] if step["key"] == "manual" and step["requested"].get("enabled") is True),
            None,
        )
        if step and step.get("after", {}).get("end_time"):
            expiry = datetime.fromtimestamp(step["after"]["end_time"], timezone.utc)
            deadline = record.get("context", {}).get("deadline")
            if deadline and expiry > datetime.fromisoformat(deadline):
                raise ConfirmationError("The provider expiry exceeded the strategy window; recovery is required")
            return expiry
        return None

    @staticmethod
    def matches(key, requested, observed):
        if key in ("grid_export_limit", "grid_import_limit"):
            return requested["enabled"] is observed.get("enabled") and abs(requested["limit_kw"]-observed["limit_kw"]) <= 0.0005
        if key != "manual" or not requested["enabled"]:
            return canonical(requested) == canonical(observed)
        if observed.get("enabled") is not True or observed.get("mode") != requested["mode"]:
            return False
        if abs(observed.get("end_time", 0) - requested["expected_end_time"]) > 90:
            return False
        if "power_kw" in observed and requested["power_kw"] is not None:
            return abs(observed["power_kw"] - requested["power_kw"]) <= 0.0005
        # The API sometimes reports only mode/endTime. Callers must state that
        # power-limit readback is unavailable, not claim that field was verified.
        return True


class ModbusControlSettings:
    """Four remote-EMS settings only; reserve/export/grid-code settings stay out."""

    KEYS = frozenset({"remote_ems", "remote_mode", "charge_limit_kw", "discharge_limit_kw"})

    def __init__(self, transport, identity_reader, *, max_charge_kw, max_discharge_kw):
        self.transport, self.identity_reader = transport, identity_reader
        self.max_charge_kw, self.max_discharge_kw = max_charge_kw, max_discharge_kw

    async def identity(self):
        return await self.identity_reader()

    def validate(self, key, value):
        if key not in self.KEYS:
            raise SafetyError("This Modbus setting is not in the control allowlist")
        if key == "remote_ems":
            boolean(value)
        elif key == "remote_mode":
            if type(value) is not int or value not in (0, 1, 2, 3, 4, 5, 6):
                raise SafetyError("Unsupported remote EMS mode")
        else:
            maximum = self.max_charge_kw if key == "charge_limit_kw" else self.max_discharge_kw
            if not 0 <= number(value) <= number(maximum):
                raise SafetyError("Requested power limit exceeds the verified equipment limit")
            if abs(value * 1000 - round(value * 1000)) > 1e-6:
                raise SafetyError("Modbus power limit must be expressible in whole watts")

    async def read(self, keys):
        result = {}
        for key in keys:
            if key not in self.KEYS:
                raise SafetyError("Unknown Modbus control setting")
            value = await self.transport.read(key)
            if key == "remote_ems":
                if value not in (0, 1):
                    raise SafetyError("Remote EMS enable returned an invalid value")
                value = value == 1
            elif key == "remote_mode":
                value = int(value)
            result[key] = value
        return result

    async def write(self, key, value):
        self.validate(key, value)
        await self.transport.write_confirmed(key, int(value) if key == "remote_ems" else value)

    def validate_restore(self, key, value):
        if key in ("charge_limit_kw", "discharge_limit_kw") and value == 4_294_967.295:
            return  # Exact pre-existing uint32 unlimited marker, never a user setpoint.
        self.validate(key, value)

    async def restore(self, key, value):
        self.validate_restore(key, value)
        await self.transport.write_confirmed(key, int(value) if key == "remote_ems" else value)

    @staticmethod
    def matches(key, requested, observed):
        if key.endswith("_kw"):
            return abs(requested - observed) <= 0.0005
        return canonical(requested) == canonical(observed)
