"""UI-only setup; no auto-discovery or production connection by default."""

from __future__ import annotations

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import selector

from .cloud_client import async_create_cloud_client
from .const import DOMAIN
from .core.cloud import async_discover_station
from .core.connections import enabled_connections
from .core.errors import AuthenticationError, CloudLoginFailure, TransportError
from .core.forecasts import PROVIDERS
from .core.models import SafetyLimits
from .forecast import provider_entries


async def async_cloud_login(hass, credentials, *, reauthenticate=False):
    """Authenticate and discover the account plant without asking for its ID."""
    try:
        client = (
            await async_create_cloud_client(hass, credentials, reauthenticate=True)
            if reauthenticate
            else (await async_create_cloud_client(hass, credentials))
        )
        return await async_discover_station(client)
    except AuthenticationError, TransportError, CloudLoginFailure:
        raise
    except Exception:
        raise CloudLoginFailure("cloud_login_failed") from None


def cloud_credentials(user_input, station_id):
    """Keep only credential fields and the internally discovered plant identity."""
    return {
        "region": user_input["region"],
        "username": user_input["username"].strip(),
        "password": user_input["password"],
        "unofficial_opt_in": user_input["unofficial_opt_in"],
        "station_id": station_id,
    }


def number_box(low, high, *, step="any", unit=None):
    options = {"min": low, "max": high, "step": step, "mode": selector.NumberSelectorMode.BOX}
    if unit is not None:
        options["unit_of_measurement"] = unit
    return selector.NumberSelector(selector.NumberSelectorConfig(**options))


def modbus_form_data(data):
    result = dict(data)
    for key in ("inverter_unit_id", "ac_charger_unit_id", "dc_charger_unit_id"):
        if key not in result:
            continue
        value = result[key]
        if value is None and key != "inverter_unit_id":
            continue
        if type(value) not in (int, float) or not float(value).is_integer() or not 1 <= value <= 246:
            raise ValueError("A whole device unit ID is required")
        result[key] = int(value)
    return result


def owner_limits_schema(current, enabled, *, local_enabled=None):
    automatic = current.get("max_charge_kw") is None and current.get("max_discharge_kw") is None
    return vol.Schema({
        vol.Required("enable_control", default=enabled): bool,
        **({vol.Required("enable_local_control", default=local_enabled): bool} if local_enabled is not None else {}),
        vol.Required("export_permitted", default=current.get("export_permitted", False)): bool,
        vol.Required("reserve_soc", default=current.get("reserve_soc", 20)): number_box(0, 99, unit="%"),
        vol.Required("charge_ceiling_soc", default=current.get("charge_ceiling_soc", 90)): number_box(1, 100, unit="%"),
        vol.Required("use_plant_power_limits", default=automatic): bool,
    })


def owner_limits_data(current, data):
    result = {**current, **{key: value for key, value in data.items() if key not in ("enable_control", "enable_local_control", "use_plant_power_limits")}}
    if data.get("use_plant_power_limits", not any(key in data for key in ("max_charge_kw", "max_discharge_kw"))):
        result.update(max_charge_kw=None, max_discharge_kw=None)
    SafetyLimits(**result)
    return result


def custom_power_schema(current):
    fields = {}
    for key in ("max_charge_kw", "max_discharge_kw"):
        value = current.get(key)
        default = {"default": value} if type(value) in (int, float) and 0 < value <= 100 else {}
        fields[vol.Required(key, **default)] = number_box(.001, 100, unit="kW")
    return vol.Schema(fields)


def forecast_choices(hass):
    return {f"{provider}:{entry.entry_id}": {"provider": provider, "entry_id": entry.entry_id,
            "label": f"{info['name']} · {entry.title}"}
            for provider, info in PROVIDERS.items() for entry in provider_entries(hass, provider)}


def forecast_setup_schema(hass, current):
    choices = forecast_choices(hass)
    sources = current.get("sources") or ([current] if current.get("entry_id") else [])
    selected = [f"{row['provider']}:{row['entry_id']}" for row in sources if f"{row['provider']}:{row['entry_id']}" in choices]
    options = [{"value": key, "label": row["label"]} for key, row in choices.items()]
    return vol.Schema({
        vol.Required("forecast_sources", default=selected): selector.SelectSelector(selector.SelectSelectorConfig(options=options, multiple=True)),
        vol.Required("average", default=current.get("average") is True): bool,
        vol.Optional("primary_source", default=current.get("primary_source", "")): selector.SelectSelector(selector.SelectSelectorConfig(
            options=[{"value": "", "label": "First selected provider"}]+options)),
    })


def forecast_setup_options(hass, data):
    choices = forecast_choices(hass)
    selected = data.get("forecast_sources", [])
    if not isinstance(selected, list) or any(not isinstance(key, str) for key in selected):
        raise ValueError("Choose configured forecast sources")
    primary = data.get("primary_source") or (selected[0] if selected else "")
    if (len(selected) > 2 or len(set(selected)) != len(selected)
            or any(key not in choices for key in selected) or selected and primary not in selected):
        raise ValueError("Choose up to two loaded forecasts covering the same panels")
    return {"provider": "ensemble" if selected else "none", "sources": [
        {"provider": choices[key]["provider"], "entry_id": choices[key]["entry_id"]} for key in selected],
        "average": data.get("average") is True, "primary_source": primary}


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_reauth(self, entry_data):
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input=None):
        entry = self._get_reauth_entry()
        cloud = entry.options.get("cloud", {})
        if not cloud.get("username") or not cloud.get("station_id"):
            return self.async_abort(reason="cloud_not_configured")
        errors = {}
        if user_input is not None:
            password = user_input.get("password", "")
            if not isinstance(password, str) or not password:
                errors["base"] = "cloud_fields_required"
            else:
                credentials = {**cloud, "password": password}
                try:
                    station = await async_cloud_login(self.hass, credentials, reauthenticate=True)
                    if station != str(cloud["station_id"]):
                        errors["base"] = "wrong_account"
                except CloudLoginFailure as err:
                    errors["base"] = err.reason
                except AuthenticationError:
                    errors["base"] = "invalid_auth"
                except TransportError:
                    errors["base"] = "cannot_connect"
                else:
                    if not errors:
                        return self.async_update_reload_and_abort(
                            entry, options={**entry.options, "cloud": cloud_credentials(credentials, station)}
                        )
        return self.async_show_form(
            step_id="reauth_confirm",
            errors=errors,
            data_schema=vol.Schema(
                {
                    vol.Required("password"): selector.TextSelector(
                        selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD, autocomplete="off")
                    )
                }
            ),
        )

    async def async_step_user(self, user_input=None):
        return self.async_show_menu(step_id="user", menu_options=["connections", "demo"])

    async def async_step_connections(self, user_input=None):
        errors = {}
        if user_input is not None:
            switches = {key: user_input.get(key, False) is True for key in ("modbus", "cloud")}
            if not any(switches.values()):
                errors["base"] = "connection_required"
            else:
                self._connection_choices = switches
                self._pending_title = "Sigenergy TC"
                self._pending_data = {"demo": False, "cloud_only": not switches["modbus"]}
                self._pending_options = {"connections": switches}
                if switches["modbus"]:
                    return await self.async_step_local()
                return await self.async_step_features()
        return self.async_show_form(
            step_id="connections",
            errors=errors,
            data_schema=vol.Schema(
                {vol.Required("modbus", default=True): bool, vol.Required("cloud", default=False): bool}
            ),
        )

    async def async_step_cloud_only(self, user_input=None):
        await self.async_set_unique_id("cloud-only")
        self._abort_if_unique_id_configured()
        self._pending_title = "Sigenergy TC Cloud (read-only)"
        self._pending_data = {"demo": False, "cloud_only": True}
        self._pending_options = {}
        return await self.async_step_features()

    async def async_step_demo(self, user_input=None):
        await self.async_set_unique_id("demo")
        self._abort_if_unique_id_configured()
        self._pending_title = "Sigenergy TC Demo"
        self._pending_data = {"demo": True}
        self._pending_options = {}
        return await self.async_step_features()

    async def async_step_local(self, user_input=None):
        errors = {}
        if user_input is not None:
            try:
                user_input = modbus_form_data(user_input)
            except ValueError:
                errors["inverter_unit_id"] = "invalid_inverter_unit"
                user_input = None
        if user_input is not None:
            host = user_input["host"].strip().lower()
            if not host or "/" in host or "://" in host:
                errors["host"] = "invalid_host"
            elif not (user_input["sole_modbus_client"] or user_input.get("shared_read_only") or user_input.get("allow_shared_writes")):
                errors["base"] = "competing_client"
            else:
                await self.async_set_unique_id(f"{host}:{user_input['port']}:247")
                self._abort_if_unique_id_configured()
                self._pending_title = "Sigenergy TC"
                self._pending_data = {**user_input, "host": host, "demo": False}
                self._pending_options = (
                    {"connections": self._connection_choices} if hasattr(self, "_connection_choices") else {}
                )
                return await self.async_step_features()
        return self.async_show_form(
            step_id="local",
            errors=errors,
            data_schema=vol.Schema(
                {
                    vol.Required("host"): str,
                    vol.Required("port", default=502): vol.All(vol.Coerce(int), vol.Range(min=1, max=65535)),
                    vol.Required("sole_modbus_client", default=False): bool,
                    vol.Optional("inverter_unit_id"): number_box(1, 246, step=1),
                    vol.Optional("ac_charger_unit_id"): number_box(1, 246, step=1),
                    vol.Optional("dc_charger_unit_id"): number_box(1, 246, step=1),
                    vol.Optional("allow_shared_writes", default=False): bool,
                    vol.Optional(
                        "shared_read_only",
                        default=self.config_entry.data.get("shared_read_only", False)
                        if hasattr(self, "config_entry")
                        else False,
                    ): bool,
                    vol.Optional("poll_seconds", default=60): vol.All(vol.Coerce(int), vol.Range(min=15, max=300)),
                }
            ),
        )

    async def async_step_features(self, user_input=None):
        errors = {}
        if user_input is not None and "forecast_sources" in user_input:
            try:
                forecast = forecast_setup_options(self.hass, user_input)
            except ValueError:
                errors["forecast_sources"] = "invalid_forecast_source"
            else:
                self._pending_options["forecast"] = forecast
                self._pending_options["optimizer_monitoring_planned"] = user_input.get("optimizer_monitoring", False)
                self._wizard_cloud = self._pending_options.get("connections", {}).get("cloud", user_input.get("cloud_reads", False)) and not self._pending_data["demo"]
                return await self._after_forecast()
            user_input = None
        instructions = "Choose no forecast to continue without one."
        if user_input is not None:
            provider = user_input["forecast_provider"]
            if provider != "none" and not provider_entries(self.hass, provider):
                info = PROVIDERS[provider]
                errors["forecast_provider"] = "forecast_provider_missing"
                instructions = f"{info['install']} [Installation guide]({info['url']})"
            else:
                self._pending_options["forecast"] = {"provider": provider}
                self._pending_options["optimizer_monitoring_planned"] = user_input["optimizer_monitoring"]
                choices = self._pending_options.get("connections", {})
                self._wizard_cloud = (
                    choices.get("cloud", user_input.get("cloud_reads", False)) and not self._pending_data["demo"]
                )
                return await self.async_step_wizard_forecast() if provider != "none" else await self._after_forecast()
        schema = dict(forecast_setup_schema(self.hass, self._pending_options.get("forecast", {})).schema)
        schema[vol.Required("optimizer_monitoring", default=False)] = bool
        if not self._pending_data["demo"] and not hasattr(self, "_connection_choices"):
            schema[vol.Required("cloud_reads", default=self._pending_data.get("cloud_only", False))] = bool
        return self.async_show_form(
            step_id="features",
            data_schema=vol.Schema(schema),
            errors=errors,
            description_placeholders={"instructions": instructions},
        )

    async def async_step_wizard_forecast(self, user_input=None):
        provider = self._pending_options["forecast"]["provider"]
        entries = provider_entries(self.hass, provider)
        errors = {}
        if user_input is not None:
            if provider in ("forecast_solar", "open_meteo_solar_forecast"):
                valid = user_input["entry_id"] in {e.entry_id for e in entries}
            else:
                registry = er.async_get(self.hass)
                valid = bool(user_input.get("entities")) and all(
                    (item := registry.async_get(entity_id)) is not None
                    and item.config_entry_id in {e.entry_id for e in entries}
                    and self.hass.states.get(entity_id) is not None
                    for entity_id in user_input["entities"]
                )
            if valid:
                self._pending_options["forecast"].update(user_input)
                return await self._after_forecast()
            errors["base"] = "invalid_forecast_source"
        if provider in ("forecast_solar", "open_meteo_solar_forecast"):
            schema = {
                vol.Required("entry_id"): selector.SelectSelector(
                    selector.SelectSelectorConfig(options=[{"value": e.entry_id, "label": e.title} for e in entries])
                )
            }
        else:
            schema = {
                vol.Required("entities"): selector.EntitySelector(
                    selector.EntitySelectorConfig(domain="sensor", multiple=True)
                )
            }
        return self.async_show_form(
            step_id="wizard_forecast",
            data_schema=vol.Schema(schema),
            errors=errors,
            description_placeholders={"provider_name": PROVIDERS[provider]["name"]},
        )

    async def _after_forecast(self):
        return await self.async_step_wizard_cloud() if self._wizard_cloud else await self._after_cloud()

    async def _after_cloud(self):
        return (
            await self.async_step_wizard_control()
            if self._pending_options.get("cloud") or self._pending_data.get("inverter_unit_id")
            else await self.async_step_dashboard()
        )

    async def async_step_wizard_control(self, user_input=None):
        errors = {}
        if user_input is not None:
            try:
                safety = owner_limits_data({}, user_input)
            except ValueError:
                errors["base"] = "invalid_safety_limits"
            else:
                self._pending_options["safety"] = safety
                self._pending_options["control"] = {"enabled": user_input["enable_control"] is True,
                    "local_enabled": user_input.get("enable_local_control") is True}
                if user_input.get("use_plant_power_limits") is False:
                    return await self.async_step_wizard_power_limits()
                return await self.async_step_dashboard()
        local_available = bool(self._pending_data.get("inverter_unit_id") and not self._pending_data.get("shared_read_only"))
        return self.async_show_form(step_id="wizard_control", errors=errors,
            data_schema=owner_limits_schema(self._pending_options.get("safety", {}), True, local_enabled=True if local_available else None))

    async def async_step_wizard_power_limits(self, user_input=None):
        errors = {}
        if user_input is not None:
            try:
                safety = {**self._pending_options["safety"], **user_input}
                SafetyLimits(**safety)
                if any(safety.get(key) is None for key in ("max_charge_kw", "max_discharge_kw")):
                    raise ValueError
            except ValueError:
                errors["base"] = "invalid_safety_limits"
            else:
                self._pending_options["safety"] = safety
                return await self.async_step_dashboard()
        return self.async_show_form(step_id="wizard_power_limits", errors=errors,
            data_schema=custom_power_schema(self._pending_options.get("safety", {})))

    async def async_step_wizard_cloud(self, user_input=None):
        errors = {}
        if user_input is not None:
            if not user_input["enable"] and not self._pending_data.get("host"):
                errors["base"] = "connection_required"
            elif not user_input["enable"]:
                if "connections" in self._pending_options:
                    self._pending_options["connections"]["cloud"] = False
                return await self._after_cloud()
            if not user_input["unofficial_opt_in"]:
                errors["base"] = "cloud_opt_in_required"
            elif not all(str(user_input.get(key, "")).strip() for key in ("username", "password")):
                errors["base"] = "cloud_fields_required"
            else:
                try:
                    station_id = await async_cloud_login(self.hass, user_input)
                except CloudLoginFailure as err:
                    errors["base"] = err.reason
                except AuthenticationError:
                    errors["base"] = "invalid_auth"
                except TransportError:
                    errors["base"] = "cannot_connect"
                else:
                    self._pending_options["cloud"] = cloud_credentials(user_input, station_id)
                    return await self._after_cloud()
        return self.async_show_form(
            step_id="wizard_cloud",
            errors=errors,
            data_schema=vol.Schema(
                {
                    vol.Required("enable", default=True): bool,
                    vol.Required("region", default="eu"): vol.In(["eu", "us", "apac", "cn"]),
                    vol.Optional("username", default=""): selector.TextSelector(
                        selector.TextSelectorConfig(autocomplete="off")
                    ),
                    vol.Optional("password", default=""): selector.TextSelector(
                        selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD, autocomplete="off")
                    ),
                    vol.Required("unofficial_opt_in", default=False): bool,
                }
            ),
        )

    async def async_step_dashboard(self, user_input=None):
        if user_input is not None:
            self._pending_options["dashboard"] = user_input
            return await self.async_step_review()
        return self.async_show_form(
            step_id="dashboard",
            data_schema=vol.Schema(
                {
                    vol.Required("preset", default="overview"): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=[
                                {"value": "overview", "label": "Complete overview with tabs"},
                                {"value": "house", "label": "Original house card"},
                                {"value": "flow", "label": "Simple energy flow"},
                                {"value": "individual", "label": "Individual cards"},
                            ]
                        )
                    ),
                    vol.Required("main_display", default="photo"): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=[
                                {"value": "house", "label": "House"},
                                {"value": "flow", "label": "Flow"},
                                {"value": "photo", "label": "Photo house"},
                            ]
                        )
                    ),
                    vol.Required("appearance", default="auto"): vol.In(["auto", "day", "night", "theme"]),
                    vol.Required("charts", default=["power", "tariff", "statistics"]): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            multiple=True,
                            options=[
                                {"value": "power", "label": "Power metrics"},
                                {"value": "tariff", "label": "Battery SOC and tariff prices"},
                                {"value": "statistics", "label": "Metered energy statistics"},
                                {"value": "solar_chart", "label": "Solar power chart"},
                                {"value": "load_chart", "label": "Household load chart"},
                                {"value": "battery_chart", "label": "Battery discharge and charge chart"},
                                {"value": "grid_chart", "label": "Grid import and export chart"},
                            ],
                        )
                    ),
                }
            ),
        )

    async def async_step_review(self, user_input=None):
        if user_input is not None:
            if hasattr(self, "_connection_choices") and not self._pending_data.get("host"):
                from hashlib import sha256

                cloud = self._pending_options.get("cloud", {})
                identity = cloud["station_id"]
                await self.async_set_unique_id("hybrid:" + sha256(identity.encode()).hexdigest())
                self._abort_if_unique_id_configured()
            return self.async_create_entry(
                title=self._pending_title, data=self._pending_data, options=self._pending_options
            )
        return self.async_show_form(
            step_id="review",
            data_schema=vol.Schema({}),
            description_placeholders={
                "connection": "Isolated Demo"
                if self._pending_data["demo"]
                else "Cloud only, no Modbus connection"
                if self._pending_data.get("cloud_only")
                else "Local Modbus",
                "cloud": "Optional app-cloud reads" if "cloud" in self._pending_options else "Disabled",
                "forecast": self._pending_options["forecast"]["provider"],
                "dashboard": self._pending_options["dashboard"]["preset"],
                "writes": "Enabled" if self._pending_options.get("control", {}).get("enabled") else "Disabled",
                "local_writes": "Enabled" if self._pending_options.get("control", {}).get("local_enabled") and not self._pending_data.get("shared_read_only") else "Disabled",
                "export": "Allowed by TC preferences; plant limits still apply" if self._pending_options.get("safety", {}).get("export_permitted") else "Not permitted by TC preferences",
            },
        )

    @staticmethod
    def async_get_options_flow(config_entry):
        return OptionsFlow()


class OptionsFlow(config_entries.OptionsFlow):
    async def _save_options(self, data):
        """Release an owned lease before intentionally disconnecting its recovery path."""
        runtime = getattr(self.config_entry, "runtime_data", None)
        controls = getattr(runtime, "controls", None)
        before = enabled_connections(self.config_entry.data, self.config_entry.options)
        after = enabled_connections(self.config_entry.data, data)
        if controls is not None and controls.enabled and (
            any(before[key] and not after[key] for key in before)
            or data.get("control", {}).get("enabled") is not True
            or self.config_entry.options.get("control", {}).get("local_enabled") is True and data.get("control", {}).get("local_enabled") is not True
        ):
            record = await controls.automation_record()
            if record.get("active") or controls._job is not None and not controls._job.done():
                await controls.cancel()
                await controls._job
                if controls.operation.get("phase") not in ("idle", "restored", "superseded"):
                    return self.async_abort(reason="control_recovery_required")
        return self.async_create_entry(title="", data=data)

    async def async_step_init(self, user_input=None):
        return self.async_show_menu(
            step_id="init",
            menu_options=["connections", "modbus", "cloud", "safety", "forecast", "remove_cloud", "dashboard", "placement"],
        )

    async def async_step_placement(self, user_input=None):
        from .dashboard_placement import dashboards

        try:
            choices = await dashboards(self.hass)
        except PermissionError:
            return self.async_abort(reason="placement_admin_required")
        if not choices:
            return self.async_abort(reason="placement_no_dashboard")
        errors = {}
        if user_input is not None:
            selected = user_input.get("dashboard")
            if selected in choices:
                self._placement_dashboard, self._placement_original = choices[selected]
                return await self.async_step_placement_target()
            errors["base"] = "placement_changed"
        return self.async_show_form(step_id="placement", errors=errors, data_schema=vol.Schema({
            vol.Required("dashboard"): selector.SelectSelector(selector.SelectSelectorConfig(options=[
                {"value": key, "label": (item[0].config or {}).get("title", "Overview")} for key, item in choices.items()
            ]))
        }))

    async def async_step_placement_target(self, user_input=None):
        from .dashboard_placement import place, save, targets

        choices = targets(self._placement_original)
        errors = {}
        if user_input is not None:
            try:
                target = choices[user_input["destination"]]
                if "page" in target and not user_input.get("shell_supported"):
                    raise ValueError("Custom menu support must be confirmed")
                changed = place(self._placement_original, user_input["destination"], self.config_entry.entry_id,
                                self.config_entry.options.get("dashboard", {}), replace_existing=user_input.get("replace_existing", False))
                # Revalidate admin status immediately before the only mutation.
                from .dashboard_placement import dashboards
                current = await dashboards(self.hass)
                if not any(item[0] is self._placement_dashboard for item in current.values()):
                    raise ValueError("Dashboard no longer exists")
                await save(self.hass, self._placement_dashboard, self._placement_original, changed, self.config_entry.entry_id)
                return self.async_abort(reason="dashboard_added")
            except PermissionError:
                return self.async_abort(reason="placement_admin_required")
            except (ValueError, KeyError):
                errors["base"] = "placement_changed"
            except Exception:
                return self.async_abort(reason="placement_save_failed")
        return self.async_show_form(step_id="placement_target", errors=errors, data_schema=vol.Schema({
            vol.Required("destination"): selector.SelectSelector(selector.SelectSelectorConfig(options=[
                {"value": key, "label": item["label"] + (" (replace existing card)" if item.get("occupied") else "")} for key, item in choices.items()
            ])),
            vol.Optional("replace_existing", default=False): bool,
            vol.Optional("shell_supported", default=False): bool,
        }))

    async def async_step_connections(self, user_input=None):
        current = enabled_connections(self.config_entry.data, self.config_entry.options)
        errors = {}
        if user_input is not None:
            switches = {key: user_input.get(key, False) is True for key in ("modbus", "cloud")}
            if not any(switches.values()):
                errors["base"] = "connection_required"
            elif switches["modbus"] and not self.config_entry.data.get("host"):
                errors["base"] = "modbus_setup_required"
            elif switches["cloud"] and not self.config_entry.options.get("cloud"):
                errors["base"] = "cloud_setup_required"
            else:
                return await self._save_options({**self.config_entry.options, "connections": switches})
        return self.async_show_form(
            step_id="connections",
            errors=errors,
            data_schema=vol.Schema({vol.Required(key, default=current[key]): bool for key in ("modbus", "cloud")}),
        )

    async def async_step_modbus(self, user_input=None):
        errors = {}
        if user_input is not None:
            try:
                user_input = modbus_form_data(user_input)
            except ValueError:
                errors["inverter_unit_id"] = "invalid_inverter_unit"
                user_input = None
        if user_input is not None:
            host = user_input.get("host", "").strip().lower()
            if not host or "/" in host or "://" in host:
                errors["host"] = "invalid_host"
            elif not (user_input.get("sole_modbus_client") or user_input.get("shared_read_only") or user_input.get("allow_shared_writes")):
                errors["base"] = "competing_client"
            else:
                controls = getattr(getattr(self.config_entry, "runtime_data", None), "controls", None)
                if controls is not None and (await controls.automation_record()).get("active"):
                    await controls.cancel()
                    await controls._job
                    if controls.operation.get("phase") not in ("idle", "restored", "superseded"):
                        return self.async_abort(reason="control_recovery_required")
                current = enabled_connections(self.config_entry.data, self.config_entry.options)
                options = {**self.config_entry.options, "connections": {**current, "modbus": True}}
                self.hass.config_entries.async_update_entry(
                    self.config_entry,
                    data={**self.config_entry.data, **user_input, "host": host, "cloud_only": False},
                    options=options,
                )
                return self.async_create_entry(title="", data=options)
        return self.async_show_form(
            step_id="modbus",
            errors=errors,
            data_schema=vol.Schema(
                {
                    vol.Required("host", default=self.config_entry.data.get("host", "")): str,
                    vol.Required("port", default=self.config_entry.data.get("port", 502)): vol.All(
                        vol.Coerce(int), vol.Range(min=1, max=65535)
                    ),
                    vol.Required("sole_modbus_client", default=False): bool,
                    vol.Optional("inverter_unit_id", **({"default": self.config_entry.data["inverter_unit_id"]} if self.config_entry.data.get("inverter_unit_id") else {})): number_box(1, 246, step=1),
                    **{vol.Optional(key, **({"default": self.config_entry.data[key]} if self.config_entry.data.get(key) else {})): number_box(1, 246, step=1) for key in ("ac_charger_unit_id", "dc_charger_unit_id")},
                    vol.Optional("allow_shared_writes", default=self.config_entry.data.get("allow_shared_writes", False)): bool,
                    vol.Optional(
                        "shared_read_only",
                        default=self.config_entry.data.get("shared_read_only", False)
                        if hasattr(self, "config_entry")
                        else False,
                    ): bool,
                    vol.Optional("poll_seconds", default=60): vol.All(vol.Coerce(int), vol.Range(min=15, max=300)),
                }
            ),
        )

    async def async_step_dashboard(self, user_input=None):
        if user_input is not None:
            return self.async_create_entry(title="", data={**self.config_entry.options, "dashboard": user_input})
        current = self.config_entry.options.get("dashboard", {})
        return self.async_show_form(
            step_id="dashboard",
            data_schema=vol.Schema(
                {
                    vol.Required("preset", default=current.get("preset", "overview")): vol.In(
                        ["overview", "house", "flow", "individual"]
                    ),
                    vol.Required("main_display", default=current.get("main_display", "photo")): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=[
                                {"value": "house", "label": "House"},
                                {"value": "flow", "label": "Flow"},
                                {"value": "photo", "label": "Photo house"},
                            ]
                        )
                    ),
                    vol.Required("appearance", default=current.get("appearance", "auto")): vol.In(
                        ["auto", "day", "night", "theme"]
                    ),
                    vol.Required(
                        "charts", default=current.get("charts", ["power", "tariff", "statistics"])
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            multiple=True,
                            options=[
                                "power",
                                "tariff",
                                "statistics",
                                "solar_chart",
                                "load_chart",
                                "battery_chart",
                                "grid_chart",
                            ],
                        )
                    ),
                }
            ),
        )

    async def async_step_safety(self, user_input=None):
        current = self.config_entry.options.get("safety", {})
        errors = {}
        if user_input is not None:
            try:
                safety = owner_limits_data(current, user_input)
                if user_input.get("enable_local_control") and not self.config_entry.data.get("inverter_unit_id"):
                    raise ValueError("Configure the primary inverter unit first")
                self._pending_safety_options = {**self.config_entry.options, "safety": safety, "control": {
                    **self.config_entry.options.get("control", {}),
                    "local_enabled": user_input.get("enable_local_control", self.config_entry.options.get("control", {}).get("local_enabled", False)) is True,
                    "enabled": user_input.get("enable_control", self.config_entry.options.get("control", {}).get("enabled", False)) is True}}
                if user_input.get("use_plant_power_limits") is False:
                    return await self.async_step_power_limits()
                return await self._save_options(self._pending_safety_options)
            except ValueError:
                errors["base"] = "invalid_safety_limits"
        control = self.config_entry.options.get("control", {})
        return self.async_show_form(step_id="safety", errors=errors,
            data_schema=owner_limits_schema(current, control.get("enabled", False), local_enabled=control.get("local_enabled", False)))

    async def async_step_power_limits(self, user_input=None):
        errors = {}
        options = self._pending_safety_options
        if user_input is not None:
            try:
                safety = {**options["safety"], **user_input}
                SafetyLimits(**safety)
                if any(safety.get(key) is None for key in ("max_charge_kw", "max_discharge_kw")):
                    raise ValueError
            except ValueError:
                errors["base"] = "invalid_safety_limits"
            else:
                return await self._save_options({**options, "safety": safety})
        return self.async_show_form(step_id="power_limits", errors=errors, data_schema=custom_power_schema(options["safety"]))

    async def async_step_forecast(self, user_input=None):
        errors = {}
        if user_input is not None and "forecast_sources" in user_input:
            try:
                forecast = forecast_setup_options(self.hass, user_input)
            except ValueError:
                errors["forecast_sources"] = "invalid_forecast_source"
            else:
                return self.async_create_entry(title="", data={**self.config_entry.options, "forecast": forecast})
            user_input = None
        if user_input is not None:
            self._forecast_provider = user_input["provider"]
            if self._forecast_provider == "none":
                return self.async_create_entry(
                    title="", data={**self.config_entry.options, "forecast": {"provider": "none"}}
                )
            info = PROVIDERS[self._forecast_provider]
            if not provider_entries(self.hass, self._forecast_provider):
                return self.async_abort(
                    reason="forecast_provider_missing",
                    description_placeholders={
                        "provider_name": info["name"],
                        "install_url": info["url"],
                        "instructions": info["install"],
                    },
                )
            return await self.async_step_forecast_source()
        return self.async_show_form(step_id="forecast", errors=errors,
            data_schema=forecast_setup_schema(self.hass, self.config_entry.options.get("forecast", {})))

    async def async_step_forecast_source(self, user_input=None):
        provider = self._forecast_provider
        info = PROVIDERS[provider]
        errors = {}
        entries = provider_entries(self.hass, provider)
        if user_input is not None:
            if provider in ("forecast_solar", "open_meteo_solar_forecast"):
                valid = user_input["entry_id"] in {e.entry_id for e in entries}
            else:
                registry = er.async_get(self.hass)
                valid = bool(user_input.get("entities")) and all(
                    (item := registry.async_get(entity_id)) is not None
                    and item.config_entry_id in {e.entry_id for e in entries}
                    and self.hass.states.get(entity_id) is not None
                    for entity_id in user_input["entities"]
                )
            if valid:
                return self.async_create_entry(
                    title="", data={**self.config_entry.options, "forecast": {"provider": provider, **user_input}}
                )
            errors["base"] = "invalid_forecast_source"
        if provider in ("forecast_solar", "open_meteo_solar_forecast"):
            schema = {
                vol.Required("entry_id"): selector.SelectSelector(
                    selector.SelectSelectorConfig(options=[{"value": e.entry_id, "label": e.title} for e in entries])
                )
            }
        else:
            schema = {
                vol.Required("entities"): selector.EntitySelector(
                    selector.EntitySelectorConfig(domain="sensor", multiple=True)
                )
            }
        return self.async_show_form(
            step_id="forecast_source",
            data_schema=vol.Schema(schema),
            errors=errors,
            description_placeholders={"provider_name": info["name"]},
        )

    async def async_step_cloud(self, user_input=None):
        if self.config_entry.data.get("demo"):
            return self.async_abort(reason="demo_isolated")
        errors = {}
        if user_input is not None:
            if not user_input["unofficial_opt_in"]:
                errors["base"] = "cloud_opt_in_required"
            elif not all(str(user_input.get(key, "")).strip() for key in ("username", "password")):
                errors["base"] = "cloud_fields_required"
            else:
                try:
                    station_id = await async_cloud_login(self.hass, user_input)
                except CloudLoginFailure as err:
                    errors["base"] = err.reason
                except AuthenticationError:
                    errors["base"] = "invalid_auth"
                except TransportError:
                    errors["base"] = "cannot_connect"
                else:
                    switches = enabled_connections(self.config_entry.data, self.config_entry.options)
                    return self.async_create_entry(
                        title="",
                        data={
                            **self.config_entry.options,
                            "cloud": cloud_credentials(user_input, station_id),
                            "connections": {**switches, "cloud": True},
                        },
                    )
        return self.async_show_form(
            step_id="cloud",
            errors=errors,
            data_schema=vol.Schema(
                {
                    vol.Required("region", default="eu"): vol.In(["eu", "us", "apac", "cn"]),
                    vol.Required("username"): selector.TextSelector(selector.TextSelectorConfig(autocomplete="off")),
                    vol.Required("password"): selector.TextSelector(
                        selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD, autocomplete="off")
                    ),
                    vol.Required("unofficial_opt_in", default=False): bool,
                }
            ),
        )

    async def async_step_remove_cloud(self, user_input=None):
        switches = enabled_connections(self.config_entry.data, self.config_entry.options)
        return await self._save_options(
            {
                **{k: v for k, v in self.config_entry.options.items() if k != "cloud"},
                "connections": {**switches, "cloud": False},
            },
        )
