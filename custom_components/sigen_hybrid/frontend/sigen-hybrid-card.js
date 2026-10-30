/* SPDX-License-Identifier: GPL-3.0-only
 * Sigenergy TC dashboard components. Third-party artwork attribution is
 * retained in sigen-hybrid-photo.js and THIRD_PARTY_NOTICES.md.
 */
/* Sankey node sizing/two-sided ribbon layout adapted from kjmcfall/sigen-flow-card.
 * MIT License. Copyright (c) 2026 Kevin McFall.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { installNavigation, CARD_PRESETS, CARD_CHART_CHOICES } from './sigen-hybrid-navigation.js?v=0.1.0';
import { WIDGET_ROUTES } from './sigen-hybrid-widgets.js?v=0.1.0';
import { renderPhotoScene, PHOTO_STYLE } from './sigen-hybrid-photo.js?v=0.1.0';
import { renderTodayEnergy, renderBatteryLevel, renderChargerControls, renderMobilePower, OVERVIEW_STYLE } from './sigen-hybrid-overview.js?v=0.1.0';
import { energySankey as buildEnergySankey } from './sigen-hybrid-sankey.js?v=0.1.0';
import { renderHouseScene, HOUSE_STYLE } from './sigen-hybrid-house.js?v=0.1.0';
import { renderDeviceOverview, DEVICE_STYLE } from './sigen-hybrid-devices.js?v=0.1.0';
import { gridConnectionStatus, connectionIndicators, selectReadingState } from './sigen-hybrid-energy.js?v=0.1.0';
export const MAIN_DISPLAYS = Object.freeze({ house: 'House', flow: 'Flow', photo: 'Photo house' });
const COLORS = { solar: '#efc900', battery: '#26c9c8', grid: '#6694ff', home: '#a45bf0', ac: '#b46767', dc: '#d29420' };
const LABELS = { solar: 'Solar', battery: 'Battery', grid: 'Grid', home: 'Home', ac: 'AC charger', dc: 'DC charger' };
const VIEWS = ['overview', 'charts', 'house', 'flow', 'statistics', 'power', 'battery', 'solar', 'grid', 'forecast', 'tariff', 'controls', 'optimizers', 'solar_chart', 'load_chart', 'battery_chart', 'grid_chart', 'dc_chart', 'dc_voltage_chart', 'dc_current_chart', 'dc_soc_chart', 'dc_metrics_chart', ...WIDGET_ROUTES,...CARD_PRESETS.map(([key])=>key)];
const KEYS = { pv_kw: 'solar_power', home_kw: 'home_power', grid_kw: 'grid_power', battery_kw: 'battery_power', soc: 'battery_soc', capacity_kwh: 'battery_capacity', native_mode: 'native_mode', grid_status: 'grid_status', control_status: 'control_status', cloud_mode: 'cloud_mode', cloud_status: 'cloud_status', modbus_status: 'modbus_status', forecast_status: 'forecast_status', forecast_today: 'forecast_today', forecast_tomorrow: 'forecast_tomorrow', export_permitted: 'export_permitted', solar_today: 'solar_today', home_today: 'home_today', battery_charge_today: 'battery_charge_today', battery_discharge_today: 'battery_discharge_today', grid_import_today: 'grid_import_today', grid_export_today: 'grid_export_today', ac_today: 'ac_today', dc_today: 'dc_today', dc_discharge_today: 'dc_discharge_today', solar_lifetime: 'solar_lifetime', home_lifetime: 'home_lifetime', battery_charge_lifetime: 'battery_charge_lifetime', battery_discharge_lifetime: 'battery_discharge_lifetime', grid_import_lifetime: 'grid_import_lifetime', grid_export_lifetime: 'grid_export_lifetime', ac_plant_lifetime: 'ac_plant_lifetime', dc_plant_lifetime: 'dc_plant_lifetime', dc_discharge_lifetime: 'dc_discharge_lifetime' };
const historyCache = new Map();
const registryCache = new WeakMap();
let sankeySerial = 0;
export const escapeHTML = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const esc = escapeHTML;
export function measurement(state, quantity = 'power') {
  if (!state || !String(state.state).trim() || ['unknown', 'unavailable', 'none'].includes(state.state)) return null;
  const n = Number(state.state);
  if (!Number.isFinite(n)) return null;
  if (quantity === 'soc' && (n < 0 || n > 100)) return null;
  const factors = { power: { W: .001, kW: 1, MW: 1000 }, energy: { Wh: .001, kWh: 1, MWh: 1000 }, soc: { '%': 1 } };
  if (quantity === 'number') return n;
  const factor = factors[quantity]?.[state.attributes?.unit_of_measurement];
  return factor === undefined ? null : n * factor;
}
export function safeImageURL(value) {
  if (typeof value !== 'string' || !value || value.startsWith('//') || /[\s<>"'\\]/.test(value)) return '';
  return (value.startsWith('/') || value.startsWith('https://')) ? value : '';
}
export function dashboardBackgroundStyle(settings, night = false) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return '';
  const tint = night ? 'rgba(23,30,40,.78)' : 'rgba(237,244,250,.78)', overlay = `linear-gradient(${tint},${tint})`;
  if (settings.type === 'color') return typeof settings.color === 'string' && /^#[0-9a-f]{6}$/i.test(settings.color) ? `background:${overlay},${settings.color.toLowerCase()};` : '';
  if (settings.type !== 'image') return '';
  const image = safeImageURL(settings.image);
  if (!image || image.length > 2048 || /[\u0000-\u001f\u007f`(){};]/.test(image)) return '';
  try {
    const url = new URL(image, image.startsWith('/') ? 'https://home-assistant.invalid' : undefined);
    if (!url.hostname || url.username || url.password || !image.startsWith('/') && url.protocol !== 'https:') return '';
  } catch { return ''; }
  return `background:${overlay},url("${image}") center/cover no-repeat ${night ? '#171e28' : '#edf4fa'};`;
}
export function priceMeasurement(state) {
  const n = measurement(state, 'number'), unit = state?.attributes?.unit_of_measurement;
  if (n === null || typeof unit !== 'string') return null;
  if (/^(EUR|USD|GBP|€|\$|£)\/kWh$/.test(unit)) return n;
  if (/^(c|ct|cent|cents|p)\/kWh$/.test(unit)) return n / 100;
  return null;
}
export function manualPowerOptions(settings, mode) {
  const values = ['charge', 'discharge'].includes(mode) ? settings?.[mode] ?? {} : {};
  const positive = value => {
    if (!['number', 'string'].includes(typeof value) || typeof value === 'string' && !value.trim()) return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && number < 4294967.295 ? number : null;
  };
  const min_kw = positive(values.min_kw), app = positive(values.app_default_kw), device = positive(values.device_max_kw), owner = positive(values.user_max_kw);
  const ceilings = [app, device, owner].filter(value => value !== null), max_kw = ceilings.length ? Math.min(...ceilings) : null;
  const valid_bounds = min_kw === null || max_kw === null || min_kw <= max_kw;
  const choices = [['app_default', 'Sigen app limit', app], ['device_max', 'Device maximum', device], ['user_max', 'Owner maximum', owner]]
    .filter(([, , value]) => value !== null)
    .map(([id, label, power_kw]) => ({ id, label, power_kw, disabled: !valid_bounds || min_kw !== null && power_kw < min_kw || max_kw !== null && power_kw > max_kw }));
  if (values.app_unlimited === true) choices.unshift({ id: 'system_limits', label: 'System limits', power_kw: null, disabled: !valid_bounds });
  return { choices, min_kw, max_kw, valid_bounds };
}
export function manualDurationOptions(maximum) {
  const max_minutes = Number.isInteger(maximum) && maximum >= 1 && maximum <= 1440 ? maximum : 1440;
  return { max_minutes, choices: [30, 60, 90, 120, 180].map(minutes => ({ minutes, disabled: minutes > max_minutes })) };
}
export function flowActivity(state, kind, now = Date.now(), maxAge) {
  const value = measurement(state);
  const observed = Date.parse(state?.attributes?.observed_at ?? state?.last_reported ?? state?.last_updated ?? '');
  const cloudCache = state?.attributes?.data_source === 'sigenergy_cloud' && state.attributes.poll_interval_seconds === 900;
  const allowedAge = maxAge === undefined ? (cloudCache ? 1800000 : 120000) : maxAge;
  const fresh = state?.attributes?.available !== false && Number.isFinite(observed) && now - observed >= -5000 && now - observed <= allowedAge;
  return { value, fresh, active: fresh && value !== null && Math.abs(value) > .03, reverse: value !== null && ((kind === 'battery' && value > 0) || (kind === 'grid' && value < 0) || (kind === 'dc' && value < 0)) };
}
export const energySankey = buildEnergySankey;
export function discoverEntities(rows, entryId) {
  if (!entryId) return {};
  const found = {};
  for (const row of rows) {
    if (row.platform !== 'sigen_hybrid' || row.config_entry_id !== entryId || row.disabled_by) continue;
    for (const [suffix, key] of Object.entries(KEYS)) if (row.unique_id?.endsWith(`_${suffix}`)) found[key] = row.entity_id;
  }
  return found;
}
const fmt = (v, unit = 'kW') => v === null || !Number.isFinite(v) ? '—' : `${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;
const textState = s => !s || ['unknown', 'unavailable'].includes(s.state) ? 'Unavailable' : String(s.state).replaceAll('_', ' ');

export class SigenHybridCard extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); this._tab = 'overview'; this._scene = null; this._history = {}; this._auto = {}; }
  static getStubConfig(hass) { const entries=[...new Set(Object.values(hass?.states??{}).filter(state=>state.attributes?.control_api_version===1).map(state=>state.attributes.config_entry_id).filter(Boolean))];return {title:'My energy',entities:{},...(entries.length===1?{config_entry:entries[0]}:{})}; }
  static getConfigForm() {
    return { schema: [
      { name: 'title', selector: { text: {} } },
      { name: 'view', selector: { select: { options: [...new Set(VIEWS)].map(value=>({value,label:CARD_PRESETS.find(([id])=>id===value)?.slice(1).reverse().join(' · ')??value.replaceAll('_',' ')})) } } },
      { name: 'chart_kind', selector: { select: { options: CARD_CHART_CHOICES.map(([value,label])=>({value,label})) } } },
      { name: 'card_layout', selector: { select: { options: [{value:'compact',label:'Standalone card'},{value:'full',label:'Full header'}] } } },
      { name: 'quick_controls', selector: { boolean: {} } },
      { name: 'controls_layout', selector: { select: { options: ['auto','horizontal','vertical'] } } },
      { name: 'density', selector: { select: { options: ['comfortable','compact'] } } },
      { name: 'appearance', selector: { select: { options: ['auto', 'day', 'night', 'theme'] } } },
      { name: 'main_display', selector: { select: { options: Object.entries(MAIN_DISPLAYS).map(([value, label]) => ({value, label})) } } },
      { name: 'config_entry', selector: { config_entry: { integration: 'sigen_hybrid' } } },
      { name: 'weather_entity', selector: { entity: { domain: 'weather' } } },
      { name: 'sun_entity', selector: { entity: { domain: 'sun' } } },
      { name: 'timezone', selector: { text: {} } },
      { name: 'images', selector: { object: {} } },
      { name: 'fonts', selector: { object: {} } },
      { name: 'entities', selector: { object: {} } },
      { name: 'fallback_entities', selector: { object: {} } },
      { name: 'optimizers', selector: { object: {} } },
      { name: 'devices', selector: { object: {} } },
      { name: 'charts', selector: { select: { multiple: true, options: ['power', 'tariff', 'statistics', 'solar_chart', 'load_chart', 'battery_chart', 'grid_chart'] } } },
      { name: 'overview_sections', selector: { select: { multiple: true, options: ['statistics', 'power', 'today', 'tariff', 'solar_chart', 'load_chart', 'battery_chart', 'grid_chart', 'dc_chart', 'dc_voltage_chart', 'dc_current_chart', 'dc_soc_chart', 'dc_metrics_chart', ...WIDGET_ROUTES] } } },
      { name: 'animations', selector: { boolean: {} } },
      { name: 'panel_orientation', selector: { select: { options: ['portrait', 'landscape'] } } },
      { name: 'panel_flow', selector: { select: { options: ['horizontal', 'vertical'] } } },
    ] };
  }
  setConfig(config) {
    if (!VIEWS.includes(config.view ?? 'overview')) throw new Error('Choose a supported Sigenergy TC card view');
    if(config.chart_kind!==undefined&&!CARD_CHART_CHOICES.some(([key])=>key===config.chart_kind))throw new Error('Choose a supported chart');
    if(config.card_layout!==undefined&&!['compact','full'].includes(config.card_layout))throw new Error('Choose a supported card layout');
    if(config.controls_layout!==undefined&&!['auto','horizontal','vertical'].includes(config.controls_layout))throw new Error('Choose a supported control layout');
    if(config.density!==undefined&&!['comfortable','compact'].includes(config.density))throw new Error('Choose a supported card density');
    if(config.quick_controls!==undefined&&typeof config.quick_controls!=='boolean')throw new Error('Quick controls must be true or false');
    if (config.appearance && !['auto', 'day', 'night', 'theme'].includes(config.appearance)) throw new Error('Invalid appearance');
    if (config.main_display !== undefined && !Object.hasOwn(MAIN_DISPLAYS, config.main_display)) throw new Error('Choose a supported main display');
    if (config.follow_saved_display !== undefined && typeof config.follow_saved_display !== 'boolean') throw new Error('Follow saved display must be true or false');
    if (config.show_display_picker !== undefined && typeof config.show_display_picker !== 'boolean') throw new Error('Display picker must be true or false');
    if (config.timezone) { try { new Intl.DateTimeFormat('en', { timeZone: config.timezone }); } catch { throw new Error('Choose a valid plant time zone'); } }
    for (const id of Object.values(config.entities ?? {})) if (id !== null && (typeof id !== 'string' || !/^(sensor|binary_sensor)\.[a-z0-9_]+$/.test(id))) throw new Error('Map sensor entities only');
    if (config.optimizers && !Array.isArray(config.optimizers)) throw new Error('Optimizers must be a list of module mappings');
    for (const module of config.optimizers ?? []) {
      if (!module || typeof module !== 'object' || Array.isArray(module)) throw new Error('Invalid optimizer module mapping');
      for (const key of ['power','energy','voltage','current']) if (module[key] !== undefined && module[key] !== null && (typeof module[key] !== 'string' || !/^sensor\.[a-z0-9_]+$/.test(module[key]))) throw new Error('Map optimizer sensor entities only');
    }
    if (config.devices && !Array.isArray(config.devices)) throw new Error('Devices must be a list of inventory mappings');
    for (const device of config.devices ?? []) {
      if (!device || typeof device !== 'object' || Array.isArray(device) || device.entities && (typeof device.entities !== 'object' || Array.isArray(device.entities))) throw new Error('Invalid device inventory mapping');
      for (const id of Object.values(device.entities ?? {})) if (id !== null && (typeof id !== 'string' || !/^(sensor|binary_sensor)\.[a-z0-9_]+$/.test(id))) throw new Error('Map sensor entities only');
    }
    if (config.overview_sections && (!Array.isArray(config.overview_sections) || config.overview_sections.some(view => !['statistics','power','today','tariff','solar_chart','load_chart','battery_chart','grid_chart',...WIDGET_ROUTES].includes(view)))) throw new Error('Choose supported overview sections');
    this._explicitView = config.view !== undefined;
    this._explicitAppearance = config.appearance !== undefined;
    this._config = { view: 'overview', appearance: 'auto',card_layout:config.view&&!['overview','charts'].includes(config.view)?'compact':'full', ...config };
    this._auto = {}; this._signature = ''; this._discoveryKey = ''; this._scene = null;
    this._previewMainDisplay = undefined; this._previewAppearance = undefined; this._previewLayout = undefined;
    this._render(); if (this._hass) this._discover();
  }
  set hass(hass) {
    this._hass = hass; if (!this._config) return;
    this._discover();
    this._syncManualOperation();
    this._syncOwnerSetting?.();
    const ids = [...new Set([...Object.values(this._entities), ...Object.values(this._config.fallback_entities??{}).flat(), ...this._deviceIds(), this._config.weather_entity, this._config.sun_entity ?? 'sun.sun', ...this._moduleIds()])];
    const signature = JSON.stringify(ids.map(id => [id, hass.states[id]?.state, hass.states[id]?.last_updated, hass.states[id]?.attributes]));
    const dark = this._night(),uiDark=this._uiNight();
    if (signature !== this._signature || dark !== this._dark || uiDark !== this._uiDark) { this._signature = signature; this._dark = dark;this._uiDark=uiDark; this._render(); }
    if (this.isConnected) this._loadHistory();
  }
  connectedCallback() { if (this._hass) { this._discover(); this._loadHistory(); } }
  disconnectedCallback() { this._historySerial = (this._historySerial ?? 0) + 1; this._loading = false; }
  getCardSize() { return this._view === 'overview' ? 12 : ['battery', 'solar', 'grid'].includes(this._view) ? 4 : 7; }
  getGridOptions() { return { columns: 12, rows: 'auto', min_columns: 6 }; }
  get _entities() { return { ...this._auto, ...this._config?.entities }; }
  get _preferences() { return this._state('control_status')?.attributes?.dashboard ?? {}; }
  get _view() { const preset = this._preferences.preset; return this._explicitView ? this._config.view : VIEWS.includes(preset) ? preset : 'overview'; }
  get _charts() { return this._config.charts ?? this._preferences.charts ?? ['power', 'tariff', 'statistics']; }
  get _mainDisplay() {
    const saved = this._detailContext?.().interfaceOptions?.display_settings;
    return [this._previewMainDisplay, this._config?.follow_saved_display !== false && saved?.route === 'display_settings' && saved.local_only === true ? saved.main_display : null, this._config?.main_display, this._preferences.main_display, 'photo'].find(value => Object.hasOwn(MAIN_DISPLAYS, value));
  }
  _sceneSwitcher() { return ''; }
  _sceneContent() { return this._mainDisplay === 'photo' ? this._photo() : this._mainDisplay === 'flow' ? this._flow() : this._house(); }
  _overviewFrame(modules = ['forecast', 'today', 'current_mode_battery', 'manual_controls']) {
    const ctx = this._detailContext(), enabled = new Set(modules);
    const side = { forecast: () => this._forecast(), today: () => renderTodayEnergy(ctx), current_mode_battery: () => renderBatteryLevel(ctx) };
    const aside = ['forecast','today','current_mode_battery'].filter(key => enabled.has(key)).map(key => `<div class="overview-side-module" data-display-module="${key}">${side[key]()}</div>`).join('');
    const controlBody=enabled.has('manual_controls')?this._controls():'';
    const controls=controlBody?`<div class="overview-primary-controls" data-display-module="manual_controls">${controlBody}</div>`:'';
    const links = enabled.has('current_mode_battery') ? `<div class="overview-device-links">${this._overviewModeControl()}${[['energy_profile','My Energy Profile'],['strategies','Personal Strategies']].map(([route, label]) => `<button type="button" data-detail="${route}">${label}<span aria-hidden="true">›</span></button>`).join('')}</div>` : '';
    return `<div class="overview-grid compact-overview${aside ? '' : ' overview-without-sidebar'}${controls && links ? ' overview-aligned-controls' : ''}"><section class="hero" aria-label="Home energy overview"><div class="main-display-stage" data-display="${this._mainDisplay}">${this._sceneContent()}</div>${renderMobilePower({...ctx,has:key=>this._has(key)})}${controls}</section>${aside ? `<aside class="overview-sidebar" aria-label="Home energy summary"><div class="overview-summary-stack">${aside}</div>${links}</aside>` : ''}</div>`;
  }
  _photo() {
    return renderPhotoScene({weather:this._hass?.states[this._config.weather_entity],art:this._config.images?.[this._night()?'night':'day']??{},immersiveWeather:this._weatherEffectsEnabled?.()===true,value: (key, quantity) => this._value(key, quantity), state: key => this._state(key), has: key => this._has(key), night: this._night(), animations: this._config.animations !== false, config: this._config, devices: this._deviceInventory(), activity: key => flowActivity(this._state(key), key.replace('_power', ''), this._now())});
  }
  _rawState(key) { return this._hass?.states[this._entities[key]]; }
  _state(key) {
    const primary=this._rawState(key),fallback=this._config?.fallback_entities?.[key]??[];
    if(key.endsWith('_status')||key==='cloud_mode')return primary;
    const ids=Array.isArray(fallback)?fallback:typeof fallback==='string'?[fallback]:[];
    return selectReadingState([primary,...ids.map(id=>this._hass?.states[id])],this._now());
  }
  _capability(feature) { return this._rawState('control_status')?.attributes?.capabilities?.[feature]??{supported:true,online:true,available:!this._readOnly()}; }
  _connectionOverview() { return connectionIndicators({config:this._config,state:key=>this._rawState(key),rawState:key=>this._rawState(key),now:this._now()}); }
  _connectionIndicators() {
    return `<div class="connection-strip" aria-label="Connections">${this._connectionOverview().map(item=>`<button type="button" class="connection-indicator" data-connection="${item.key}" data-tone="${item.tone}" data-detail="connections" aria-label="${esc(`${item.label}: ${item.description}`)}" title="${esc(item.description)}"><i aria-hidden="true"></i>${item.label}</button>`).join('')}</div>`;
  }
  _now() { const snapshot = Date.parse(this._config?.snapshot_at ?? ''); return Number.isFinite(snapshot) ? snapshot : Date.now(); }
  _value(key, kind = 'power') { return measurement(this._state(key), kind); }
  _has(key) { return Boolean(this._entities[key]); }
  _readOnly() { const control=this._state('control_status')?.attributes;return this._config.cloud_paused === true || !this._config.config_entry || control?.live_writes_locked !== false || control?.control_api_version===1&&control?.capabilities?.manual_control?.available!==true; }
  _moduleIds() { return (this._config.optimizers ?? []).flatMap(m => ['power', 'energy', 'voltage', 'current'].map(k => m[k]).filter(Boolean)); }
  _deviceIds() { return (this._config.devices ?? []).flatMap(device => Object.values(device.entities ?? {}).filter(Boolean)); }
  _deviceInventory() { return this._config.devices ?? this._state('cloud_status')?.attributes?.device_inventory ?? []; }
  _uiNight() { return typeof this._hass?.themes?.darkMode==='boolean'?this._hass.themes.darkMode:this._night(); }
  _night() {
    const appearance = this._previewAppearance ?? this._savedHomepageAppearance?.() ?? (this._explicitAppearance ? this._config?.appearance : this._preferences.appearance ?? this._config?.appearance);
    if (appearance === 'day') return false;
    if (appearance === 'night') return true;
    if (appearance === 'theme') return Boolean(this._hass?.themes?.darkMode);
    const sun = this._hass?.states[this._config?.sun_entity ?? 'sun.sun']?.state;
    return sun === 'below_horizon' ? true : sun === 'above_horizon' ? false : Boolean(this._hass?.themes?.darkMode);
  }
  async _discover() {
    const id = this._config?.config_entry, conn = this._hass?.connection;
    if (!id || !conn || this._discoveryKey === id) return;
    this._discoveryKey = id;
    try {
      if (!registryCache.has(conn)) registryCache.set(conn, this._hass.callWS({ type: 'config/entity_registry/list' }));
      const rows = await registryCache.get(conn);
      if (this._config.config_entry !== id) return;
      this._auto = discoverEntities(rows, id); this._signature = ''; this._render(); this._loadHistory();
    } catch { registryCache.delete(conn); this._discoveryKey = ''; }
  }
  async _loadHistory() {
    if (this._config?.snapshot_at && this._config?.recorded_history && typeof this._config.recorded_history === 'object') {
      if (this._recordingLoaded !== this._config.recorded_history) {
        this._recordingLoaded = this._config.recorded_history;
        this._history = this._config.recorded_history;
        this._render();
      }
      return;
    }
    if (!this._hass || !this._config || this._loading || !this.isConnected || Date.now() - (this._loaded ?? 0) < 60000) return;
    const ids = [...new Set(['solar_power', 'home_power', 'battery_power', 'grid_power', 'ac_power', 'dc_power', 'battery_soc', 'buy_price', 'sell_price'].map(k => this._entities[k]).filter(Boolean))];
    if (!ids.length || typeof this._hass.callWS !== 'function') return;
    this._loading = true; const serial = this._historySerial = (this._historySerial ?? 0) + 1;
    const configuredStart=Date.parse(this._config.history_start??''),start=Math.max(Math.floor(Date.now()/60000)*60000-86400000,Number.isFinite(configuredStart)?configuredStart:0);
    const key = `${Math.floor(Date.now() / 60000)}:${start}:${ids.sort().join(',')}`;
    try {
      if (!historyCache.has(key)) {
        historyCache.set(key, this._hass.callWS({ type: 'recorder/statistics_during_period', start_time: new Date(start).toISOString(), end_time: new Date().toISOString(), statistic_ids: ids, period: '5minute', types: ['mean'] }));
        while (historyCache.size > 30) historyCache.delete(historyCache.keys().next().value);
      }
      const rows = await historyCache.get(key);
      if (serial !== this._historySerial) return;
      this._history = rows; this._historyError = ''; this._loaded = Date.now(); this._render();
    } catch { historyCache.delete(key); if (serial === this._historySerial) { this._historyError = 'Recorded history unavailable'; this._loaded = Date.now(); this._render(); } }
    finally { if (serial === this._historySerial) this._loading = false; }
  }
  _badge(label, tone = '') { return `<span class="badge ${tone}">${esc(label)}</span>`; }
  _entityButton(key, label, body, cls = '') { return `<button class="entity ${cls}" data-entity="${esc(this._entities[key] ?? '')}" aria-label="${esc(label)}">${body}</button>`; }
  _tile(key, label, kind = 'energy', color = 'solar') {
    return this._entityButton(key, label, `<i style="--tone:${COLORS[color]}"></i><span><strong>${esc(fmt(this._value(key, kind), kind === 'energy' ? 'kWh' : kind === 'soc' ? '%' : 'kW'))}</strong><small>${esc(label)}</small></span>`, 'tile');
  }
  _equipment() {
    return ['solar', 'battery', 'ac', 'dc'].filter(k => this._has(k === 'battery' ? 'battery_soc' : `${k}_power`));
  }
  _header() {
    const mode = [this._state('cloud_mode'), this._state('native_mode')].find(s => s && !['unknown', 'unavailable', 'none', ''].includes(s.state) && !Number.isFinite(Number(s.state)));
    const grid = gridConnectionStatus(this._state('grid_status'));
    const status = this._config.cloud_paused ? 'Cloud paused' : mode ? textState(mode) : 'Operating mode unavailable';
    const gridLabel = grid === 'on_grid' ? 'On Grid' : grid === 'off_grid' ? 'Off Grid' : 'Grid unavailable';
    return `<header><div><span class="eyebrow">SIGENERGY TC</span><h1>${esc(this._config.title ?? 'My energy')}</h1>${this._connectionIndicators()}</div><div class="badges"><button type="button" class="badge neutral" data-detail="mode" aria-label="${esc(`${status}. Change operating mode`)}" aria-haspopup="dialog">${esc(status)}</button><button type="button" class="badge neutral" data-detail="grid_connection" aria-label="${esc(`${gridLabel}. Grid connection options`)}" aria-haspopup="dialog">${gridLabel}</button></div></header>`;
  }
  _house() {
    const night = this._night();
    return renderHouseScene({immersiveWeather:this._weatherEffectsEnabled?.()===true,animations:this._config.animations!==false,art:this._config.images?.[night?'night':'day']??{},night,has:key=>this._has(key),value:(key,quantity)=>this._value(key,quantity),state:key=>this._state(key),weather:this._hass?.states[this._config.weather_entity],wires:this._houseWires()});
  }
  _houseWires() {
    const routes = [
      ['solar','solar_power','M450 311 L430 322 Q415 331 415 352 L415 570'],
      ['home','home_power','M574 653 L590 653 Q605 653 620 644 L637 634 Q650 625 650 610 L650 509 Q650 491 665 484 L697 471'],
      ['grid','grid_power','M677 789 L563 749 Q547 741 547 726 L547 690'],
      ['battery','battery_power','M460 621 L511 644'],
      ['ac','ac_power','M380 610 L235 540 L201 529'],
      ['dc','dc_power','M381 609 L330 584 L330 570'],
    ].filter(([,key])=>this._has(key));
    return `<g class="portal-cables">${routes.map(([kind,key,d])=>{const activity=flowActivity(this._state(key),kind,this._now());return `<g data-flow="${kind}" data-active="${activity.active}"><path class="portal-cable" d="${d}" fill="none" stroke="#bac6cd" stroke-width="3"/><path class="portal-pulse ${activity.active&&this._config.animations!==false?'moving':''} ${activity.reverse?'reverse':''}" d="${d}" pathLength="1000" fill="none" stroke="#24d5c4" stroke-width="3.2"/></g>`;}).join('')}</g>`;
  }
  _flow() {
    const nodes = [['solar', 'solar_power', 380, 80], ['battery', 'battery_power', 120, 240], ['grid', 'grid_power', 640, 240], ['home', 'home_power', 380, 410], ['ac', 'ac_power', 160, 410], ['dc', 'dc_power', 600, 410]].filter(([, key]) => this._has(key));
    return `<div class="flow"><svg viewBox="0 0 760 500" role="img" aria-label="Measured power at each system connection">
      ${nodes.map(([k, key, x, y]) => { const a = flowActivity(this._state(key), k, this._now()); return `<path class="wire ${a.active && this._config.animations !== false ? 'active' : ''} ${(['home', 'ac', 'dc'].includes(k) ? a.value > 0 : a.reverse) ? 'reverse' : ''}" style="--tone:${COLORS[k]}" d="M${x},${y} Q${x},250 380,250"/>`; }).join('')}
      <circle cx="380" cy="250" r="36" class="bus"/><text x="380" y="255" text-anchor="middle" class="bus-label">SYSTEM</text>
      ${nodes.map(([k, key, x, y]) => `<g><rect x="${x - 75}" y="${y - 41}" width="150" height="82" rx="22" class="node" style="stroke:${COLORS[k]}"/><text x="${x}" y="${y - 6}" text-anchor="middle" class="node-value">${esc(fmt(this._value(key)))}</text><text x="${x}" y="${y + 20}" text-anchor="middle" class="node-name">${LABELS[k]}</text></g>`).join('')}
      </svg></div>`;
  }
  _battery() {
    const soc = this._value('battery_soc', 'soc'), power = this._value('battery_power');
    return `<section class="panel"><div class="section-title"><h2>SigenStor</h2>${this._badge(power === null ? 'Unavailable' : Math.abs(power) < .03 ? 'Standby' : power > 0 ? 'Charging' : 'Discharging')}</div><div class="battery-summary"><div class="soc-ring" style="--soc:${soc === null ? 0 : Math.max(0, Math.min(100, soc)) * 3.6}deg"><strong>${soc === null ? '—' : `${soc.toFixed(0)}<small>%</small>`}</strong></div><div><strong class="big">${esc(fmt(power))}</strong>${this._value('battery_capacity', 'energy') === null ? '' : `<small>${esc(fmt(this._value('battery_capacity', 'energy'), 'kWh'))}</small>`}</div></div></section>`;
  }
  _forecast(detail = false) {
    const provider = this._state('forecast_status')?.state;
    const label = { forecast_solar: 'Forecast.Solar', solcast: 'Solcast', volcast: 'Volcast', open_meteo_solar_forecast:'Open-Meteo' }[provider] ?? (provider&&!['none','unknown','unavailable'].includes(provider)?provider:null);
    const sources=this._state('forecast_status')?.attributes?.sources??this._state('forecast_today')?.attributes?.sources??[];
    const selected=sources.filter(source=>typeof source.name==='string'&&(source.available===true||(typeof source.id==='string'&&source.id.includes(':'))));
    const badges=selected.length?`<span class="forecast-source-badges" aria-label="${esc(label??'Forecast sources')}" title="${esc(label??'Forecast sources')}">${selected.map(source=>{const name=source.name==='Open-Meteo Solar Forecast'?'Open-Meteo':source.name,available=source.available===true;return `<span class="badge" data-available="${available}" title="${esc(available?name:`${name}: temporarily unavailable`)}" aria-label="${esc(available?name:`${name}: temporarily unavailable`)}">${esc(name)}</span>`;}).join('')}</span>`:label?this._badge(label):'';
    return `<section class="panel"><div class="section-title"><h2>Solar forecast</h2>${badges}</div><div class="mini-grid">${this._tile('forecast_today', 'Today', 'energy')}${this._tile('forecast_tomorrow', 'Tomorrow', 'energy')}</div>${detail ? this._forecastChart() : ''}</section>`;
  }
  _forecastChart() {
    const now = this._now(), horizon = now + 172800000, intervals = new Map();
    for (const key of ['forecast_status', 'forecast_today', 'forecast_tomorrow']) {
      const state = this._state(key);
      if (!state || ['unknown', 'unavailable'].includes(state.state) || state.attributes?.available === false) continue;
      for (const point of Array.isArray(state.attributes?.series) ? state.attributes.series : []) {
        if (typeof point?.start !== 'string' || typeof point?.end !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(point.start) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(point.end)) continue;
        const start = Date.parse(point.start), end = Date.parse(point.end);
        const power = typeof point.power_kw === 'number' ? point.power_kw : typeof point.power_kw === 'string' && point.power_kw.trim() ? Number(point.power_kw) : NaN;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= now || start >= horizon || !Number.isFinite(power) || power < 0 || intervals.has(start)) continue;
        intervals.set(start, { start, end, power });
      }
    }
    const points = [...intervals.values()].sort((a, b) => a.start - b.start);
    if (!points.length) return '<div class="chart-empty">Forecast unavailable</div>';
    const end = Math.min(horizon, Math.max(...points.map(p => p.end))), span = Math.max(1, end - now);
    const maximum = Math.max(1, ...points.map(p => p.power)), x = t => 45 + (t - now) / span * 670, y = v => 195 - v / maximum * 175;
    let previous;
    const path = points.map(point => {
      const gap = !previous || point.start > previous.end || point.start - previous.start > 3600000;
      const segment = `${gap ? 'M' : 'L'}${x(Math.max(now, point.start)).toFixed(1)},${y(point.power).toFixed(1)} L${x(Math.min(end, point.end)).toFixed(1)},${y(point.power).toFixed(1)}`;
      previous = point; return segment;
    }).join(' ');
    const timeZone = this._hass?.config?.time_zone ?? 'UTC';
    return `<div class="section-title forecast-title"><h3>Production forecast</h3><small>kW</small></div><svg class="chart forecast-chart" viewBox="0 0 760 235" role="img" aria-label="Solar production forecast in kilowatts">${Array.from({ length: 5 }, (_, i) => { const value = maximum * i / 4; return `<path d="M45,${y(value)} H715" class="gridline"/><text x="35" y="${y(value) + 4}" text-anchor="end">${value.toFixed(1)}</text>`; }).join('')}<path class="forecast-line" d="${path}" stroke="${COLORS.solar}" stroke-width="2.5" fill="none"/>${[0, .25, .5, .75, 1].map(fraction => `<text x="${45 + 670 * fraction}" y="222" text-anchor="middle">${esc(new Date(now + span * fraction).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone }))}</text>`).join('')}</svg>`;
  }
  _priceValue(key) { const s = this._state(key); if (!s || measurement(s, 'number') === null) return '—'; return `${esc(s.state)} ${esc(s.attributes.unit_of_measurement ?? '')}`; }
  _tariff() {
    return `<section class="panel"><h2>Tariffs & strategy</h2><div class="price-pair"><div><small>Buying</small><strong>${this._priceValue('buy_price')}</strong></div><div><small>Selling</small><strong>${this._priceValue('sell_price')}</strong></div></div>${this._priceChart()}</section>`;
  }
  _controls({chargers=true}={}) {
    return `<section class="panel instant-manual-panel"><div class="section-title"><h2>Instant manual control</h2></div><div class="control-buttons battery-control-buttons">${[['charge', 'Charge'], ['discharge', 'Discharge to Home'], ['battery_export', 'Discharge to Grid'], ['hold', 'Hold battery'], ['self_consumption', 'Self-consumption']].map(([mode, label]) => `<button type="button" data-preview="${mode}">${label}</button>`).join('')}</div>${chargers?renderChargerControls(this._detailContext()):''}<output aria-live="polite">${esc(this._result ?? '')}</output></section>`;
  }
  _today() {
    const tiles = [['solar_today', 'Solar', 'solar'], ['home_today', 'Home', 'home'], ['battery_discharge_today', 'Discharged', 'battery'], ['battery_charge_today', 'Charged', 'battery'], ['grid_import_today', 'Imported', 'grid'], ['grid_export_today', 'Exported', 'grid']].map(([key, label, color]) => this._tile(key, label, 'energy', color)).join('');
    return `<section class="panel"><div class="section-title"><h2>Energy today</h2><button type="button" class="energy-totals-launch" data-detail="energy_totals">Energy totals ›</button></div><div class="totals">${tiles}</div></section>`;
  }
  _statistics() {
    const makeNodes = defs => defs.filter(([, key]) => this._has(key)).map(([id, key, label, color]) => ({ key: id, label, color: COLORS[color] ?? color, value: this._value(key, 'energy') }));
    const model = energySankey(
      makeNodes([['solar', 'solar_today', 'SOLAR', 'solar'], ['battery', 'battery_discharge_today', 'BATTERY', 'battery'], ['dc', 'dc_discharge_today', 'DC CHARGER', 'dc'], ['grid', 'grid_import_today', 'GRID', 'grid']]),
      makeNodes([['battery', 'battery_charge_today', 'BATTERY', 'battery'], ['dc', 'dc_today', 'DC CHARGER', 'dc'], ['home', 'home_today', 'HOME', 'home'], ['ac', 'ac_today', 'AC CHARGER', 'ac'], ['grid', 'grid_export_today', 'GRID', '#7463eb']]),
    );
    const width = 700, box = 120, rightX = width - box, scope = ++sankeySerial;
    const ribbons = model.links.map((f, i) => { const id = `sigen-ribbon-${scope}-${i}`; const d = `M${box} ${f.yL} C350 ${f.yL} 350 ${f.yR} ${rightX} ${f.yR} L${rightX} ${f.yR + f.hR} C350 ${f.yR + f.hR} 350 ${f.yL + f.hL} ${box} ${f.yL + f.hL} Z`; return `<defs><linearGradient id="${id}"><stop stop-color="${f.source.color}"/><stop offset="1" stop-color="${f.target.color}"/></linearGradient></defs><path d="${d}" fill="url(#${id})" opacity=".5" data-flow-source="${f.source.key}" data-flow-target="${f.target.key}" data-flow-kwh="${f.value}" role="button" tabindex="0" aria-label="Estimated ${esc(f.source.label)} to ${esc(f.target.label)}"><title>Estimated allocation ${f.source.label} to ${f.target.label}: ${f.value.toFixed(2)} kWh</title></path>`; }).join('');
    const nodes = [[model.left, 0, model.totalLeft], [model.right, rightX, model.totalRight]].map(([list, x, total]) => list.map(n => {
      const zero = n.value === null || n.value < .005, pill = Math.min(box - 12, n.label.length * 7.2 + 14);
      return `<g style="--node-ink:${this._uiNight() && !['solar', 'battery'].includes(n.key) ? '#f1f7ff' : '#152c40'}"><title>${esc(n.label)}: ${esc(fmt(n.value, 'kWh'))}</title><rect x="${x}" y="${n.y}" width="${box}" height="${n.height}" rx="5" fill="${n.color}" opacity="${zero ? .12 : .85}"/><rect x="${x + 6}" y="${n.y + 7}" width="${pill}" height="22" rx="4" fill="white" opacity=".68"/><text x="${x + 12}" y="${n.y + 23}" class="sankey-label">${n.label}</text>${zero ? `<text x="${x === 0 ? box + 10 : rightX - 10}" y="${n.y + 23}" text-anchor="${x === 0 ? 'start' : 'end'}" class="sankey-zero">${n.value === null ? '—' : '0 kWh'}</text>` : `<text x="${x + 9}" y="${n.y + 53}" class="sankey-value">${n.value.toFixed(2)}</text>${n.height > 105 ? `<text x="${x + 9}" y="${n.y + 74}" class="sankey-unit">kWh</text><text x="${x + 9}" y="${n.y + n.height - 11}" class="sankey-percent">${(n.value / total * 100).toFixed(2)}%</text>` : `<text x="${x + 90}" y="${n.y + 53}" class="sankey-unit">kWh</text>`}`}</g>`;
    }).join('')).join('');
    return `<section class="panel"><div class="section-title"><h2>Energy statistics</h2>${this._badge('Today · kWh')}</div><svg class="statistics" viewBox="0 0 700 480" role="img" aria-label="Energy statistics with measured totals and estimated proportional ribbons">${ribbons}${nodes}</svg>${model.partial && model.links.length ? `<p class="sankey-note">${esc(model.notice)}</p>` : ''}</section>`;
  }
  _chart(series, soc = false) {
    const start = this._now() - 86400000, end = this._now(), width = 760, height = 230, left = 40, top = 15;
    const lines = series.map(([key, label, color, sign = 1]) => ({ key, label, color, points: (this._history[this._entities[key]] ?? []).filter(r => Number.isFinite(r.mean) && r.start >= start && r.start <= end).map(r => { const value = measurement({ state: String(r.mean), attributes: this._state(key)?.attributes }, soc ? 'soc' : 'power'); return { time: r.start, value: value === null ? null : value * sign }; }) })).filter(s => s.points.length && s.points.every(p => p.value !== null && Number.isFinite(p.value)));
    if (!lines.length) return `<div class="chart-empty">${esc(this._historyError || 'No recorded history available yet')}</div>`;
    const values = lines.flatMap(s => s.points.map(p => p.value));
    const max = soc ? 100 : Math.max(1, ...values), min = soc ? 0 : Math.min(0, ...values), span = max - min;
    const x = t => left + (t - start) / 86400000 * 680, y = v => top + (max - v) / span * 180;
    return `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img" aria-label="${soc ? 'Battery percentage' : 'Power in kW'} over the last 24 hours">${Array.from({ length: 5 }, (_, i) => { const v = min + span * i / 4; return `<path d="M40,${y(v)} H720" class="gridline"/><text x="30" y="${y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`; }).join('')}${lines.map(s => {
      let previous; const d = s.points.map(p => { const command = !previous || p.time - previous > 900000 ? 'M' : 'L'; previous = p.time; return `${command}${x(p.time).toFixed(1)},${y(p.value).toFixed(1)}`; }).join(' ');
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"/>`; }).join('')}${[0, 6, 12, 18, 24].map(h => `<text x="${left + h / 24 * 680}" y="220" text-anchor="middle">${esc(new Date(start + h * 3600000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: this._hass?.config?.time_zone ?? 'UTC' }))}</text>`).join('')}</svg>`;
  }
  _power() {
    const series = [['solar_power', 'Solar', COLORS.solar], ['battery_power', 'Battery', COLORS.battery, -1], ['grid_power', 'Grid', COLORS.grid], ['home_power', 'Home', COLORS.home, -1], ['ac_power', 'AC charger', COLORS.ac, -1], ['dc_power', 'DC charger', COLORS.dc, -1]].filter(([key]) => this._has(key));
    return `<section class="panel"><div class="section-title"><h2>Power metrics <small>kW</small></h2><small>Last 24 hours</small></div><div class="legend">${series.map(([, label, color]) => `<span><i style="--tone:${color}"></i>${label}</span>`).join('')}</div>${this._chart(series)}</section>`;
  }
  _singlePower(kind) {
    const definitions={solar_chart:['Solar power','solar_power','Solar',COLORS.solar,1],load_chart:['Household load','home_power','Home',COLORS.home,1],battery_chart:['Battery discharge & charge','battery_power','Battery',COLORS.battery,-1],grid_chart:['Grid import & export','grid_power','Grid',COLORS.grid,1]};
    const [title,key,label,color,sign]=definitions[kind];
    return `<section class="panel"><div class="section-title"><h2>${title}</h2><small>kW · last 24 hours</small></div>${this._chart([[key,label,color,sign]])}</section>`;
  }
  _priceChart() {
    const start = this._now() - 86400000;
    const definitions = [['buy_price', 'Buying', COLORS.solar], ['sell_price', 'Selling', '#f79a53'], ['battery_soc', 'Battery SOC', COLORS.battery]];
    const series = definitions.map(([key, label, color]) => ({ key, label, color, points: (this._history[this._entities[key]] ?? []).filter(r => Number.isFinite(r.mean) && r.start >= start).map(r => ({ time: r.start, value: key === 'battery_soc' ? measurement({ state: String(r.mean), attributes: this._state(key)?.attributes }, 'soc') : priceMeasurement({ state: String(r.mean), attributes: this._state(key)?.attributes }) })).filter(p => p.value !== null) })).filter(s => s.points.length);
    const prices = series.filter(s => s.key !== 'battery_soc').flatMap(s => s.points.map(p => p.value));
    const minimum = Math.min(0, ...prices), maximum = Math.max(.1, ...prices), span = maximum - minimum;
    const x = t => 45 + (t - start) / 86400000 * 670;
    const y = (v, soc) => 20 + (soc ? 1 - v / 100 : (maximum - v) / span) * 175;
    const currency = this._state('buy_price')?.attributes?.currency ?? this._state('sell_price')?.attributes?.currency ?? '';
    const hasPrices = prices.length > 0, hasSoc = series.some(s => s.key === 'battery_soc');
    return `<div class="section-title">${hasPrices && hasSoc ? '<h3>Battery SOC & price trend</h3>' : ''}<small>Last 24 hours</small></div><div class="legend">${series.map(s => `<span><i style="--tone:${s.color}"></i>${s.label}</span>`).join('')}</div>${series.length ? `<svg class="chart" viewBox="0 0 760 235" role="img" aria-label="Battery state of charge and electricity prices">${Array.from({ length: 5 }, (_, i) => `<path d="M45,${20 + i * 43.75} H715" class="gridline"/>${hasPrices ? `<text x="35" y="${24 + i * 43.75}" text-anchor="end">${(maximum - span * i / 4).toFixed(2)}</text>` : ''}${hasSoc ? `<text x="725" y="${24 + i * 43.75}">${100 - i * 25}%</text>` : ''}`).join('')}${series.map(s => { let previous; const path = s.points.map(p => { const jump = !previous || p.time - previous > 900000; previous = p.time; return `${jump ? 'M' : 'L'}${x(p.time).toFixed(1)},${y(p.value, s.key === 'battery_soc').toFixed(1)}`; }).join(' '); return `<path d="${path}" stroke="${s.color}" stroke-width="2" fill="none"/>`; }).join('')}${hasPrices ? `<text x="45" y="225">${esc(currency)}/kWh</text>` : ''}${hasSoc ? '<text x="715" y="225" text-anchor="end">SOC %</text>' : ''}</svg>` : '<div class="chart-empty">No recorded SOC or tariff history</div>'}`;
  }
  _optimizers() {
    const groups=new Map();
    for(const m of this._config.optimizers??[]){const group=m.string??'Modules';if(!groups.has(group))groups.set(group,[]);groups.get(group).push(m);}
    const orientation=this._config.panel_orientation==='landscape'?'landscape':'portrait', flow=this._config.panel_flow==='vertical'?'vertical':'horizontal';
    if(!groups.size)return '';
    return `<section class="panel"><h2>Panel optimizers</h2><div class="panel-strings ${flow}">${[...groups.entries()].map(([group,modules])=>`<section class="panel-string"><h3>${esc(group)} <small>· ${modules.length} panels</small></h3><div class="compact-modules ${orientation} ${flow}">${modules.map((m,i)=>{const s=this._hass?.states[m.power],observed=s?.attributes?.observed_at??s?.last_reported??s?.last_updated,age=this._now()-new Date(observed??'').getTime(),stale=!s||(s.attributes?.sample_data!==true&&(!Number.isFinite(age)||age < -5000||age>1800000)),power=stale?null:measurement(s);return `<button class="panel-module" data-entity="${esc(m.power??'')}" aria-label="${esc(group+' '+(m.name??`Panel ${i+1}`))}: ${esc(fmt(power===null?null:power*1000,'W'))}"><span>${i+1}</span><strong>${esc(fmt(power===null?null:power*1000,'W'))}</strong></button>`;}).join('')}</div></section>`).join('')||''}</div></section>`;
  }
  _devices() { const night=this._night();return renderDeviceOverview({...this._detailContext(),art:this._config.images?.[night?'night':'day']??{},night})+(this._config.optimizers?.length?this._optimizers():''); }
  _content() {
    const view = this._view;
    if (view === 'overview') {
      const tab = `<nav aria-label="Energy sections">${['overview', 'energy', 'charts', 'devices'].map(t => `<button data-tab="${t}" aria-pressed="${t === this._tab}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</nav>`;
      if (this._tab === 'energy') return tab + `<div class="energy-page">${this._charts.includes('statistics') ? this._statistics() : ''}${this._today()}</div>`;
      if (this._tab === 'charts') return tab + (this._charts.includes('power') ? this._power() : '') + (this._charts.includes('tariff') ? this._tariff() : '') + this._charts.filter(k => ['solar_chart','load_chart','battery_chart','grid_chart'].includes(k)).map(k => this._singlePower(k)).join('') + (!this._charts.some(k => ['power','tariff','solar_chart','load_chart','battery_chart','grid_chart'].includes(k)) ? '' : '');
      if (this._tab === 'devices') return tab + this._devices();
      return tab + this._overviewFrame() + this._today();
    }
    if (['solar_chart','load_chart','battery_chart','grid_chart'].includes(view)) return this._singlePower(view);
    return ({ house: () => this._house(), flow: () => this._flow(), statistics: () => this._statistics(), power: () => this._power(), battery: () => this._battery(), solar: () => this._tile('solar_power', 'Solar power', 'power'), grid: () => this._tile('grid_power', 'Grid power', 'power', 'grid'), forecast: () => this._forecast(true), tariff: () => this._tariff(), controls: () => this._controls(), optimizers: () => this._optimizers() })[view]?.()??'';
  }
  _render() {
    if (!this._config) return;
    if (this._dialogOpen) { this._renderPending = true; return; }
    const fonts = [['regular',400],['medium',500]].map(([key,weight]) => { const url=safeImageURL(this._config.fonts?.[key]); return url?`@font-face{font-family:SigenergyScene;src:url("${esc(url)}");font-weight:${weight};font-display:swap}`:''; }).join('');
    const night = this._uiNight(), background = dashboardBackgroundStyle(this._homepageBackground?.(), night);
    this.shadowRoot.innerHTML = `<style>${fonts}${STYLE}${SCENE_STYLE}${RESPONSIVE_STYLE}${PHOTO_STYLE}${OVERVIEW_STYLE}${OVERVIEW_LAYOUT_STYLE}${HOUSE_STYLE}${DEVICE_STYLE}</style><ha-card class="${night ? 'night' : 'day'}${this._config.card_layout==='compact'?' standalone-card':''}${this._config.embed_mode==='shell'?' embedded-shell':this._config.embedded?' embedded-card':''}"${background ? ` style="${esc(background)}"` : ''}>${this._header()}<main data-view="${esc(this._view)}" data-controls-layout="${esc(this._config.controls_layout??'auto')}" data-density="${esc(this._config.density??'comfortable')}">${this._content()}</main></ha-card>`;
    this.shadowRoot.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { this._tab = b.dataset.tab; this._render(); }));
    this.shadowRoot.querySelectorAll('[data-entity]').forEach(b => b.addEventListener('click', () => { if (b.dataset.entity) this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: b.dataset.entity }, bubbles: true, composed: true })); }));
    this.shadowRoot.querySelectorAll('[data-preview]').forEach(b => b.addEventListener('click', () => this._openPreview(b.dataset.preview)));
    this.shadowRoot.querySelectorAll('img').forEach(img => img.addEventListener('error', () => { img.hidden = true; if (img.alt) { const note = document.createElement('p'); note.className = 'art-error'; note.textContent = 'House image unavailable · switch to Flow'; img.parentNode.appendChild(note); } }));
  }
  _openPreview(mode) {
    const control = this._state('control_status')?.attributes ?? {}, nativeApi = control.control_api_version === 1 && control.config_entry_id === this._config.config_entry;
    const batteryExport = mode === 'battery_export', readOnly = this._readOnly() || batteryExport && (!nativeApi || control.export_permitted !== true), label = { charge: 'Charge', discharge: 'Discharge Battery to Home Load', battery_export: 'Discharge Battery to Grid', hold: 'Hold battery', self_consumption: 'Self-consumption' }[mode] ?? mode;
    const restriction = batteryExport ? this._batteryExportRestriction() : '';
    const needsPower = ['charge', 'discharge', 'battery_export'].includes(mode), settings = manualPowerOptions(this._state('control_status')?.attributes?.manual_control_power ?? (this._config.cloud_paused ? this._config.manual_control_power : undefined), batteryExport ? 'discharge' : mode);
    const initial = settings.choices.find(choice => !choice.disabled)?.id ?? 'custom', custom = initial === 'custom';
    const bounds = `${settings.min_kw === null ? '' : ` min="${settings.min_kw}"`}${settings.max_kw === null ? '' : ` max="${settings.max_kw}"`}`;
    const durationSettings = manualDurationOptions(this._state('control_status')?.attributes?.max_duration_minutes);
    const durationInitial = durationSettings.choices.find(choice => !choice.disabled)?.minutes ?? 'custom', customDuration = durationInitial === 'custom';
    const durationFields = `<label>Duration<select name="duration_choice">${durationSettings.choices.map(choice => `<option value="${choice.minutes}"${choice.minutes === durationInitial ? ' selected' : ''}${choice.disabled ? ' disabled' : ''}>${choice.minutes} minutes</option>`).join('')}<option value="custom"${customDuration ? ' selected' : ''}>Custom</option></select></label><label id="custom-duration"${customDuration ? '' : ' hidden'}>Duration (minutes)<input name="duration" type="number" min="1" max="${durationSettings.max_minutes}" step="1"${customDuration ? ' required' : ' disabled'}></label>`;
    this._dialogOpen = true;
    const dialog = document.createElement('dialog'); dialog.setAttribute('aria-labelledby','sigen-manual-heading'); dialog.className = `sigen-manual-dialog${this._uiNight() ? ' night' : ''}`; dialog.innerHTML = `<form method="dialog"><div class="section-title"><h2 id="sigen-manual-heading">${esc(label)}</h2><button type="button" id="control-close" class="dialog-close" aria-label="Close">×</button></div>${durationFields}${needsPower ? `<label>Power<select name="power_choice">${settings.choices.map(choice => `<option value="${choice.id}"${choice.id === initial ? ' selected' : ''}${choice.disabled ? ' disabled' : ''}>${choice.label}${choice.power_kw === null ? '' : ` (${esc(choice.power_kw)} kW)`}${choice.disabled ? ' — outside configured bounds' : ''}</option>`).join('')}<option value="custom"${custom ? ' selected' : ''}>Custom</option></select></label><label id="custom-power"${custom ? '' : ' hidden'}>Power (kW)<input name="power" type="number"${bounds} step="any"${custom ? ' required' : ' disabled'}></label>` : ''}<div class="control-buttons"><button type="button" id="control-cancel">Cancel</button><button type="button" id="preview-confirm"${readOnly || !settings.valid_bounds ? ' disabled' : ''}>${readOnly ? 'Apply' : 'Preview'}</button></div><output aria-live="polite">${readOnly ? esc(restriction) : settings.valid_bounds ? '' : 'Power limits are inconsistent'}</output></form>`;
    if(nativeApi){const active=Date.parse(control.manual_until)>Date.now()||['queued','uncertain','interrupted','recovery_pending'].includes(control.operation?.phase);dialog.innerHTML=dialog.innerHTML.replace('</div><output',`<button type="button" id="control-release"${active?'':' hidden'}>Stop control</button></div><output`);}
    this._manualDialog = dialog;
    this.shadowRoot.appendChild(dialog); dialog.showModal(); dialog.addEventListener('close', () => {
      if(this._manualDialog === dialog)this._manualDialog = null;
      this._dialogOpen = false; dialog.remove();
      if (this._renderPending) { this._renderPending = false; this._render(); }
    });
    const form = dialog.querySelector('form'), close = () => dialog.close('cancel');
    dialog.querySelector('#control-release')?.addEventListener('click',async()=>{
      const button=dialog.querySelector('#control-release');button.disabled=true;
      try{const response=await this._hass.callWS({type:'call_service',domain:'sigen_hybrid',service:'cancel_manual_control',return_response:true,service_data:{config_entry:this._config.config_entry}});dialog._sigenRequestId=response?.response?.request_id;dialog.querySelector('output').textContent=response?.response?.message??'Releasing control';this._syncManualOperation();}
      catch{dialog.querySelector('output').textContent='Release not confirmed. Check controller recovery.';button.disabled=false;}
    });
    form.addEventListener('submit', event => event.preventDefault());
    dialog.querySelector('#control-cancel').addEventListener('click', close);
    dialog.querySelector('#control-close').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    });
    form.elements.duration_choice.addEventListener('change', () => {
      const custom = form.elements.duration_choice.value === 'custom';
      dialog.querySelector('#custom-duration').hidden = !custom;
      form.elements.duration.disabled = !custom; form.elements.duration.required = custom;
    });
    if (needsPower) form.elements.power_choice.addEventListener('change', () => {
      const custom = form.elements.power_choice.value === 'custom';
      dialog.querySelector('#custom-power').hidden = !custom;
      form.elements.power.disabled = !custom; form.elements.power.required = custom;
    });
    if(nativeApi)dialog.querySelector('#preview-confirm').textContent = 'Apply';
    let fingerprint = '', requestId = '', waiting = false;
    dialog.querySelector('#preview-confirm').addEventListener('click', async () => {
      const currentControl = this._state('control_status')?.attributes ?? {};
      if(waiting){const op=currentControl.operation;if(op?.request_id!==requestId||['queued','cancelling','uncertain','interrupted','recovery_pending'].includes(op.phase))return;waiting=false;}
      if(nativeApi && (currentControl.control_api_version !== 1 || currentControl.config_entry_id !== this._config.config_entry)){dialog.querySelector('#preview-confirm').disabled=true;return;}
      if (this._readOnly() || batteryExport && (!nativeApi || currentControl.export_permitted !== true)) { dialog.querySelector('#preview-confirm').disabled = true; dialog.querySelector('output').textContent = restriction; return; }
      if (!form.reportValidity()) return;
      const selectedDuration = durationSettings.choices.find(choice => String(choice.minutes) === form.elements.duration_choice.value);
      const rawDuration = selectedDuration ? selectedDuration.minutes : form.elements.duration_choice.value === 'custom' ? form.elements.duration.value : '';
      const duration = ['number', 'string'].includes(typeof rawDuration) && String(rawDuration).trim() ? Number(rawDuration) : NaN;
      const durationMaximum = manualDurationOptions(this._state('control_status')?.attributes?.max_duration_minutes).max_minutes;
      if (!Number.isInteger(duration) || duration < 1 || duration > durationMaximum) { dialog.querySelector('output').textContent = `Enter whole minutes between 1 and ${durationMaximum}`; return; }
      let power;
      if (needsPower) {
        const chosen = settings.choices.find(choice => choice.id === form.elements.power_choice.value);
        const raw = chosen ? chosen.power_kw : form.elements.power_choice.value === 'custom' ? form.elements.power.value : '';
        power = raw === null || raw === undefined ? NaN : typeof raw === 'number' ? raw : String(raw).trim() ? Number(raw) : NaN;
        const current = manualPowerOptions(this._state('control_status')?.attributes?.manual_control_power, batteryExport ? 'discharge' : mode);
        if(nativeApi && chosen?.id === 'system_limits' && Number.isFinite(current.max_kw))power = current.max_kw;
        const error = !current.valid_bounds ? 'Power limits are inconsistent' : chosen?.id === 'system_limits' && !nativeApi ? 'Choose a numeric power limit or Custom' : !Number.isFinite(power) || power <= 0 ? 'Enter a positive power in kW' : current.min_kw !== null && power < current.min_kw ? `Power must be at least ${current.min_kw} kW` : current.max_kw !== null && power > current.max_kw ? `Power cannot exceed ${current.max_kw} kW` : '';
        if (error) { dialog.querySelector('output').textContent = error; return; }
      }
      const button = dialog.querySelector('#preview-confirm'); button.disabled = true;
      try {
        const data = { config_entry: this._config.config_entry, mode: batteryExport ? 'discharge' : mode, duration_minutes: duration, ...(power === undefined ? {} : { power_kw: power }), export_requested: batteryExport, dry_run: !nativeApi };
        const next = JSON.stringify(data);
        if(next !== fingerprint){fingerprint = next;requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;}
        if(nativeApi){data.request_id = requestId;dialog._sigenRequestId = requestId;}
        const response = await this._hass.callWS({ type: 'call_service', domain: 'sigen_hybrid', service: 'manual_control', return_response: true, service_data: data });
        waiting = nativeApi && ['queued','cancelling'].includes(response?.response?.phase);
        dialog.querySelector('output').textContent = response?.response?.message ?? (nativeApi ? 'Command submitted; awaiting controller status.' : 'Preview returned; no device command sent.');
        this._syncManualOperation();
      } catch { dialog.querySelector('output').textContent = nativeApi ? 'Command not confirmed. Check controller status before retrying.' : 'Preview rejected or unavailable. Check controller limits and fresh telemetry.'; }
      finally { button.disabled = this._readOnly() || waiting; this._syncManualOperation(); }
    });
  }
  _syncManualOperation() {
    const dialog = this._manualDialog, operation = this._state('control_status')?.attributes?.operation;
    if(!dialog || !operation || operation.request_id !== dialog._sigenRequestId)return;
    const output = dialog.querySelector('output'), button = dialog.querySelector('#preview-confirm');
    const release=dialog.querySelector('#control-release');if(release){release.hidden=!(Date.parse(this._state('control_status')?.attributes?.manual_until)>Date.now()||['queued','uncertain','interrupted','recovery_pending'].includes(operation.phase));release.disabled=operation.phase==='cancelling';}
    if(output && operation.message)output.textContent = operation.message;
    if(button)button.disabled = this._readOnly() || ['queued','cancelling','uncertain','interrupted','recovery_pending'].includes(operation.phase);
  }
}

const STYLE = `
.connection-strip{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}.connection-indicator{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:4px 8px;color:var(--muted);font:inherit;font-size:10px;min-height:26px}.connection-indicator i{width:7px;height:7px;border-radius:50%;background:#8391a0}.connection-indicator[data-tone=green] i{background:#26c99b}.connection-indicator[data-tone=red] i{background:#ef6868}.connection-indicator[data-tone=amber] i{background:#e6b447}

dialog.sigen-manual-dialog{--sigen-manual-bg:#edf4fa;--ink:#1e2b43;--muted:#657a99;--surface:#fff;--line:#dce7ee;width:min(420px,calc(100vw - 32px));max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow:auto;border:1px solid var(--line);background:var(--sigen-manual-bg);color:var(--ink);font:14px system-ui,sans-serif;box-shadow:0 22px 100px #122b5140;color-scheme:light}dialog.sigen-manual-dialog.night{--sigen-manual-bg:#222d3a;--ink:#edf4ff;--muted:#a8b8ce;--surface:#2c3949;--line:#405164;color-scheme:dark}dialog.sigen-manual-dialog input,dialog.sigen-manual-dialog select{border-color:var(--line);background:var(--surface);color:var(--ink)}dialog.sigen-manual-dialog .control-buttons{margin-top:20px}dialog.sigen-manual-dialog .control-buttons button{border-color:var(--line);background:var(--surface);color:var(--ink)}dialog.sigen-manual-dialog output{color:var(--muted)}
dialog .dialog-close{border:0;background:transparent;padding:4px 8px;font-size:24px;line-height:1}dialog select{display:block;width:100%;border:1px solid #92a2b8;border-radius:8px;background:var(--card-background-color,#fff);color:inherit;padding:10px;margin-top:8px}dialog [hidden]{display:none}
:host{display:block;container-type:inline-size;color:var(--primary-text-color,#1d293e);font-family:var(--paper-font-body1_-_font-family,system-ui,sans-serif);font-size:14px}*{box-sizing:border-box}ha-card{--ink:#1e2b43;--muted:#657a99;--surface:rgba(255,255,255,.8);--line:rgba(128,155,182,.18);display:block;overflow:hidden;border:1px solid var(--line);border-radius:28px;background:radial-gradient(ellipse at 85% 0%,#c9f5f4 0,transparent 38%),linear-gradient(150deg,#f0f6fb,#e5eef7);color:var(--ink);box-shadow:0 8px 36px #284c7010}.night{--ink:#edf4ff;--muted:#a8b8ce;--surface:rgba(255,255,255,.045);--line:rgba(177,198,223,.13);background:radial-gradient(ellipse at 85% 0%,#17444e 0,transparent 42%),linear-gradient(145deg,#242a34,#171e28)}header{padding:24px 26px 18px;display:flex;align-items:center;justify-content:space-between;gap:18px}.eyebrow{font-size:10px;font-weight:700;letter-spacing:.2em;color:var(--muted)}h1{font-size:26px;letter-spacing:-.04em;margin:3px 0 0;font-weight:650}h2{font-size:17px;letter-spacing:-.02em;font-weight:600;margin:0}h3{font-size:14px;font-weight:600}small,.caption{color:var(--muted)}small{font-size:12px}strong{font-variant-numeric:tabular-nums}button,input{font:inherit;color:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #00b9c3;outline-offset:3px}button:disabled{opacity:.45;cursor:default}.badges{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px}.badge{display:inline-flex;font-size:10px;line-height:1.4;border:1px solid var(--line);border-radius:30px;background:var(--surface);padding:6px 10px;color:var(--muted)}main{padding:0 18px 18px}nav{display:flex;gap:5px;border-bottom:1px solid var(--line);padding:0 2px 13px;margin-bottom:16px}nav button,.switcher button{border:0;border-radius:30px;background:transparent;color:var(--muted);padding:10px 16px;min-height:40px}nav button[aria-pressed=true],.switcher button[aria-pressed=true]{background:var(--surface);color:var(--ink);box-shadow:0 2px 7px #284c7010}.overview-grid{display:grid;gap:16px}.hero,.panel{min-width:0;background:var(--surface);border:1px solid var(--line);border-radius:23px;padding:18px}.hero{background:transparent;border:0;padding:8px 0}.summary{display:grid;gap:12px}.section-title{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}.section-title h2 small{font-weight:400}.switcher{display:flex;border:1px solid var(--line);border-radius:24px}.switcher button{font-size:11px;padding:5px 12px;min-height:32px}.scene{position:relative;aspect-ratio:1.12;max-width:800px;margin:auto;isolation:isolate}.art{position:absolute;width:100%;height:100%;inset:0;object-fit:contain;pointer-events:none}.scene-top{position:absolute;top:0;left:4%;right:4%;display:flex;justify-content:space-between;align-items:center;font-size:12px;z-index:2}.scene-reading{position:absolute;z-index:3}.scene-reading button{background:transparent;border:0;border-left:1px solid var(--line);padding:3px 8px;text-align:left;display:block}.scene-reading strong{display:block;font-size:clamp(12px,2.6cqi,21px);font-weight:650}.scene-reading small{display:block;font-size:clamp(9px,1.8cqi,12px);text-transform:uppercase;margin-top:3px}.scene-reading em{font-size:10px;font-style:normal;color:#00abb8;display:inline-block;margin-top:3px}.scene-reading.solar{left:43%;top:12%}.scene-reading.home{left:77%;top:14%}.scene-reading.battery{left:41%;top:82%}.scene-reading.grid{left:76%;top:82%}.scene-reading.ac{left:7%;top:34%}.scene-reading.dc{left:7%;top:82%}.caption{font-size:11px;line-height:1.6;margin:12px 0 0}.scene-wrap>.caption{text-align:center}.art-missing{position:absolute;inset:16% 8%;border:1px dashed var(--line);border-radius:24px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;color:var(--muted);text-align:center}.art-error{position:absolute;top:50%;width:100%;text-align:center;color:var(--muted)}.battery-summary{display:flex;gap:20px;align-items:center;padding:5px}.battery-summary>div>small{display:block;margin-top:6px}.big{font-size:25px;letter-spacing:-.03em}.soc-ring{width:86px;height:86px;border-radius:50%;background:conic-gradient(#25c7c8 var(--soc),var(--line) 0);padding:6px;flex-shrink:0}.soc-ring strong{height:100%;border-radius:50%;background:var(--sigen-ring-bg,#eef5f8);color:var(--ink);display:flex;align-items:center;justify-content:center;font-size:26px}.soc-ring small{font-size:12px;margin-left:1px}.mini-grid,.totals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.tile{border:0;background:var(--surface);border-radius:14px;padding:14px;display:flex;align-items:center;gap:12px;text-align:left;width:100%;min-width:0}.tile strong{font-size:20px;letter-spacing:-.03em;display:block}.tile small{display:block;margin-top:5px}.tile i,.legend i{width:10px;height:10px;border-radius:50%;background:var(--tone);flex-shrink:0;box-shadow:0 0 0 5px color-mix(in srgb,var(--tone) 13%,transparent)}.price-pair{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-top:15px}.price-pair strong{display:block;margin-top:5px;font-size:18px}.control-buttons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.control-buttons button{border:1px solid var(--line);border-radius:12px;background:var(--surface);min-height:44px;font-size:12px}.control-buttons button:hover{border-color:#26c9c8}.panel+.panel{margin-top:14px}.summary .panel+.panel{margin-top:0}.overview-grid+section{margin-top:16px}.flow svg,.statistics,.chart{width:100%;height:auto;display:block}.wire{stroke:var(--line);stroke-width:5;fill:none}.wire.active{stroke:var(--tone);stroke-dasharray:8 6;animation:flow 3s linear infinite}.node,.bus{fill:var(--surface);stroke:var(--line);stroke-width:2}.node-value{fill:var(--ink);font-size:18px;font-weight:600}.node-name{fill:var(--muted);font-size:13px}.bus-label{fill:var(--muted);font-size:10px;letter-spacing:.1em}.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:11px;color:var(--muted);margin:16px 0}.legend span{display:flex;align-items:center;gap:9px}.legend i{width:8px;height:8px}.chart text{fill:var(--muted);font:11px system-ui}.gridline{stroke:var(--line);stroke-dasharray:4 5;fill:none}.chart-empty{height:130px;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--muted)}.module-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-top:15px}.module{border:1px solid var(--line);background:var(--surface);border-radius:14px;padding:14px;text-align:left}.module span,.module strong,.module small{display:block;margin-bottom:6px}.module strong{font-size:20px}footer{border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:10px;padding:12px 24px;color:var(--muted);font-size:10px}output{display:block;margin-top:10px;font-size:12px;line-height:1.5}dialog{border:1px solid var(--line);border-radius:20px;background:var(--card-background-color,#fff);color:var(--primary-text-color,#1e2b43);padding:24px;max-width:min(420px,90vw)}dialog::backdrop{background:#10233566}dialog label{display:block;margin-top:18px}dialog input{display:block;width:100%;border:1px solid #92a2b8;border-radius:8px;padding:10px;margin-top:8px}dialog p{font-size:12px;color:#637590}@keyframes flow{to{stroke-dashoffset:-56}}@media(prefers-reduced-motion:reduce){.wire.active{animation:none}}@container(min-width:650px){.overview-grid{grid-template-columns:minmax(0,1.3fr) minmax(250px,1fr)}.totals{grid-template-columns:repeat(3,minmax(0,1fr))}.scene{margin-top:18px}.tile strong{font-size:22px}}@container(min-width:1000px){main{padding:0 26px 24px}.overview-grid{grid-template-columns:minmax(0,1.7fr) minmax(290px,1fr)}.summary{gap:14px;align-content:start}.hero{padding:10px 16px 0 0}.scene{max-height:620px}.totals{grid-template-columns:repeat(6,minmax(0,1fr))}.tile{padding:18px 12px}.tile strong{font-size:20px}.scene-reading strong{font-size:22px}}@container(max-width:420px){header{padding:20px 18px 14px;align-items:flex-start;flex-direction:column;gap:10px}.badges{justify-content:flex-start}h1{font-size:24px}main{padding:0 10px 12px}nav{gap:0}nav button{padding:8px 13px;font-size:12px}.panel{padding:15px;border-radius:19px}.hero{padding:4px 0}.scene-reading strong{font-size:13px}.scene-reading small{font-size:9px}.scene-reading em{font-size:9px}.tile{padding:13px 11px}.tile strong{font-size:18px}.section-title{flex-wrap:wrap}footer{padding:12px 16px;font-size:9px}}
`;

const SCENE_STYLE = `
ha-card{--sigen-ring-bg:#eef5f8}ha-card.night{--sigen-ring-bg:#242f3a}.scene-wrap{max-width:1028px}.portal-scene{width:100%;height:auto;display:block;overflow:visible}.portal-scene text{font-family:SigenergyScene,Poppins,system-ui,sans-serif}.portal-value{fill:var(--ink);font-size:24px;font-weight:500}.portal-label{fill:var(--muted);font-size:20px}.portal-leader{fill:none;stroke:#8f98a4;stroke-width:1;opacity:.6}.portal-status-bg{fill:var(--surface)}.portal-status{fill:var(--muted);font-size:20px;letter-spacing:.7px}.portal-temperature{fill:var(--ink);font-size:23px}.portal-cable{fill:none;stroke:#d6dce3;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;opacity:.8}.night .portal-cable{stroke:#717b82;opacity:.65}.portal-pulse{fill:none;stroke:#24d5c4;stroke-width:3.2;stroke-dasharray:105 895;stroke-linecap:round;opacity:0;filter:drop-shadow(0 0 2px #2bdcca55)}.portal-pulse.moving{opacity:1;animation:portal-flow 3.4s linear infinite}.portal-pulse.reverse{animation-direction:reverse}.portal-grid-status-bg{fill:#00c1c5;opacity:.08}.portal-grid-status{fill:#00bec4;font-size:22px}.portal-ac-status-bg{fill:#c09bff;opacity:.5}.portal-ac-status{fill:#55368e;font-size:21px}.night .portal-ac-status{fill:#d7b8ff}.portal-scene [data-entity]{cursor:pointer}.portal-scene [data-entity]:focus-visible{outline:2px solid #00b8c4}.panel-strings{display:grid;gap:10px}.compact-modules{display:grid;grid-template-columns:repeat(12,minmax(0,52px));gap:6px}.panel-module{position:relative;max-width:52px;min-width:0;border:1px solid #2c658b;border-radius:5px;aspect-ratio:2/3;padding:4px;display:flex;flex-direction:column;justify-content:space-between;align-items:center;color:#e1f4ff;background:repeating-linear-gradient(0deg,transparent 0,transparent 23%,#ffffff14 24%,transparent 25%),repeating-linear-gradient(90deg,#102c45 0,#102c45 24%,#ffffff18 25%,#102c45 26%);box-shadow:inset 0 0 8px #0003}.panel-module span{align-self:flex-start;font-size:9px;color:#b8d0e4}.panel-module strong{font-size:clamp(9px,1.1cqi,13px);font-weight:600;padding:3px 1px;white-space:nowrap;text-shadow:0 1px 2px #000;background:#0a213cc9;border-radius:3px}.compact-modules.landscape .panel-module{aspect-ratio:3/2}.panel-strings.vertical{grid-template-columns:repeat(auto-fit,minmax(70px,1fr));align-items:start}.compact-modules.vertical{grid-auto-flow:column;grid-template-rows:repeat(12,auto);grid-template-columns:repeat(auto-fit,minmax(44px,52px))}.compact-modules.vertical .panel-module{max-height:75px}.panel-string h3{margin:10px 0}.panel-string h3 small{font-weight:400}@keyframes portal-flow{to{stroke-dashoffset:-1000}}@media(prefers-reduced-motion:reduce){.portal-pulse.moving{animation:none;stroke-dasharray:none;opacity:.45}}@container(max-width:650px){.compact-modules{grid-template-columns:repeat(8,minmax(0,52px))}}@container(max-width:420px){.compact-modules{grid-template-columns:repeat(6,minmax(0,52px))}.portal-value{font-size:34px}.portal-label{font-size:27px}.portal-ac-status{font-size:26px}.portal-grid-status{font-size:28px}}
.statistics{margin:18px auto 0;max-width:900px}.sankey-label{fill:#172c3d;font:13px system-ui}.sankey-value{fill:var(--node-ink,#152c40);font-size:25px;font-weight:750;letter-spacing:-.4px}.sankey-unit{fill:var(--node-ink,#18334a);font-size:12px}.sankey-percent{fill:var(--node-ink,#18334a);font-size:17px}.sankey-zero{fill:var(--muted);font-size:13px}
.scene-wrap{max-width:1028px;margin:auto}.scene-status{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;color:var(--muted);font-size:12px}.scene-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:12px 0}.scene-metric{display:block;width:100%;text-align:left;padding:12px 16px;border:1px solid var(--line);border-radius:16px;background:var(--surface)}.scene-metric small{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.04em}.scene-metric strong{display:block;font-size:clamp(18px,2.3cqi,25px);margin-top:5px;white-space:nowrap;letter-spacing:-.035em}.scene-metric em{display:block;font-size:11px;font-style:normal;color:#00aab5;margin-top:5px}.inline-soc{font-size:.72em;color:var(--muted);font-weight:500}.art-stage{position:relative;isolation:isolate;width:100%;aspect-ratio:1.12;margin:20px auto}.house-wires{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.house-cable{fill:none;stroke:var(--ink);stroke-opacity:.18;stroke-width:4;stroke-linecap:round;stroke-linejoin:round}.house-pulse{fill:none;stroke:#14d4cc;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:80 920;opacity:0;filter:drop-shadow(0 0 3px #24dbd180)}.house-pulse.moving{opacity:1;animation:house-flow 3s linear infinite}.house-pulse.reverse,.wire.reverse{animation-direction:reverse}.charger-readings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}.charger-readings .tile{border:1px solid var(--line)}@keyframes house-flow{to{stroke-dashoffset:-1000}}@media(prefers-reduced-motion:reduce){.house-pulse.moving{animation:none;stroke-dasharray:none;opacity:.5}}@container(max-width:420px){.scene-metric{padding:12px}.scene-metric strong{font-size:19px}.scene-metrics{gap:10px}.art-stage{margin:24px auto}.charger-readings .tile strong{font-size:18px}}
`;

const RESPONSIVE_STYLE = `
.portal-status{pointer-events:none}.portal-status-bg{cursor:pointer}
.summary{align-content:start}
@container(min-width:650px) and (max-width:899px){.overview-grid{grid-template-columns:minmax(0,1fr)}.summary{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}}
`;

const OVERVIEW_LAYOUT_STYLE = `
.energy-totals-launch{border:1px solid var(--line);border-radius:20px;background:var(--surface);color:inherit;padding:7px 13px;font:inherit;font-size:12px}
@container(min-width:620px){.energy-page .statistics{width:100%;height:clamp(180px,calc(100dvh - 490px),700px)}.energy-page>.panel{padding:14px}.energy-page .totals .tile{padding:10px}.energy-page .totals .tile strong{font-size:18px}main[data-view=statistics] .statistics{width:100%;height:clamp(180px,calc(100dvh - 330px),800px)}}
.compact-overview.overview-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:20px;align-items:start;width:100%;margin:0}.compact-overview>.hero{padding:0;min-width:0}.main-display-stage{width:100%;margin:0 auto;container-type:inline-size}.main-display-stage[data-display=house],.main-display-stage[data-display=photo],.main-display-stage[data-display=flow]{max-width:none}.main-display-stage>.scene-wrap,.main-display-stage>.flow{width:100%;max-width:none;margin:0 auto}.overview-sidebar{display:flex;flex-direction:column;align-self:stretch;gap:14px;min-width:0}.overview-side-module{min-width:0}.overview-sidebar .panel{margin:0;padding:17px}.overview-sidebar .control-buttons button{min-height:40px}.overview-sidebar .panel>output:empty{display:none}.overview-sidebar .mini-grid .tile{padding:12px 10px;gap:10px}.overview-sidebar .mini-grid .tile strong{font-size:20px}.overview-sidebar .mini-grid .tile small{font-size:11px}.overview-sidebar .mini-grid .tile i{width:8px;height:8px}.overview-sidebar .overview-energy-metric{min-height:70px;padding:10px 12px}.overview-sidebar .overview-energy-metric strong{font-size:20px}.overview-sidebar .overview-compact-panel h2{font-size:18px;margin-bottom:13px}.overview-sidebar .overview-battery-level h2{margin-bottom:10px}.overview-sidebar .overview-battery-track{margin:12px 0 10px}.overview-device-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;max-width:none;margin:16px auto 0}.overview-device-links button{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:64px;border:1px solid var(--line);border-radius:13px;padding:10px 13px;background:var(--surface);color:inherit;text-align:left;font-size:12px}.overview-device-links button span{color:var(--muted);font-size:19px}.overview-sidebar .overview-device-links{grid-template-columns:repeat(2,minmax(0,1fr));margin:auto 0 0;gap:8px}.overview-sidebar .overview-device-links>.overview-mode-control{grid-column:1/-1;min-height:60px;gap:2px;padding:8px 12px}.overview-sidebar .overview-mode-control select{min-height:24px}.overview-sidebar .overview-device-links button{min-height:44px;padding:10px 12px;font-size:11px}.overview-forecast{margin-top:18px}.hero>.section-title{flex-wrap:wrap;gap:10px}.hero .switcher{flex-wrap:wrap;max-width:100%}.hero .switcher button{white-space:nowrap}.portal-badge-container{overflow:visible}.portal-badge-container div,.portal-badge-container span{box-sizing:border-box;font-family:SigenergyScene,Poppins,system-ui,sans-serif}.portal-status-holder{display:flex;justify-content:center;width:100%;height:100%;align-items:flex-start}.portal-status-holder>.portal-status-bg{display:inline-block;width:max-content;max-width:90%;padding:9px 24px;border-radius:999px;background:var(--surface);text-align:center;white-space:nowrap;cursor:pointer}.portal-status-holder .portal-status{color:var(--muted);font-size:20px;line-height:1.4;letter-spacing:.7px}.portal-ac-status,.portal-grid-status{display:inline-block;width:max-content;max-width:none;white-space:nowrap;line-height:1.2;padding:2px 6px;border-radius:12px}.portal-ac-status{color:#55368e;background:#c09bff80}.night .portal-ac-status{color:#d7b8ff}.portal-grid-status{color:#00bec4;background:#00c1c515}.portal-status{pointer-events:auto}.statistics{width:100%;max-width:none}.record-download-controls{display:grid;gap:16px;max-width:560px;margin:0 auto}.record-download-controls label{display:grid;gap:8px}.record-download-controls input,.record-download-controls select{width:100%;min-width:0;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:inherit;font:inherit}.sankey-note{margin:12px 0 0;font-size:12px;line-height:1.4;color:var(--muted)}.detail-toolbar:has([data-statistics-date]){display:grid;grid-template-columns:44px minmax(0,1fr) 44px auto;align-items:center;gap:12px}.detail-toolbar input[data-statistics-date]{width:100%;min-width:0}.detail-toolbar [data-statistics-step]{width:44px;height:44px}.detail-toolbar select[data-statistics-period]{min-width:110px}@container(max-width:500px){.detail-toolbar:has([data-statistics-date]){grid-template-columns:38px minmax(0,1fr) 38px;gap:8px}.detail-toolbar select[data-statistics-period]{grid-column:1/-1}}
.overview-primary-controls{margin-top:14px;container-type:inline-size}.overview-primary-controls>.panel{margin:0;padding:17px}.instant-manual-panel>output:empty{display:none}.battery-control-buttons>button:last-child:nth-child(odd){grid-column:1/-1}.overview-charger-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}.overview-charger-control{min-width:0}.overview-charger-heading{display:flex;align-items:center;justify-content:space-between;width:100%;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;padding:0 0 9px}.overview-charger-heading span{font-size:18px;color:var(--muted)}.overview-device-links>.overview-mode-control{grid-column:1/-1}.overview-mode-control{display:grid;gap:4px;min-width:0;min-height:64px;border:1px solid var(--line);border-radius:13px;padding:9px 13px;background:var(--surface);color:inherit}.overview-mode-control>span{font-size:11px;color:var(--muted)}.overview-mode-control select{display:block;width:100%;min-width:0;min-height:27px;border:0;background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer}.overview-mode-control option{background:var(--sigen-menu-bg,#f7fbff);color:var(--ink)}.night .overview-mode-control option{background:#283647}.overview-mode-control select:focus-visible{outline:2px solid #00b9c3;outline-offset:3px}@container(min-width:560px){.overview-primary-controls .battery-control-buttons{grid-template-columns:repeat(5,minmax(0,1fr))}.overview-primary-controls .battery-control-buttons>button:last-child{grid-column:auto}}@container(max-width:420px){.overview-charger-controls{grid-template-columns:minmax(0,1fr)}}
.overview-summary-stack{display:grid;gap:14px;min-width:0;align-content:start}.overview-sidebar .overview-device-links{grid-template-columns:minmax(0,1fr);grid-template-rows:repeat(3,minmax(60px,1fr));min-width:0;margin:0}.overview-sidebar .overview-device-links>*{min-width:0;width:100%}.overview-sidebar .overview-device-links>.overview-mode-control{grid-column:auto;min-height:0;align-content:center}.overview-sidebar .overview-battery-level{padding:13px 17px}.overview-sidebar .overview-battery-level h2{margin-bottom:8px}.overview-sidebar .overview-battery-soc{font-size:22px}.overview-sidebar .overview-battery-track{height:8px;margin:9px 0 8px}.overview-sidebar .overview-battery-energy{font-size:12px}@container(min-width:620px){@supports(grid-template-rows:subgrid){.compact-overview.overview-grid.overview-aligned-controls{grid-template-rows:auto auto;row-gap:14px;align-items:stretch}.compact-overview.overview-aligned-controls>.hero,.compact-overview.overview-aligned-controls>.overview-sidebar{display:grid;grid-template-rows:subgrid;grid-row:1/span 2;row-gap:14px}.compact-overview.overview-aligned-controls>.hero{grid-column:1}.compact-overview.overview-aligned-controls>.overview-sidebar{grid-column:2}.overview-aligned-controls .main-display-stage{grid-row:1;align-self:start}.overview-aligned-controls .overview-primary-controls{grid-row:2;margin-top:0;align-self:stretch}.overview-aligned-controls .overview-primary-controls>.panel{height:100%}.overview-aligned-controls .overview-summary-stack{grid-row:1}.overview-aligned-controls .overview-device-links{grid-row:2;align-self:stretch;height:100%}}}
@container(min-width:620px){.main-display-stage[data-display=flow]>.flow{width:80%}}
main[data-view=house]>.scene-wrap,main[data-view=flow]>.flow{width:72%;max-width:none;margin:auto}@container(max-width:650px){main[data-view=house]>.scene-wrap,main[data-view=flow]>.flow{width:100%}}
@container(min-width:620px){.compact-overview.overview-grid{grid-template-columns:minmax(0,1fr) clamp(250px,30cqi,380px);gap:22px}.compact-overview.overview-without-sidebar{grid-template-columns:minmax(0,1fr)}.overview-forecast{max-width:100%}}
@container(min-width:1100px){.overview-device-links{grid-template-columns:minmax(0,1.2fr) repeat(2,minmax(0,1fr));max-width:none}.overview-device-links>.overview-mode-control{grid-column:auto}.compact-overview.overview-grid{gap:30px}}
:host{container-name:sigen-card}@container sigen-card (min-width:1100px){.main-display-stage{position:relative;aspect-ratio:1490/673;min-height:0}.main-display-stage>.sigen-photo-scene,.main-display-stage>.scene-wrap,.main-display-stage[data-display=flow]>.flow{position:absolute;inset:0;width:100%;height:100%;margin:0}.main-display-stage .house-layout{height:100%;min-height:0;grid-template-rows:auto auto minmax(0,1fr) auto}.main-display-stage .house-header{grid-row:1}.main-display-stage .house-power-row{grid-row:2}.main-display-stage .house-canvas{grid-row:3;height:100%;min-height:0;aspect-ratio:auto}.main-display-stage .house-bottom-row{grid-row:4}.main-display-stage .house-art-missing{grid-row:3;align-self:center}.main-display-stage[data-display=flow]>.flow{display:grid;place-items:center}.main-display-stage[data-display=flow]>.flow>svg{width:88%;height:88%;object-fit:contain}}
@container(max-width:500px){.main-display-stage .portal-value{font-size:34px}.main-display-stage .portal-label{font-size:27px}.main-display-stage .portal-ac-status{font-size:26px}.main-display-stage .portal-grid-status{font-size:28px}.main-display-stage .node-value{font-size:25px}.main-display-stage .node-name{font-size:18px}}
`;

installNavigation(SigenHybridCard);
if (!customElements.get('sigen-hybrid-card')) customElements.define('sigen-hybrid-card', SigenHybridCard);
window.customCards = window.customCards ?? [];
if (!window.customCards.some(c => c.type === 'sigen-hybrid-card')) window.customCards.push({ type: 'sigen-hybrid-card', name: 'Sigenergy TC', description: 'Total Control: adaptive overview, original house artwork, flow and individual device/chart views', preview: true });
