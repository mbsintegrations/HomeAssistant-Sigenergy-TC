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


def owner_limits_schema(current, enabled):
    return vol.Schema(
        {
            vol.Required("enable_control", default=enabled): bool,
            vol.Required("export_permitted", default=current.get("export_permitted", False)): bool,
            vol.Required("reserve_soc", default=current.get("reserve_soc", 20)): vol.All(
                vol.Coerce(float), vol.Range(min=0, max=99)
            ),
            vol.Required("charge_ceiling_soc", default=current.get("charge_ceiling_soc", 90)): vol.All(
                vol.Coerce(float), vol.Range(min=1, max=100)
            ),
            vol.Required("max_charge_kw", default=current.get("max_charge_kw", 3)): vol.All(
                vol.Coerce(float), vol.Range(min=0.001, max=100)
            ),
            vol.Required("max_discharge_kw", default=current.get("max_discharge_kw", 3)): vol.All(
                vol.Coerce(float), vol.Range(min=0.001, max=100)
            ),
        }
    )


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
            host = user_input["host"].strip().lower()
            if not host or "/" in host or "://" in host:
                errors["host"] = "invalid_host"
            elif not (user_input["sole_modbus_client"] or user_input.get("shared_read_only")):
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
        schema = {
            vol.Required("forecast_provider", default="none"): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=[{"value": "none", "label": "No forecast for now"}]
                    + [{"value": key, "label": value["name"]} for key, value in PROVIDERS.items()]
                )
            ),
            vol.Required("optimizer_monitoring", default=False): bool,
        }
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
            if self._pending_options.get("cloud")
            else await self.async_step_dashboard()
        )

    async def async_step_wizard_control(self, user_input=None):
        errors = {}
        if user_input is not None:
            safety = {key: value for key, value in user_input.items() if key != "enable_control"}
            try:
                SafetyLimits(**safety)
            except ValueError:
                errors["base"] = "invalid_safety_limits"
            else:
                self._pending_options["safety"] = safety
                self._pending_options["control"] = {"enabled": user_input["enable_control"] is True}
                return await self.async_step_dashboard()
        return self.async_show_form(step_id="wizard_control", errors=errors, data_schema=owner_limits_schema({}, True))

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
                else "Local Modbus, read-only",
                "cloud": "Optional app-cloud reads" if "cloud" in self._pending_options else "Disabled",
                "forecast": self._pending_options["forecast"]["provider"],
                "dashboard": self._pending_options["dashboard"]["preset"],
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
        if controls is not None and controls.enabled and (
            not enabled_connections(self.config_entry.data, data)["cloud"] or data.get("control", {}).get("enabled") is not True
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
            menu_options=["connections", "modbus", "cloud", "safety", "forecast", "remove_cloud", "dashboard"],
        )

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
            host = user_input.get("host", "").strip().lower()
            if not host or "/" in host or "://" in host:
                errors["host"] = "invalid_host"
            elif not (user_input.get("sole_modbus_client") or user_input.get("shared_read_only")):
                errors["base"] = "competing_client"
            else:
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
                safety = {**current, **{key: value for key, value in user_input.items() if key != "enable_control"}}
                SafetyLimits(**safety)
                return await self._save_options(
                    {
                        **self.config_entry.options,
                        "safety": safety,
                        "control": {
                            "enabled": user_input.get(
                                "enable_control", self.config_entry.options.get("control", {}).get("enabled", False)
                            )
                            is True
                        },
                    },
                )
            except ValueError:
                errors["base"] = "invalid_safety_limits"
        return self.async_show_form(
            step_id="safety",
            errors=errors,
            data_schema=vol.Schema(
                {
                    vol.Required(
                        "enable_control", default=self.config_entry.options.get("control", {}).get("enabled", False)
                    ): bool,
                    vol.Required("export_permitted", default=current.get("export_permitted", False)): bool,
                    vol.Required("reserve_soc", default=current.get("reserve_soc", 20)): vol.All(
                        vol.Coerce(float), vol.Range(min=0, max=99)
                    ),
                    vol.Required("charge_ceiling_soc", default=current.get("charge_ceiling_soc", 90)): vol.All(
                        vol.Coerce(float), vol.Range(min=1, max=100)
                    ),
                    vol.Required("max_charge_kw", default=current.get("max_charge_kw", 3)): vol.All(
                        vol.Coerce(float), vol.Range(min=0.001, max=100)
                    ),
                    vol.Required("max_discharge_kw", default=current.get("max_discharge_kw", 3)): vol.All(
                        vol.Coerce(float), vol.Range(min=0.001, max=100)
                    ),
                }
            ),
        )

    async def async_step_forecast(self, user_input=None):
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
        return self.async_show_form(
            step_id="forecast",
            data_schema=vol.Schema(
                {
                    vol.Required("provider", default="none"): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=[
                                {"value": "none", "label": "No forecast"},
                                {"value": "solcast", "label": "Solcast (existing HACS integration)"},
                                {"value": "forecast_solar", "label": "Forecast.Solar (built-in integration)"},
                                {"value": "volcast", "label": "Volcast (existing HACS integration)"},
                                {
                                    "value": "open_meteo_solar_forecast",
                                    "label": "Open-Meteo Solar Forecast (existing HACS integration)",
                                },
                            ]
                        )
                    )
                }
            ),
        )

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
