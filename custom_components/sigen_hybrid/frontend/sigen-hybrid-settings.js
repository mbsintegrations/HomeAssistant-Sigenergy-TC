/* SPDX-License-Identifier: GPL-3.0-only
 * Local interface drafts. This module has no network or plant-control client.
 */
export const CHARGER_MORE_ROUTES = Object.freeze(['ac_more', 'dc_more', 'charger_ocpp', 'charger_cards', 'ac_load_management', 'ac_output_mode', 'ac_offgrid_charging', 'ac_indicator_lighting', 'ac_connectivity', 'ac_ethernet', 'ac_wlan', 'ac_cellular', 'dc_charging_settings', 'dc_v2x_operation']);
export const TARIFF_MAX_PERIODS = 24;
export const CHART_CHOICES=Object.freeze([
 ['power','Power metrics'],['solar','Solar production & forecast'],['pv_metrics','PV strings: power, voltage & current'],['load','Home consumption'],['battery','Battery charge & discharge'],['soc','Battery state of charge'],['grid','Grid import & export'],['price','Battery SOC & price trend'],['ac','AC charging'],['dc_metrics','DC charging: power, voltage & current'],['dc_soc','Vehicle state of charge'],['battery_temperature','Battery temperature'],['battery_soh','Battery state of health'],['inverter_power','Inverter output'],['inverter_temperature','Inverter temperature'],['grid_voltage','Grid voltage'],['grid_current','Grid current'],['grid_frequency','Grid frequency'],['grid_reactive','Grid reactive power'],['strings','PV string power'],['pv_voltage','PV voltage'],['pv_current','PV current'],['forecast','Solar forecast'],['dc','DC charging power'],['dc_voltage','DC voltage'],['dc_current','DC current']
]);
export const DEFAULT_CHART_SELECTION=Object.freeze(CHART_CHOICES.map(([key])=>key).filter(key=>!['load','strings','pv_voltage','pv_current','forecast','dc_metrics','dc_soc','dc_voltage','dc_current'].includes(key)));
export const HOMEPAGE_APPEARANCES = Object.freeze(['auto', 'day', 'night', 'theme']);
export const HOMEPAGE_BACKGROUNDS = Object.freeze(['theme', 'color', 'image']);
const DEFAULT_BACKGROUND_COLOR = '#17444e';
/** Background values become CSS image URLs; reject active CSS and non-web
 * schemes before they reach either the editor or the card renderer. */
export function validatedBackgroundURL(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\u0000-\u001f\u007f<>"'\\`(){};]/.test(value) || value.startsWith('//')) return '';
  if (!value.startsWith('/') && !value.startsWith('https://')) return '';
  try {
    const local = value.startsWith('/'), parsed = new URL(value, local ? 'https://home-assistant.invalid' : undefined);
    return (local || parsed.protocol === 'https:') && parsed.hostname && !parsed.username && !parsed.password ? value : '';
  } catch { return ''; }
}
export function homepageBackground(settings = {}) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
  const validColor = typeof settings.background_color === 'string' && /^#[0-9a-f]{6}$/i.test(settings.background_color);
  const color = validColor ? settings.background_color.toLowerCase() : DEFAULT_BACKGROUND_COLOR;
  const image = validatedBackgroundURL(settings.background_image);
  const selected = HOMEPAGE_BACKGROUNDS.includes(settings.background_type) ? settings.background_type : 'theme';
  return {type:selected === 'image' && !image || selected === 'color' && !validColor ? 'theme' : selected,color,image};
}
export const SETTINGS_ROUTES = Object.freeze(['chart_settings', 'settings', 'connection_settings', 'dashboard_install', 'system_settings', 'system_details', 'indicator_settings', 'system_maintenance', 'app_settings', 'display_settings', 'mode', 'tariffs', 'tariff_edit', 'tariff_seasons', 'tariff_season', 'strategies', 'strategy_control', 'strategy', 'priority', 'surplus_pv_priority', 'charging_mode', 'charger_schedules', 'charger_schedule', 'charger_records', 'vehicles', 'vehicle', 'device_settings', 'network', 'maintenance', 'add_device', 'pv_capacity', 'pv_brand', 'pv_model', 'string_names', 'safety', 'connections', 'forecast_settings', 'ai_settings', 'ai', 'revenue_calendar', 'energy_value', 'environment', 'about', ...CHARGER_MORE_ROUTES]);
export const DISPLAY_MODULES = Object.freeze([
  ['current_mode_battery', 'Current mode & battery level'], ['forecast', 'Solar forecast'], ['manual_controls', 'Manual controls'], ['ai', 'AI analysis'],
  ['statistics', 'Energy statistics'], ['power', 'Power metrics'], ['today', 'Energy cards'], ['tariff', 'Battery SOC & price'],
  ['strategies', 'Personal strategies'], ['energy_value', 'Energy value'], ['production', 'PV production'], ['consumption', 'Consumption'],
  ['solar_chart', 'Solar chart'], ['load_chart', 'Load chart'], ['battery_chart', 'Battery chart'], ['grid_chart', 'Grid chart'],
  ['energy_produced', 'Energy produced'], ['environment', 'Environmental benefits'],
].map(([key, label]) => Object.freeze({ key, label })));
const DISPLAY_KEYS = DISPLAY_MODULES.map(item => item.key);
export const DISPLAY_PRESETS = Object.freeze({
  classic: Object.freeze({ order: Object.freeze([...DISPLAY_KEYS]), hidden: Object.freeze(['ai', 'energy_value', 'production', 'consumption', 'solar_chart', 'load_chart', 'battery_chart', 'grid_chart']) }),
  advanced: Object.freeze({ order: Object.freeze([...DISPLAY_KEYS]), hidden: Object.freeze([]) }),
});
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const read = (ctx, key) => { try { return ctx.state?.(key); } catch { return undefined; } };
const attributes = (ctx, key) => object(read(ctx, key)?.attributes);
const stateText = value => value && !['unknown', 'unavailable', 'none', ''].includes(String(value.state ?? value)) ? String(value.state ?? value).replaceAll('_', ' ') : '—';
const current = (ctx, key) => stateText(read(ctx, key));
const value = (ctx, key, quantity = 'number') => { try { const v = ctx.value?.(key, quantity); return typeof v === 'number' && Number.isFinite(v) ? v : null; } catch { return null; } };
const numberText = (v, suffix = '') => typeof v === 'number' && Number.isFinite(v) ? `${v.toLocaleString(undefined, { maximumFractionDigits: 3 })}${suffix}` : '—';
const prefs = (ctx, route) => {
  const candidate = object(own(object(ctx.interfaceOptions), route));
  return ctx.id && own(candidate, ctx.id) ? object(candidate[ctx.id]) : candidate;
};
const row = (label, route, detail = '', id = '') => `<button type="button" class="settings-row" data-detail="${esc(route)}"${id ? ` data-id="${esc(id)}"` : ''}><span>${esc(label)}</span><span class="settings-row-value">${esc(detail)} <b aria-hidden="true">›</b></span></button>`;
const group = body => `<section class="settings-group">${body}</section>`;
const note = text => `<p class="settings-note">${esc(text)}</p>`;
const button = (label, route, id = '', extra = '') => `<button type="button" class="settings-secondary" data-detail="${esc(route)}"${id ? ` data-id="${esc(id)}"` : ''} ${extra}>${esc(label)}</button>`;
const disabled = label => `<button type="button" class="settings-apply" disabled aria-disabled="true">${esc(label)}</button>`;
const field = (name, label, val = '', extra = '') => `<label class="settings-field"><span>${esc(label)}${/\brequired\b/.test(extra) ? ' <abbr title="Required" aria-label="Required">*</abbr>' : ''}</span><input name="${esc(name)}" value="${esc(val)}" ${extra}></label>`;
const select = (name, label, selected, options, extra = '') => `<label class="settings-field"><span>${esc(label)}</span><select name="${esc(name)}" ${extra}>${options.map(option => { const [v, title] = Array.isArray(option) ? option : [option, option]; return `<option value="${esc(v)}"${String(selected) === String(v) ? ' selected' : ''}>${esc(title)}</option>`; }).join('')}</select></label>`;
const check = (name, label, checked) => `<label class="settings-check"><span>${esc(label)}</span><input type="checkbox" name="${esc(name)}"${checked === true ? ' checked' : ''}></label>`;
const textarea = (name, label, val = '') => `<label class="settings-field"><span>${esc(label)}</span><textarea name="${esc(name)}" maxlength="2000" rows="4">${esc(val)}</textarea></label>`;
const form = (route, body) => `<form data-settings-form="${esc(route)}">${body}<div class="settings-actions"><button type="button" class="settings-secondary" data-detail-back>Discard</button><button type="button" class="settings-save" data-save-settings="${esc(route)}">${['display_settings','chart_settings','app_settings','forecast_settings'].includes(route)?'Save preferences':'Save draft'}</button></div><output class="settings-form-result" aria-live="polite"></output></form>`;
const metric = (label, val, detail = '') => `<div class="settings-metric"><small>${esc(label)}</small><strong>${esc(val)}</strong>${detail ? `<span>${esc(detail)}</span>` : ''}</div>`;
const titleCase = text => String(text).replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const timeZone = ctx => { const candidate = prefs(ctx, 'tariff_edit').timezone || ctx.timezone || ctx.config?.time_zone || 'UTC'; try { new Intl.DateTimeFormat('en', { timeZone: candidate }); return candidate; } catch { return 'UTC'; } };
const dayPicker = (name, label, values) => {
  const selected = values === undefined ? DAYS : Array.isArray(values) ? values : typeof values === 'string' ? values.toLowerCase().split(',').map(day => day.trim()) : [];
  return `<fieldset class="settings-day-picker"><legend>${esc(label)} <small>Choose at least one</small></legend><div class="settings-weekdays">${DAYS.map((day, index) => `<label><input type="checkbox" name="${esc(name)}" value="${day}" aria-label="${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][index]}"${selected.includes(day) ? ' checked' : ''}><span>${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index]}</span></label>`).join('')}</div></fieldset>`;
};
const currencyPicker = currency => {
  const choice = ['EUR', 'GBP', 'USD'].includes(currency) ? currency : 'custom';
  return select('currency_choice', 'Currency', choice, [['EUR', 'EUR · Euro'], ['GBP', 'GBP · Pound'], ['USD', 'USD · Dollar'], ['custom', 'Other currency']]) + `<div class="settings-custom-currency">${field('currency', 'Currency code', choice === 'custom' ? currency : '', 'minlength="3" maxlength="3" pattern="[A-Z]{3}" placeholder="e.g. CAD"')}</div>`;
};
export const OPERATING_MODES = Object.freeze([['self_consumption', 'Self-Consumption'], ['sigen_ai', 'Sigen AI Mode'], ['tou', 'Time-based Control'], ['fully_feed_in', 'Fully Feed-into Grid'], ['remote_ems', 'Remote EMS Mode']].map(option => Object.freeze(option)));
const modes = OPERATING_MODES;
export const nativeModeChoices = ctx => ctx.controlPermission === true && ctx.capabilities?.native_mode?.available === true
  ? (ctx.state?.('control_status')?.attributes?.native_modes ?? []).filter(item=>Number.isInteger(item.mode)&&Number.isInteger(item.profile_id)&&typeof item.label==='string').map(item=>[`${item.mode}:${item.profile_id}`,item.label]) : [];
export const modeChoices = ctx => nativeModeChoices(ctx).length ? nativeModeChoices(ctx) : modes;
export const selectedMode = ctx => {
  const options=nativeModeChoices(ctx),label=current(ctx,'cloud_mode');
  return options.length ? options.find(([,text])=>text===label)?.[0]??'' : observedOperatingMode(ctx);
};
export const observedOperatingMode = ctx => {
  const recognized = { 'ai': 'sigen_ai', 'ai mode': 'sigen_ai', 'sigen ai': 'sigen_ai', 'sigen ai mode': 'sigen_ai', 'self consumption': 'self_consumption', 'self consumption mode': 'self_consumption', 'maximum self consumption': 'self_consumption', 'maximum self consumption mode': 'self_consumption', 'tou': 'tou', 'tou mode': 'tou', 'time of use': 'tou', 'time of use mode': 'tou', 'time based control':'tou', 'fully feed into grid':'fully_feed_in', 'fully feed in':'fully_feed_in', 'remote ems mode':'remote_ems', 'remote ems':'remote_ems' };
  for (const key of ['cloud_mode', 'native_mode']) {
    const reading = read(ctx, key), label = reading?.state ?? reading;
    if (reading?.attributes?.available === false) continue;
    if (typeof label !== 'string') continue;
    const mode = own(recognized, label.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' '));
    if (mode) return mode;
  }
  return '';
};
export function renderOverviewModeControl(ctx = {}) {
  const observed = selectedMode(ctx);
  return `<label class="overview-mode-control"><span>Current mode</span><select data-overview-mode aria-label="Current mode">${observed ? '' : '<option value="" selected disabled>Unavailable</option>'}${modeChoices(ctx).map(([value, label]) => `<option value="${esc(value)}"${value === observed ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label>`;
}
const STRATEGY_ACTIONS = Object.freeze([['charge','Force charge'],['discharge','Discharge to home'],['hold','Hold battery'],['export','Allow solar export'],['battery_export','Battery discharge to export']]);
function permissionFlag(value) {
  if(value&&typeof value==='object')value=value.state;
  if(typeof value==='boolean')return value;
  if(typeof value==='string'){const flag=value.trim().toLowerCase();if(['on','true','enabled','allowed','permitted'].includes(flag))return true;if(['off','false','disabled','blocked','not permitted'].includes(flag))return false;}
  return null;
}
export function strategyExportEligibility(ctx = {}) {
  const controls=attributes(ctx,'control_status'),supplied=[permissionFlag(read(ctx,'export_permitted')),permissionFlag(controls.export_permitted),permissionFlag(ctx.config?.export_permitted),permissionFlag(ctx.config?.safety_limits?.export_permitted)];
  const permitted=supplied.includes(false)?false:supplied.includes(true)?true:null;
  const blocked=permissionFlag(read(ctx,'block_battery_export'))===true||permissionFlag(ctx.config?.energy_profile?.block_battery_export?.enabled)===true;
  const capability=ctx.capabilities?.battery_export??ctx.config?.capabilities?.battery_export,unsupported=capability===false||capability?.supported===false||capability?.controllable===false;
  const allowed=permitted===true&&!blocked&&!unsupported;
  const reason=permitted===false?'Export permission is off. Save battery export as an inactive draft.':permitted===null?'Export permission is not confirmed. Save battery export as an inactive draft.':blocked?'Block Battery Grid Export is enabled. Save this strategy as an inactive draft.':unsupported?'Battery export control is unavailable on this connection. Save this strategy as an inactive draft.':'Battery export remains subject to the plant export limit and verified control support.';
  return {permitted,battery_blocked:blocked,allowed,reason};
}
export function bindStrategyEditor(formElement, ctx = {}) {
  if(!formElement||formElement._strategyBound)return;
  const action=formElement.querySelector('[data-strategy-action]'),enabled=formElement.querySelector('[name="enabled"]'),notice=formElement.querySelector('[data-strategy-export-note]');
  if(!action||!enabled||!notice)return;formElement._strategyBound=true;
  let restricted=false,previousInclude=false;
  const update=()=>{const batteryExport=action.value==='battery_export',eligibility=strategyExportEligibility(ctx),nextRestricted=batteryExport&&!eligibility.allowed;if(nextRestricted&&!restricted)previousInclude=enabled.checked;if(nextRestricted)enabled.checked=false;else if(restricted)enabled.checked=previousInclude;enabled.disabled=nextRestricted;restricted=nextRestricted;notice.hidden=!batteryExport;notice.textContent=eligibility.reason;};
  action.addEventListener('change',update);update();
}
const inventoryCapacity = ctx => {
  const list = Array.isArray(ctx.inventory) ? ctx.inventory : Array.isArray(ctx.config?.devices) ? ctx.config.devices : [];
  const arrays = list.filter(item => ['solar', 'pv', 'pvpanel', 'solarpanel', 'pvarray'].includes(String(item?.type ?? '').toLowerCase().replace(/[ _-]/g, '')));
  const selected = ctx.id ? arrays.find(item => String(item.id) === String(ctx.id)) : arrays.length === 1 ? arrays[0] : undefined;
  for (const [key, factor] of [['capacity_wp', 1], ['capacity_kwp', 1000]]) {
    const raw = selected?.[key] ?? selected?.parameters?.[key];
    if (!['number', 'string'].includes(typeof raw) || typeof raw === 'string' && !/^\d+(?:\.\d+)?$/.test(raw.trim())) continue;
    const capacity = Number(raw) * factor;
    if (Number.isFinite(capacity) && capacity > 0) return capacity;
  }
  return '';
};
const suppliedSchedule = (ctx, route) => {
  if (route === 'charger_schedule') return suppliedChargerSchedule(ctx);
  if (ctx.schedule && typeof ctx.schedule === 'object' && !Array.isArray(ctx.schedule)) return ctx.schedule;
  const collection = ctx.config?.[route === 'strategy' ? 'strategies' : 'charger_schedules'];
  if (Array.isArray(collection)) return object(collection.find(item => item && String(item.id) === String(ctx.id)));
  return ctx.id ? object(own(object(collection), ctx.id)) : {};
};
const chargerModes = dc => [['fast', 'Fast Charging'], ['pv_surplus', 'PV Surplus Charging'], ...(dc ? [['v2x', 'Bi-directional V2X']] : []), ['sigen_ai', 'Sigen AI Mode']];
const hasDeviceId = ctx => ctx.id !== undefined && ctx.id !== null && String(ctx.id) !== '';
const cloudState = ctx => ctx.config?.cloud_paused === true ? 'Paused' : current(ctx, 'cloud_status');
const inventory = ctx => Array.isArray(ctx.inventory) ? ctx.inventory.filter(item => item && typeof item === 'object') : [];
const deviceKind = item => {
  const kind = String(item?.type ?? '').toLowerCase().replace(/[ _-]/g, '');
  return own({ accharger: 'ac', evac: 'ac', dccharger: 'dc', evdc: 'dc', energycontroller: 'inverter', aio: 'inverter', energygateway: 'gateway' }, kind) ?? kind;
};
const deviceId = item => item?.id ?? item?.serial ?? item?.serial_number ?? item?.serialNumber;
const selectedDevice = ctx => {
  if (!hasDeviceId(ctx)) return undefined;
  const matches = inventory(ctx).filter(item => [item.id, item.serial, item.serial_number, item.serialNumber].some(id => id !== undefined && id !== null && String(id) === String(ctx.id)));
  return matches.length === 1 ? matches[0] : undefined;
};
const chargerKind = ctx => {
  if (hasDeviceId(ctx)) { const kind = deviceKind(selectedDevice(ctx)); return ['ac', 'dc'].includes(kind) ? kind : ''; }
  const chargers = inventory(ctx).filter(item => ['ac', 'dc'].includes(deviceKind(item)));
  return chargers.some(item => deviceKind(item) === 'ac') ? 'ac' : chargers.length === 1 ? deviceKind(chargers[0]) : 'ac';
};
const isDC = ctx => chargerKind(ctx) === 'dc';
const chargerId = ctx => hasDeviceId(ctx) ? String(ctx.id) : deviceId(inventory(ctx).find(item => deviceKind(item) === chargerKind(ctx))) ?? chargerKind(ctx);
const requireCharger = ctx => { const kind = chargerKind(ctx); if (!kind) throw new Error('Selected charger is unavailable'); return kind; };
const safeSchedulePart = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
/** Canonical IDs keep an opaque charger identity separate from each local schedule. */
export function encodeChargerScheduleId(charger, schedule = 'new') {
  if (!safeSchedulePart(charger, 150) || !safeSchedulePart(schedule, 80)) throw new Error('Charging schedule ID is invalid');
  return `charger:${encodeURIComponent(charger)}:${encodeURIComponent(schedule)}`;
}
export function decodeChargerScheduleId(id) {
  if (typeof id !== 'string') return null;
  const match = /^charger:([^:]+):([^:]+)$/.exec(id); if (!match) return null;
  try {
    const chargerId = decodeURIComponent(match[1]), scheduleId = decodeURIComponent(match[2]);
    return encodeChargerScheduleId(chargerId, scheduleId) === id ? { chargerId, scheduleId } : null;
  } catch { return null; }
}
function chargerScheduleIdentity(ctx) {
  const actual = ['ac', 'dc'].includes(deviceKind(selectedDevice(ctx))), decoded = actual ? null : decodeChargerScheduleId(ctx.id);
  if (typeof ctx.id === 'string' && ctx.id.startsWith('charger:') && !decoded && !actual) return null;
  const context = decoded ? { ...ctx, id: decoded.chargerId } : ctx, kind = chargerKind(context);
  if (!kind || !moreCharger(context, kind)) return null;
  const charger = String(chargerId(context));
  return { context, chargerId: charger, scheduleId: decoded?.scheduleId ?? 'legacy', id: decoded ? ctx.id : charger, composite: Boolean(decoded) };
}
function suppliedChargerSchedules(ctx, item) {
  const id = String(deviceId(item)), configured = ctx.config?.charger_schedules;
  let source = item.charger_schedules ?? (Array.isArray(configured) ? undefined : own(object(configured), id));
  if (Array.isArray(source)) return { available: true, records: source };
  source = object(source);
  if (source.available === false) return { available: false, records: [] };
  if (Array.isArray(source.schedules)) return { available: true, records: source.schedules };
  if (Array.isArray(source.records)) return { available: true, records: source.records };
  if (typeof source.start === 'string' || typeof source.end === 'string') return { available: true, records: [{ ...source, _legacy: true }] };
  // Preserve the original array shape where a single schedule used the charger ID.
  if (Array.isArray(configured)) {
    const scoped = configured.filter(record => record?.charger_id !== undefined && String(record.charger_id) === id);
    if (scoped.length) return { available: true, records: scoped };
    const legacy = configured.find(record => record && record.charger_id === undefined && String(record.id) === id);
    if (legacy) return { available: true, records: [{ ...legacy, _legacy: true }] };
  }
  return { available: false, records: [] };
}
function chargerScheduleItems(ctx, item) {
  const id = String(deviceId(item)), source = suppliedChargerSchedules(ctx, item), entries = new Map();
  for (const item of source.records) {
    if (!item || typeof item !== 'object' || item.charger_id !== undefined && String(item.charger_id) !== id) continue;
    let key; try { key = item._legacy ? id : encodeChargerScheduleId(id, String(item.id ?? item.schedule_id ?? '')); } catch { continue; }
    if (decodeChargerScheduleId(key)?.scheduleId === 'new') continue;
    entries.set(key, { key, data: item, draft: false });
  }
  for (const [key, data] of Object.entries(object(own(object(ctx.interfaceOptions), 'charger_schedule')))) {
    const decoded = decodeChargerScheduleId(key);
    if (key !== id && (!decoded || decoded.chargerId !== id || decoded.scheduleId === 'new')) continue;
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.charger_id !== undefined && String(data.charger_id) !== id || !['start', 'end', 'mode', 'name'].some(field => own(data, field) !== undefined)) continue;
    entries.set(key, { key, data: { ...object(entries.get(key)?.data), ...data }, draft: true });
  }
  return { available: source.available, entries: [...entries.values()] };
}
function suppliedChargerSchedule(ctx) {
  const identity = chargerScheduleIdentity(ctx); if (!identity) return {};
  if (ctx.schedule && typeof ctx.schedule === 'object' && !Array.isArray(ctx.schedule) && (ctx.schedule.charger_id === undefined || String(ctx.schedule.charger_id) === identity.chargerId)) return ctx.schedule;
  const item = selectedDevice({ ...identity.context, id: identity.chargerId }); if (!item) return {};
  return chargerScheduleItems(ctx, item).entries.find(entry => entry.key === identity.id)?.data ?? {};
}
function chargerSchedulesPage(ctx) {
  const item = moreCharger(ctx), title = 'Charging schedules';
  if (!item) {
    const choices = inventory(ctx).filter(device => ['ac', 'dc'].includes(deviceKind(device)));
    return { title, body: note('Choose a charger to view its schedules.') + group(choices.length ? choices.map(device => row(device.name || `${deviceKind(device).toUpperCase()} charger`, 'charger_schedules', '', String(deviceId(device)))).join('') : row('Devices', 'devices')) };
  }
  const id = String(deviceId(item)), { available, entries } = chargerScheduleItems(ctx, item);
  const rows = entries.map(entry => {
    const data = entry.data, time = typeof data.start === 'string' && typeof data.end === 'string' ? `${data.start}–${data.end}` : 'Time unavailable';
    return row(data.name || 'Charging schedule', 'charger_schedule', `${time} · ${entry.draft ? 'Draft' : 'Plant schedule'}`, entry.key);
  }).join('');
  return { title, body: (rows ? group(rows) : note(available ? 'No Schedule' : 'Plant schedules are unavailable.')) + button('Add schedule', 'charger_schedule', encodeChargerScheduleId(id, 'new')) + group(row('Charging mode', 'charging_mode', '', id) + row('Charging records', 'charger_records', '', id)) };
}
const calendarDate = input => {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const stamp = Date.parse(`${input}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === input ? input : null;
};
const awareTimestamp = input => typeof input === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(input) && calendarDate(input.slice(0, 10)) && Number.isFinite(Date.parse(input)) ? input : null;
function localRecordDate(stamp, ctx) {
  let timezone = ctx.timezone || 'UTC'; try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { timezone = 'UTC'; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(Date.parse(stamp)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function chargerRecordsPage(ctx) {
  const item = moreCharger(ctx), title = 'Charging records', unknownTotals = `<div class="settings-metrics">${metric('Total charge', '—')}${metric('Total discharge', '—')}</div>`;
  if (!item) return { title, body: unknownTotals + note('Charger information is unavailable.') + group(row('Devices', 'devices')) };
  const id = String(deviceId(item)), configured = item.charging_records ?? own(object(ctx.config?.charging_records), id);
  const source = Array.isArray(configured) ? { available: true, records: configured } : object(configured), available = source.available !== false && Array.isArray(source.records);
  const raw = available ? source.records : [], records = raw.filter(record => record && awareTimestamp(record.started_at) && (record.charger_id === undefined || String(record.charger_id) === id)).map(record => ({ ...record, date: localRecordDate(record.started_at, ctx) }));
  const dates = records.map(record => record.date).sort(), fromDefault = calendarDate(source.from) ?? dates[0] ?? '', toDefault = calendarDate(source.to) ?? dates.at(-1) ?? '';
  const selected = object(own(object(ctx.chargerRecordFilters), id)), from = own(selected, 'from') === undefined ? fromDefault : selected.from, to = own(selected, 'to') === undefined ? toDefault : selected.to;
  const rangeValid = (!from || calendarDate(from)) && (!to || calendarDate(to)) && (!from || !to || from <= to), filtered = from !== fromDefault || to !== toDefault;
  const shown = rangeValid ? records.filter(record => (!from || record.date >= from) && (!to || record.date <= to)) : [];
  const energy = input => { const result = finiteSetting(input); return result !== null && result >= 0 ? result : null; };
  const total = (field, explicit) => {
    if (!available || !rangeValid) return null;
    if (!filtered && energy(explicit) !== null) return energy(explicit);
    if (raw.length === 0) return 0;
    if (source.complete !== true || records.length !== raw.length || shown.some(record => energy(record[field]) === null)) return null;
    const sum = shown.reduce((value, record) => value + energy(record[field]), 0); return Number.isFinite(sum) ? sum : null;
  };
  const filters = `<div class="settings-columns settings-record-filters">${[['from', 'From', from], ['to', 'To', to]].map(([key, label, selected]) => `<label class="settings-field"><span>${label}</span><input type="date" value="${esc(calendarDate(selected) ?? '')}" data-charger-record-filter="${key}" data-charger-record-device="${esc(id)}"${available ? '' : ' disabled'}></label>`).join('')}</div>`;
  const totals = `<div class="settings-metrics">${metric('Total charge', numberText(total('charged_kwh', source.total_charged_kwh), ' kWh'))}${metric('Total discharge', numberText(total('discharged_kwh', source.total_discharged_kwh), ' kWh'))}</div>`;
  const entries = shown.map(record => `<article class="settings-charging-record"><time datetime="${esc(record.started_at)}">${esc(record.date)} · ${esc(record.started_at)}</time>${typeof record.vehicle === 'string' ? `<strong>${esc(record.vehicle)}</strong>` : ''}<div class="settings-metrics">${metric('Charged', numberText(energy(record.charged_kwh), ' kWh'))}${metric('Discharged', numberText(energy(record.discharged_kwh), ' kWh'))}</div>${awareTimestamp(record.ended_at) && Date.parse(record.ended_at) >= Date.parse(record.started_at) ? `<small>Until ${esc(record.ended_at)}</small>` : ''}</article>`).join('');
  const status = !rangeValid ? note('Choose a valid date range.') : !available ? note('Charging history is unavailable.') : !shown.length ? note(records.length === raw.length ? 'No charging record found.' : 'Charging history contains unavailable records.') : entries;
  return { title, body: totals + filters + status + group(row('Schedule', 'charger_schedules', '', id) + row('Charging mode', 'charging_mode', '', id) + row('My car', 'vehicles')) };
}
const SYSTEM_TYPES = [['residential_classic_home', 'Residential Classic Home'], ['residential_modern_loft', 'Residential Modern Loft'], ['factory', 'Factory'], ['office', 'Office'], ['supermarket', 'Supermarket'], ['school', 'School'], ['hospital', 'Hospital'], ['ship', 'Ship'], ['gas_station', 'Gas Station'], ['farm', 'Farm']];
const INDICATOR_MODES = {
  led_strips: [['christmas_light', 'Christmas Light'], ['battery_soc', 'Battery SOC'], ['breathing', 'Breathing'], ['power_flow', 'Power Flow'], ['constant', 'Constant'], ['personalized', 'Personalized'], ['football_vibe', 'Football Vibe']],
  front: [['christmas_light', 'Christmas Light'], ['charging_discharging', 'Charging/Discharging'], ['breathing', 'Breathing'], ['constant', 'Constant'], ['ambient', 'Ambient'], ['football_vibe', 'Football Vibe']],
};
const indicatorChannel = ctx => ctx.id === 'front' ? 'front' : 'led_strips';
const indicatorSource = ctx => object(ctx.config?.indicator_settings?.[indicatorChannel(ctx)] ?? ctx.config?.indicators?.[indicatorChannel(ctx)]);
const normalizedChoice = (raw, choices) => typeof raw === 'string' ? choices.find(([key, label]) => [key, label].some(value => value.toLowerCase().replace(/[^a-z0-9]/g, '') === raw.toLowerCase().replace(/[^a-z0-9]/g, '')))?.[0] ?? '' : '';
const finiteSetting = raw => ['number', 'string'].includes(typeof raw) && !(typeof raw === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim())) && Number.isFinite(Number(raw)) ? Number(raw) : null;
const nativeProfileLink = label => `<a class="settings-row" href="/profile"><span>${esc(label)}</span><span class="settings-row-value" aria-hidden="true">›</span></a>`;
const chargerMode = (ctx, draft, useObserved = true) => {
  const kind = chargerKind(ctx); if (!kind) return '';
  const normalize = label => {
    if (typeof label !== 'string') return '';
    const recognized = { fast: 'fast', 'fast charging': 'fast', 'pv surplus': 'pv_surplus', 'pv surplus charging': 'pv_surplus', v2x: 'v2x', 'bi directional v2x': 'v2x', 'sigen ai': 'sigen_ai', 'sigen ai mode': 'sigen_ai', 'ai mode': 'sigen_ai' };
    const selected = own(recognized, label.toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' '));
    return chargerModes(isDC(ctx)).some(([key]) => key === selected) ? selected : '';
  };
  if (own(draft, 'mode') !== undefined) return normalize(draft.mode);
  if (!useObserved) return '';
  const device = hasDeviceId(ctx) ? selectedDevice(ctx) : inventory(ctx).find(item => deviceKind(item) === kind);
  const mapped = [device?.entities?.charging_mode, device?.entities?.[`${kind}_charging_mode`], device?.entities?.[`${kind}_mode`]].filter(Boolean);
  const aggregate = !hasDeviceId(ctx) || inventory(ctx).filter(item => deviceKind(item) === kind).length === 1 ? [`${kind}_charging_mode`, `${kind}_mode`] : [];
  for (const key of [...mapped, ...aggregate]) {
    const reading = read(ctx, key), selected = normalize(reading?.state ?? reading);
    if (selected) return selected;
  }
  return normalize(device?.charging_mode);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const seasonDirection = ctx => String(ctx.id ?? '').split(':')[0] === 'export' ? 'export' : 'import';
const seasonItems = (ctx, direction) => Object.entries(object(own(object(ctx.interfaceOptions), 'tariff_season'))).filter(([, item]) => item && typeof item === 'object' && item.direction === direction);
const monthsInSeason = (start, end) => {
  if (![start, end].every(month => Number.isInteger(month) && month >= 1 && month <= 12)) return [];
  const months = []; for (let month = start; months.length < 12; month = month % 12 + 1) { months.push(month); if (month === end) break; } return months;
};
const surplusChoices = ctx => {
  const charger = chargerKind(ctx); if (!charger) return [];
  const kinds = inventory(ctx).map(deviceKind), entities = object(ctx.entities);
  return [
    ...(entities.battery_power || entities.battery_soc || kinds.some(kind => ['battery', 'batterymodule', 'batterysystem'].includes(kind)) ? [['battery', 'Battery']] : []),
    ...(entities[`${charger}_power`] || kinds.includes(charger) ? [['ev', `${charger.toUpperCase()} charger`]] : []),
    ...(entities.grid_power || kinds.some(kind => ['gateway', 'energygateway', 'grid'].includes(kind)) ? [['grid', 'Grid']] : []),
  ];
};
const mappedFact = (ctx, key) => {
  const selected = hasDeviceId(ctx) ? selectedDevice(ctx) : inventory(ctx).find(item => deviceKind(item) === 'inverter');
  if (hasDeviceId(ctx) && !selected) return '—';
  const mapped = selected?.entities?.[key];
  const reading = mapped ? stateText(read(ctx, mapped)) : !hasDeviceId(ctx) ? current(ctx, key) : '—';
  if (reading !== '—') return reading;
  const found = selected?.[key] ?? selected?.parameters?.[key];
  return ['string', 'number'].includes(typeof found) && String(found).trim() ? String(found) : '—';
};
const deviceStatus = ctx => hasDeviceId(ctx) ? mappedFact(ctx, own({ ac: 'ac_state', dc: 'dc_state', gateway: 'grid_status', inverter: 'inverter_status', battery: 'battery_status', batterymodule: 'battery_status', batterysystem: 'battery_status' }, deviceKind(selectedDevice(ctx))) ?? 'status') : current(ctx, 'grid_status');
function moreCharger(ctx, expected) {
  const rows = inventory(ctx).filter(item => ['ac','dc'].includes(deviceKind(item)) && (!expected || deviceKind(item) === expected));
  const item = hasDeviceId(ctx) ? selectedDevice(ctx) : rows.length === 1 ? rows[0] : null;
  return item && ['ac','dc'].includes(deviceKind(item)) && (!expected || deviceKind(item) === expected) ? item : null;
}
function chargerSettingsSource(ctx, item) {
  const kind = deviceKind(item), id = String(deviceId(item));
  return object(item.charger_settings ?? item[`${kind}_settings`] ?? ctx.config?.charger_settings?.[id] ?? ctx.config?.[`${kind}_settings`]?.[id]);
}
function chargerReading(ctx, item, keys) {
  for (const key of keys) {
    const id = item.entities?.[key];
    if (typeof id !== 'string' || !/^sensor\.[a-z0-9_]+$/.test(id) && !/^binary_sensor\.[a-z0-9_]+$/.test(id)) continue;
    return read(ctx, id) ?? {state:'unavailable',attributes:{}};
  }
  return null;
}
function chargerFact(ctx, item, keys, fallback) {
  const reading = chargerReading(ctx, item, keys);
  const value = reading?.state ?? fallback;
  return ['string','number'].includes(typeof value) && String(value).trim() && !['unknown','unavailable','none'].includes(String(value).toLowerCase()) ? String(value) : '—';
}
function chargerBoolean(ctx, item, keys, fallback) {
  const raw = chargerReading(ctx, item, keys)?.state ?? fallback;
  return [true,1,'1','on','enabled','true'].includes(raw) ? true : [false,0,'0','off','disabled','false'].includes(raw) ? false : null;
}
function readonlySwitch(label, value) {
  return `<div class="settings-readonly-row"><span>${esc(label)}</span>${value === null ? '<strong>—</strong>' : `<input type="checkbox" role="switch" aria-label="${esc(label)}"${value ? ' checked' : ''} disabled aria-disabled="true">`}</div>`;
}
function chargerQuantity(ctx, item, keys, quantity, fallback) {
  const reading = chargerReading(ctx, item, keys);
  const units = quantity === 'power' ? { W:.001,kW:1,MW:1000 } : { '%':1 };
  if (reading) {
    const n = finiteSetting(reading.state), factor = units[reading.attributes?.unit_of_measurement];
    if (n !== null && factor !== undefined && n >= 0 && (quantity !== 'soc' || n <= 100)) return numberText(n * factor, quantity === 'power' ? ' kW' : '%');
    return '—';
  }
  const value = finiteSetting(fallback);
  return value !== null && value >= 0 && (quantity !== 'soc' || value <= 100) ? numberText(value, quantity === 'power' ? ' kW' : '%') : '—';
}
function moreChargerPage(route, ctx) {
  const expected = route.startsWith('ac_') ? 'ac' : route.startsWith('dc_') ? 'dc' : null;
  const item = moreCharger(ctx, expected);
  if (!item) return {title:'Charger settings',body:note('Selected charger information is unavailable.') + group(row('Devices','devices'))};
  const kind = deviceKind(item), id = String(deviceId(item)), source = chargerSettingsSource(ctx,item);
  const back = () => group(row('Charger settings',`${kind}_more`,'',id));
  const fact = (keys, fallback) => chargerFact(ctx,item,keys,fallback);
  const onOff = (keys, fallback) => chargerBoolean(ctx,item,keys,fallback);
  const name = own(prefs(ctx,'device_settings'),'name') ?? item.name ?? `${kind.toUpperCase()} Charger`;
  const serial = item.serial ?? item.serial_number ?? item.serialNumber;
  const cardData = source.cards, cardRecords = Array.isArray(cardData) ? cardData : Array.isArray(cardData?.records) && cardData.available !== false ? cardData.records : null;
  let title = '', body = '';
  switch (route) {
    case 'ac_more': {
      title = 'More';
      const rated = chargerQuantity(ctx,item,['rated_power','ac_rated_power'], 'power', source.rated_power_kw ?? item.rated_power_kw ?? item.parameters?.rated_power_kw);
      body = group(row('Charging Record','charger_records','',id) + row('Charging Mode','charging_mode','',id) + row('OCPP Management','charger_ocpp','',id))
        + '<h3>Authorisation</h3>' + group(row('Card Management','charger_cards','',id) + row('Dynamic load management','ac_load_management','',id) + row('Output Mode','ac_output_mode','',id) + row('Off-grid Charging','ac_offgrid_charging','',id) + row('Indicator Lighting Settings','ac_indicator_lighting','',id) + row('Connectivity','ac_connectivity','',id))
        + `<div class="settings-metrics">${metric('Device Model',fact(['model'],item.model))}${metric('Device SN',serial ?? '—')}${metric('Software Version',fact(['software_version'],source.software_version ?? item.software_version ?? item.parameters?.software_version))}${metric('Rated Power',rated)}${metric('Communication Status',fact(['communication_status','ac_communication_status'],source.communication_status ?? item.parameters?.communication_status))}</div>`;
      break;
    }
    case 'dc_more':
      title = 'EVDC Charger Settings';
      body = `<div class="settings-metrics">${metric('Device Name',name)}${metric('Device SN',serial ?? '—')}${metric('Device Status',fact(['device_status','dc_device_status'],source.status ?? source.device_status ?? item.status))}</div><h3>Charging Preference</h3>`
        + group(row('Charging Mode','charging_mode','',id) + row('Charging Setting','dc_charging_settings','',id) + row('OCPP Management','charger_ocpp','',id))
        + '<h3>Authorisation</h3>' + group(row('Card Management','charger_cards','',id) + row('Bi-directional V2X operation','dc_v2x_operation','',id) + row('My Vehicle','vehicles','',id));
      break;
    case 'charger_ocpp':
      title = 'OCPP Settings';
      body = `<div class="settings-metrics">${metric('OCPP Status',fact(['ocpp_status',`${kind}_ocpp_status`],source.ocpp?.status))}</div>` + group(readonlySwitch('OCPP Settings',onOff(['ocpp_enabled',`${kind}_ocpp_enabled`],source.ocpp?.enabled))) + disabled('Save') + back();
      break;
    case 'charger_cards': {
      title = 'Card Management';
      const cards = cardRecords?.filter(card=>card&&typeof card==='object'&&!Array.isArray(card));
      body = cards === null || cards === undefined ? note('Card information is unavailable.') : cards.length ? group(cards.map(card=>`<div class="settings-readonly-row"><span>${esc(typeof card.name==='string'&&card.name.trim()?card.name:'Card')}</span><strong>${esc(typeof card.masked_number==='string'?card.masked_number:'—')}</strong></div>`).join('')) : note('No cards');
      const authorisation = fact(['card_authorisation_status','card_authorization_status'],object(cardData).authorisation_status ?? object(cardData).authorization_status);
      if (authorisation !== '—') body += `<div class="settings-metrics">${metric('Authorisation',authorisation)}</div>`;
      body += note('Up to 5 cards can be added.') + disabled('Add New Card') + back();
      break;
    }
    case 'ac_load_management':
      title = 'Dynamic load management';
      body = group(readonlySwitch(title,onOff(['dynamic_load_management_enabled','ac_dynamic_load_management_enabled'],source.dynamic_load_management?.enabled))) + note('Adjusts charging current to the system load to help avoid overload.') + disabled('Save') + back();
      break;
    case 'ac_output_mode': {
      title = 'Output Mode';
      const mode = normalizedChoice(fact(['output_mode','ac_output_mode'],source.output_mode?.mode),[['single_phase','Single Phase'],['three_phase','Three Phase']]);
      const phase = fact(['p1_connected_to','ac_p1_connected_to'],source.output_mode?.p1_connected_to).toUpperCase();
      body = `<div class="settings-metrics">${metric('Output Mode',mode==='single_phase'?'Single Phase':mode==='three_phase'?'Three Phase':'—')}${metric('P1 Connected to',['L1','L2','L3'].includes(phase)?phase:'—')}</div>` + note('P1 identifies the charger phase; L1, L2 and L3 identify the meter phases.') + disabled('Save') + back();
      break;
    }
    case 'ac_offgrid_charging':
      title = 'Off-grid Charging';
      body = group(readonlySwitch('Allow charging when off-grid',onOff(['offgrid_charging_enabled','ac_offgrid_charging_enabled'],source.off_grid_charging?.enabled))) + disabled('Save') + back();
      break;
    case 'ac_indicator_lighting':
      title = 'Indicator Lighting Settings';
      body = group(readonlySwitch('LED ON/OFF',onOff(['indicator_lighting_enabled','ac_indicator_lighting_enabled'],source.indicator_lighting?.enabled))) + back();
      break;
    case 'ac_connectivity': {
      title = 'Connectivity';
      const connected = onOff(['network_connected','ac_network_connected'],source.connectivity?.connected);
      body = `<div class="settings-metrics">${metric('Network status',connected===true?'Connected':connected===false?'Not connected':'—')}</div>` + group(row('Ethernet','ac_ethernet','',id) + row('WLAN','ac_wlan','',id) + row('Cellular','ac_cellular','',id)) + back();
      break;
    }
    case 'ac_ethernet':
      title = 'Ethernet';
      body = `<div class="settings-metrics">${metric('MAC Address',fact(['ethernet_mac','ac_ethernet_mac'],source.connectivity?.ethernet?.mac_address))}${metric('Ethernet',fact(['ethernet_status','ac_ethernet_status'],source.connectivity?.ethernet?.status))}</div>` + group(row('Connectivity','ac_connectivity','',id));
      break;
    case 'ac_wlan':
      title = 'WLAN';
      body = `<div class="settings-metrics">${metric('WLAN',fact(['wlan_status','ac_wlan_status'],source.connectivity?.wlan?.status))}${metric('Network name',fact(['wlan_network_name','ac_wlan_network_name'],source.connectivity?.wlan?.network_name))}</div>` + group(row('Connectivity','ac_connectivity','',id));
      break;
    case 'ac_cellular': {
      title = 'Cellular';
      const signalReading = chargerReading(ctx,item,['cellular_signal','ac_cellular_signal']), signal = signalReading?.state ?? source.connectivity?.cellular?.signal?.value, unit = signalReading?.attributes?.unit_of_measurement ?? source.connectivity?.cellular?.signal?.unit;
      const number = finiteSetting(signal), label = number !== null && (unit==='dBm'||unit==='%'&&number>=0&&number<=100) ? numberText(number,` ${unit}`) : typeof signal === 'string' && finiteSetting(signal) === null && !['unknown','unavailable','none',''].includes(signal.toLowerCase()) ? signal : '—';
      body = `<div class="settings-metrics">${metric('Cellular',fact(['cellular_status','ac_cellular_status'],source.connectivity?.cellular?.status))}${metric('Signal',label)}</div>` + group(row('Connectivity','ac_connectivity','',id));
      break;
    }
    case 'dc_charging_settings':
      title = 'Charging Setting';
      body = `<div class="settings-metrics">${metric('Charging power allowed for EVDC',chargerQuantity(ctx,item,['dc_allowed_charge_power','allowed_charge_power'],'power',source.charging_setting?.allowed_power_kw))}${metric('Vehicle Charging Cut-off SOC',chargerQuantity(ctx,item,['dc_vehicle_cutoff_soc','vehicle_cutoff_soc'],'soc',source.charging_setting?.vehicle_cutoff_soc))}</div>` + disabled('Save') + back();
      break;
    case 'dc_v2x_operation':
      title = 'Guide';
      body = '<h3>V2H (Vehicle-to-Home)</h3>' + note('A compatible vehicle can contribute stored energy to the home energy plan. The vendor guide covers solar charging and supplying the home; outage backup requires a Sigen Gateway.') + note('Vehicle support and operating setup remain part of the vendor workflow.') + group(row('Charging Mode','charging_mode','',id)) + back();
      break;
  }
  return {title,subtitle:String(item.name??`${kind.toUpperCase()} Charger`),body};
}
function tariffCurrency(p, ctx) { return p.currency || ctx.currency || ctx.config?.currency || 'EUR'; }
function tariffUnit(p) { return ['major','cent'].includes(p.unit) ? p.unit : own(p,'base_price') !== undefined || Array.isArray(p.windows) && p.windows.length ? 'major' : 'cent'; }
function tariffSuffix(unit, currency) { return unit === 'cent' ? currency === 'GBP' ? 'p/kWh' : 'cent/kWh' : `${currency}/kWh`; }
export function convertTariffPrice(amount, from, to) {
  option(from,'Price unit',['major','cent']);option(to,'Price unit',['major','cent']);
  const price=finiteSetting(amount);if(price===null)return null;
  const ratio = from === to ? 1 : from === 'cent' ? .01 : 100;
  return Number((price*ratio).toPrecision(12));
}
function periodDays(period) { return period.weekdays === undefined ? [...DAYS] : Array.isArray(period.weekdays) ? period.weekdays : typeof period.weekdays === 'string' ? period.weekdays.toLowerCase().split(',').map(day=>day.trim()) : []; }
function periodDayLabel(days) {
  if (days.length === 7 && DAYS.every(day=>days.includes(day))) return 'Every day';
  if (days.length === 5 && DAYS.slice(0,5).every(day=>days.includes(day))) return 'Weekdays';
  if (days.length === 2 && ['sat','sun'].every(day=>days.includes(day))) return 'Weekends';
  return DAYS.filter(day=>days.includes(day)).map(day=>day.slice(0,1).toUpperCase()+day.slice(1)).join(', ') || 'Choose days';
}
function periodClock(value) { if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null; return Number(value.slice(0,2))*60+Number(value.slice(3)); }

/** Weekly wall-clock segments retain start-day semantics across midnight and
 * Sunday/Monday. The calendar engine still owns actual dates and DST. */
export function tariffTimetableModel(periods = [], indices) {
  if (!Array.isArray(periods)) return [];
  const segments=[];
  periods.slice(0,TARIFF_MAX_PERIODS).forEach((period,index)=>{
    period=object(period);const start=periodClock(period.start),end=periodClock(period.end),price=finiteSetting(period.price);
    if(start===null||end===null||start===end||price===null)return;
    const supplied=indices?.[index],id=Number.isInteger(supplied)&&supplied>=0&&supplied<TARIFF_MAX_PERIODS?supplied:index;
    for(const day of DAYS.filter(day=>periodDays(period).includes(day))){const column=DAYS.indexOf(day);if(end>start)segments.push({index:id,day:column,start,end,price});else{segments.push({index:id,day:column,start,end:1440,price});if(end>0)segments.push({index:id,day:(column+1)%7,start:0,end,price});}}
  });
  return segments;
}
export function renderTariffTimetable(periods = [], options = {}) {
  const unit=options.unit==='major'?'major':'cent',currency=options.currency||'EUR',suffix=tariffSuffix(unit,currency),segments=tariffTimetableModel(periods,options.indices);
  const colors=['#79d7d0','#89b9ec','#edcc76','#bba1e6','#eea5b5','#a2cc86'];
  return `<div class="tariff-timetable" aria-label="Weekly tariff timetable"><div class="tariff-week-head"><span></span>${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=>`<strong>${day}</strong>`).join('')}</div><div class="tariff-week-grid"><div class="tariff-hours">${[0,6,12,18,24].map(hour=>`<span style="top:${hour/24*100}%">${String(hour).padStart(2,'0')}:00</span>`).join('')}</div>${DAYS.map((day,column)=>`<div class="tariff-day-track" aria-label="${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][column]}">${segments.filter(segment=>segment.day===column).map(segment=>{const period=periods[options.indices?options.indices.indexOf(segment.index):segment.index]||{},price=numberText(segment.price),label=`${periodDayLabel(periodDays(period))} ${period.start}–${period.end}, ${price} ${suffix}`;return `<button type="button" class="tariff-time-block" data-tariff-edit="${segment.index}" style="top:${segment.start/1440*100}%;height:${(segment.end-segment.start)/1440*100}%;--tariff-period-color:${colors[segment.index%colors.length]}" aria-label="${esc(`${label}. Edit time period`)}" title="${esc(label)}"><strong>${esc(price)}</strong><small>${esc(suffix)}</small></button>`;}).join('')}</div>`).join('')}</div></div>`;
}
export function renderTariffPeriod(index, period = {}, ctx = {}) {
  if(!Number.isInteger(index)||index<0||index>=TARIFF_MAX_PERIODS)throw new Error('Time period index is invalid');
  period=object(period);const days=periodDays(period),unit=ctx.unit==='major'?'major':'cent',currency=ctx.currency||'EUR';
  const time=periodClock(period.start)!==null&&periodClock(period.end)!==null?`${period.start} → ${period.end}`:'Set time and price',price=finiteSetting(period.price);
  return `<div class="tariff-period-row" data-tariff-period="${index}"><button type="button" class="tariff-period-summary" data-tariff-edit="${index}"><span><strong>${esc(time)}</strong><small>${esc(periodDayLabel(days))}</small></span><strong>${price===null?'—':esc(numberText(price)+' '+tariffSuffix(unit,currency))}</strong><span class="tariff-edit-label">Edit</span></button><button type="button" class="tariff-period-remove" data-tariff-remove="${index}" aria-label="Remove time period ${index+1}">×</button>${['start','end','price'].map(key=>`<input type="hidden" name="window_${index}_${key}" value="${esc(period[key]??'')}" data-tariff-field="${key}">`).join('')}${days.map(day=>`<input type="hidden" name="window_${index}_weekdays" value="${esc(day)}" data-tariff-day>`).join('')}</div>`;
}
function tariffPeriodEditor() {
  return `<dialog class="tariff-period-dialog" data-tariff-editor aria-label="Time period"><div class="tariff-period-heading"><h3>Time period</h3><button type="button" class="tariff-editor-close" data-tariff-editor-cancel aria-label="Cancel time period">×</button></div><div class="tariff-period-time">${field('tariff_editor_start','Start','','type="time" required data-tariff-input="start"')}<span aria-hidden="true">→</span>${field('tariff_editor_end','End','','type="time" required data-tariff-input="end"')}</div><div class="tariff-select-all"><strong>Repeat on</strong><label><input type="checkbox" data-tariff-select-all checked> Select all</label></div><div class="tariff-editor-days">${dayPicker('tariff_editor_weekdays','Days',DAYS)}</div>${field('tariff_editor_price','Price','','type="number" step="any" required data-tariff-input="price"')}<small class="tariff-editor-unit" data-tariff-editor-unit></small><output data-tariff-editor-error role="alert"></output><div class="tariff-editor-actions"><button type="button" class="settings-secondary" data-tariff-editor-delete>Delete</button><button type="button" class="settings-secondary" data-tariff-editor-cancel>Cancel</button><button type="button" class="settings-save" data-tariff-editor-submit>Submit</button></div></dialog>`;
}
function tariffFields(p, ctx, nameLabel = 'Rate plan name') {
  const windows=Array.isArray(p.windows)?p.windows.slice(0,TARIFF_MAX_PERIODS):[],currency=tariffCurrency(p,ctx),unit=tariffUnit(p),mode=windows.length?'tou':'flat';
  return `${nameLabel==='Season name'?field('name',nameLabel,p.name||'','required maxlength="80"'):''}<div class="tariff-basic-controls">${select('tariff_type','Rate type',mode,[['flat','Flat rate'],['tou','Time of use']],'data-tariff-type')}${field('base_price',mode==='flat'?'Price':'Standard rate',p.base_price??'','type="number" step="any" required data-tariff-base-price')}</div><div class="tariff-currency-controls">${currencyPicker(currency)}${select('unit','Price unit',unit,[['cent',currency==='GBP'?'Pence / kWh':'Cent / kWh'],['major',`${currency} / kWh`]],'data-tariff-unit')}</div><fieldset class="tariff-periods" data-tariff-periods${mode==='flat'?' hidden disabled':''}><legend>Time-of-use prices</legend><div data-tariff-timetable>${renderTariffTimetable(windows,{unit,currency})}</div><div class="tariff-period-toolbar"><h3>Time periods</h3><button type="button" class="settings-secondary" data-tariff-add${windows.length>=TARIFF_MAX_PERIODS?' disabled':''}>+ Add time period</button></div><div class="tariff-period-list" data-tariff-period-list>${windows.map((period,index)=>renderTariffPeriod(index,period,{unit,currency})).join('')}</div><p class="settings-note" data-tariff-empty${windows.length?' hidden':''}>Add a time period to set a different price.</p>${note('The standard rate covers other times. An end before the start continues next morning, using the selected start day.')}</fieldset><details class="tariff-advanced"><summary>Advanced</summary><div class="settings-columns">${nameLabel==='Season name'?'':field('name',nameLabel,p.name||'','maxlength="80"')}${field('timezone','Time zone',p.timezone||timeZone(ctx),'required maxlength="80"')}</div></details>`;
}

/** Local editor binding only. Opening/cancelling a time period does not change
 * the draft; the host is notified only when a period is submitted or deleted. */
export function bindTariffEditor(formElement, ctx = {}, changed = () => {}) {
  if(!formElement||formElement._tariffBound)return;
  const editor=formElement.closest?.('.settings-page')?.querySelector('[data-tariff-editor]'),list=formElement.querySelector('[data-tariff-period-list]'),periods=formElement.querySelector('[data-tariff-periods]');
  if(!editor||!list||!periods)return;formElement._tariffBound=true;
  const mode=formElement.querySelector('[data-tariff-type]'),unit=formElement.querySelector('[name="unit"]'),base=formElement.querySelector('[name="base_price"]');
  let previousUnit=unit.value,currentIndex=null;
  const currency=()=>formElement.querySelector('[name="currency_choice"]')?.value==='custom'?formElement.querySelector('[name="currency"]')?.value||tariffCurrency({},ctx):formElement.querySelector('[name="currency_choice"]')?.value||tariffCurrency({},ctx);
  const options=()=>({unit:unit.value,currency:currency()});
  const rows=()=>[...list.querySelectorAll('[data-tariff-period]')].map(row=>({index:Number(row.dataset.tariffPeriod),start:row.querySelector('[data-tariff-field="start"]').value,end:row.querySelector('[data-tariff-field="end"]').value,price:row.querySelector('[data-tariff-field="price"]').value,weekdays:[...row.querySelectorAll('[data-tariff-day]')].map(input=>input.value)}));
  const refresh=()=>{
    const saved=rows().map((period,index)=>({...period,index}));list.innerHTML=saved.map(period=>renderTariffPeriod(period.index,period,options())).join('');
    formElement.querySelector('[data-tariff-timetable]').innerHTML=renderTariffTimetable(saved,{...options(),indices:saved.map(period=>period.index)});
    const flat=mode.value==='flat';periods.hidden=flat;periods.disabled=flat;
    formElement.querySelector('[data-tariff-empty]').hidden=saved.length>0;formElement.querySelector('[data-tariff-add]').disabled=saved.length>=TARIFF_MAX_PERIODS;
    const title=base.closest('.settings-field')?.querySelector('span');if(title)title.textContent=flat?'Price':'Standard rate';
    const major=unit.querySelector('option[value="major"]'),cent=unit.querySelector('option[value="cent"]');if(major)major.textContent=`${currency()} / kWh`;if(cent)cent.textContent=currency()==='GBP'?'Pence / kWh':'Cent / kWh';
  };
  const inputs=Object.fromEntries(['start','end','price'].map(key=>[key,editor.querySelector(`[data-tariff-input="${key}"]`)]));
  const dayInputs=[...editor.querySelectorAll('[name="tariff_editor_weekdays"]')],all=editor.querySelector('[data-tariff-select-all]'),output=editor.querySelector('[data-tariff-editor-error]');
  const updateAll=()=>{const count=dayInputs.filter(input=>input.checked).length;all.checked=count===DAYS.length;all.indeterminate=count>0&&count<DAYS.length;};
  const close=()=>{editor.close();currentIndex=null;output.textContent='';};
  const open=index=>{
    const saved=rows(),period=Number.isInteger(index)?saved.find(row=>row.index===index):null;
    if(Number.isInteger(index)&&!period)return;if(!period&&saved.length>=TARIFF_MAX_PERIODS)return;
    currentIndex=period?.index??Array.from({length:TARIFF_MAX_PERIODS},(_,i)=>i).find(i=>!saved.some(row=>row.index===i));
    for(const key of ['start','end','price'])inputs[key].value=period?.[key]??'';
    for(const input of dayInputs)input.checked=period?period.weekdays.includes(input.value):true;
    updateAll();output.textContent='';editor.querySelector('h3').textContent=period?'Edit time period':'New time period';
    editor.querySelector('[data-tariff-editor-unit]').textContent=tariffSuffix(unit.value,currency());editor.querySelector('[data-tariff-editor-delete]').hidden=!period;
    if(!editor.open)editor.showModal();inputs.start.focus();
  };
  formElement.addEventListener('click',event=>{
    const target=event.target?.closest?.('[data-tariff-add],[data-tariff-edit],[data-tariff-remove]');if(!target)return;event.preventDefault();
    if(target.hasAttribute('data-tariff-add'))return open();
    const index=Number(target.dataset.tariffEdit??target.dataset.tariffRemove);if(!Number.isInteger(index)||index<0||index>=TARIFF_MAX_PERIODS)return;
    if(target.hasAttribute('data-tariff-remove')){const row=list.querySelector(`[data-tariff-period="${index}"]`);if(row){row.remove();refresh();changed();}}else open(index);
  });
  formElement.addEventListener('change',event=>{
    if(event.target===unit&&unit.value!==previousUnit){const price=convertTariffPrice(base.value,previousUnit,unit.value);if(price!==null)base.value=String(price);for(const input of list.querySelectorAll('[data-tariff-field="price"]')){const amount=convertTariffPrice(input.value,previousUnit,unit.value);if(amount!==null)input.value=String(amount);}previousUnit=unit.value;}
    if(event.target===mode||event.target===unit||event.target?.name==='currency_choice'||event.target?.name==='currency')refresh();
  });
  for(const button of editor.querySelectorAll('[data-tariff-editor-cancel]'))button.addEventListener('click',close);
  editor.addEventListener('cancel',event=>{event.preventDefault();close();});
  all.addEventListener('change',()=>{for(const input of dayInputs)input.checked=all.checked;updateAll();});for(const input of dayInputs)input.addEventListener('change',updateAll);
  editor.querySelector('[data-tariff-editor-delete]').addEventListener('click',()=>{const row=list.querySelector(`[data-tariff-period="${currentIndex}"]`);if(row){row.remove();refresh();changed();}close();});
  editor.querySelector('[data-tariff-editor-submit]').addEventListener('click',()=>{
    if(currentIndex===null||!Object.values(inputs).every(input=>input.reportValidity()))return;
    try{const candidate={start:inputs.start.value,end:inputs.end.value,price:inputs.price.value,weekdays:dayInputs.filter(input=>input.checked).map(input=>input.value)},saved=rows().filter(row=>row.index!==currentIndex);validateTariffPeriods([...saved,candidate],unit.value);const html=renderTariffPeriod(currentIndex,candidate,options()),row=list.querySelector(`[data-tariff-period="${currentIndex}"]`);if(row)row.outerHTML=html;else list.insertAdjacentHTML('beforeend',html);refresh();changed();close();}catch(error){output.textContent=error.message||'Check the time period';}
  });
  refresh();
}
function renderHomepageBackgroundFields(display) {
  return select('background_type', 'Background', display.background_type, [['theme', 'Default background'], ['color', 'Custom color'], ['image', 'Custom image']]) + `<div class="settings-background-color">${field('background_color', 'Background color', display.background_color, 'type="color"')}</div><div class="settings-background-image">${field('background_image', 'Image URL or Home Assistant path', display.background_image, 'type="text" maxlength="2048" placeholder="/local/my-background.jpg"')}${note('Use a local image such as /local/my-background.jpg, or an HTTPS image URL.')}</div>`;
}
export function displayDefaults(ctx = {}) {
  const sections = Array.isArray(ctx.config?.overview_sections) && ctx.config.overview_sections.length ? ctx.config.overview_sections : ['today'];
  const visible = [...(ctx.entities?.battery_soc ? ['current_mode_battery'] : []), 'forecast', 'manual_controls', ...sections].filter(key => DISPLAY_KEYS.includes(key));
  const preferred = ctx.config?.main_display ?? attributes(ctx, 'control_status').dashboard?.main_display;
  const main_display = ['house', 'flow', 'photo'].includes(preferred) ? preferred : 'photo';
  const appearance = [ctx.config?.appearance, attributes(ctx, 'control_status').dashboard?.appearance, 'auto'].find(value => HOMEPAGE_APPEARANCES.includes(value));
  return { main_display, appearance, background_type: 'theme', background_color: DEFAULT_BACKGROUND_COLOR, background_image: '', preset: 'custom', order: [...new Set([...visible, ...DISPLAY_KEYS])], hidden: DISPLAY_KEYS.filter(key => !visible.includes(key)), immersive_weather: false };
}
function displayValues(ctx, p) {
  const defaults = displayDefaults(ctx);
  const order = Array.isArray(p.order) && p.order.length === DISPLAY_KEYS.length && new Set(p.order).size === DISPLAY_KEYS.length && p.order.every(key => DISPLAY_KEYS.includes(key)) ? p.order : defaults.order;
  const hidden = Array.isArray(p.hidden) && p.hidden.every(key => DISPLAY_KEYS.includes(key)) ? p.hidden : defaults.hidden;
  const background = homepageBackground(p);
  return { main_display: ['house', 'flow', 'photo'].includes(p.main_display) ? p.main_display : defaults.main_display, appearance: HOMEPAGE_APPEARANCES.includes(p.appearance) ? p.appearance : defaults.appearance, background_type:background.type, background_color:background.color, background_image:background.image, preset: ['custom', 'classic', 'advanced'].includes(p.preset) ? p.preset : 'custom', order, hidden, immersive_weather: p.immersive_weather === true };
}
const editorLinks = (ctx, route, label) => {
  const collection = object(own(object(ctx.interfaceOptions), route));
  const entries = Object.entries(collection).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
  return entries.map(([id, item]) => row(item.name || item.model || label, route, '', id)).join('');
};

export const SETTINGS_STYLE = `
.settings-background-color,.settings-background-image{display:none}.settings-page form:has(select[name="background_type"] option[value="color"]:checked) .settings-background-color,.settings-page form:has(select[name="background_type"] option[value="image"]:checked) .settings-background-image{display:grid;gap:10px}.settings-background-color input[type="color"]{width:100%;max-width:180px;min-height:48px;padding:5px;cursor:pointer}
.settings-page{display:grid;gap:18px;max-width:1040px;margin:0 auto;color:var(--primary-text-color,#243047)}
.settings-readonly-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:19px 22px;border-bottom:1px solid var(--divider-color,#dce5ed);min-height:58px;box-sizing:border-box}.settings-readonly-row:last-child{border-bottom:0}.settings-readonly-row strong{font-size:.95em;font-weight:500;overflow-wrap:anywhere}.settings-readonly-row input{width:23px;height:23px;accent-color:#18bec2}.settings-group{display:grid;border:1px solid var(--divider-color,#dce5ed);border-radius:23px;overflow:hidden;background:var(--card-background-color,rgba(255,255,255,.82))}
.settings-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:21px 23px;width:100%;text-align:left;border:0;border-bottom:1px solid var(--divider-color,#e4ebf2);background:transparent;color:inherit;font:inherit;cursor:pointer;min-height:64px}
.settings-row:last-child{border-bottom:0}.settings-row-value{color:var(--secondary-text-color,#7889a2);text-align:right;font-size:.9em;display:flex;align-items:center;gap:12px}.settings-row b{font-size:27px;font-weight:400}
.settings-row:hover,.settings-secondary:hover{background:var(--secondary-background-color,#f0f6f9)}
.settings-note{color:var(--secondary-text-color,#75869e);font-size:.9em;line-height:1.55;margin:0 4px}.settings-lock{display:block;border:1px solid #46bebd55;background:#36c8c810;border-radius:18px;padding:17px 20px;font-size:.9em;line-height:1.5}.settings-lock span{color:var(--secondary-text-color,#75869e)}
.settings-page form{display:grid;gap:17px}.settings-field{display:grid;gap:8px;padding:0 4px}.settings-field>span,.settings-check>span{font-size:.91em;color:var(--secondary-text-color,#75869e)}
.settings-field input,.settings-field select,.settings-field textarea{box-sizing:border-box;width:100%;padding:14px 15px;border-radius:14px;border:1px solid var(--divider-color,#dbe4ee);background:var(--card-background-color,#f7fafc);color:inherit;font:inherit;min-height:48px}.settings-field textarea{resize:vertical}.settings-field input:focus-visible,.settings-field select:focus-visible,.settings-field textarea:focus-visible{outline:2px solid #22c7c9;outline-offset:2px}
.settings-check{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:17px;border-radius:16px;background:var(--secondary-background-color,#f3f7fa)}.settings-check input{width:22px;height:22px;accent-color:#19bfc0}.settings-actions{display:flex;gap:12px;justify-content:flex-end;padding-top:10px}.settings-save,.settings-secondary,.settings-apply{border-radius:14px;padding:13px 22px;border:1px solid var(--divider-color,#d5e3eb);font:inherit;cursor:pointer;color:inherit;min-height:48px}.settings-save{background:linear-gradient(105deg,#1bc2c9,#70f1d6);color:#123b47;border-color:transparent}.settings-secondary{background:var(--card-background-color,#f7fafc)}.settings-apply{background:var(--secondary-background-color,#eef2f6);opacity:.55;cursor:not-allowed}.settings-form-result{color:var(--secondary-text-color,#75869e)}
.settings-columns,.settings-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.settings-metric{display:grid;gap:9px;padding:22px;border:1px solid var(--divider-color,#dde6ef);border-radius:20px;background:var(--card-background-color,#fff)}.settings-metric small,.settings-metric span{color:var(--secondary-text-color,#75869e)}.settings-metric strong{font-size:1.65em;font-weight:600}.settings-window{padding:18px;border-radius:18px;border:1px solid var(--divider-color,#dce5ed)}.settings-window summary{cursor:pointer;padding:3px 0 14px}.settings-window>.settings-columns{padding-top:4px}.settings-calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:7px}.settings-calendar>div{padding:12px 5px;border-radius:12px;background:var(--secondary-background-color,#f0f5f9);text-align:center;display:grid;gap:8px}.settings-calendar small{color:var(--secondary-text-color,#75869e)}.settings-segmented{display:flex;gap:6px;padding:5px;border-radius:19px;background:var(--secondary-background-color,#eef5f8)}.settings-segmented>*{flex:1}.settings-page h3{font-size:1.1em;margin:5px 3px}.settings-page a{color:var(--primary-color,#0c969e)}
.settings-charger-options{display:none;gap:14px}.settings-page form:has(select[name="mode"] option[value="pv_surplus"]:checked) .options-pv,.settings-page form:has(select[name="mode"] option[value="fast"]:checked) .options-fast,.settings-page form:has(select[name="mode"] option[value="v2x"]:checked) .options-v2x{display:grid}
.settings-charging-record{display:grid;gap:12px;padding:20px;border:1px solid var(--divider-color,#dce5ed);border-radius:20px;background:var(--card-background-color,#fff)}.settings-charging-record time,.settings-charging-record>small{font-size:.85em;color:var(--secondary-text-color,#75869e);overflow-wrap:anywhere}.settings-charging-record .settings-metric{padding:15px}.settings-record-filters input{min-width:0;box-sizing:border-box}
.settings-day-picker{padding:4px;border:0;margin:0;min-inline-size:0}.settings-day-picker legend{font-size:.91em;color:var(--secondary-text-color,#75869e);padding:0 0 10px}.settings-day-picker legend small{font-size:.78em;margin-left:7px}.settings-weekdays{display:flex;flex-wrap:wrap;gap:8px}.settings-weekdays label{position:relative;cursor:pointer}.settings-weekdays input{position:absolute;width:1px;height:1px;opacity:0}.settings-weekdays span{display:grid;place-items:center;min-width:42px;min-height:42px;box-sizing:border-box;border:1px solid var(--divider-color,#dbe4ee);border-radius:13px;background:var(--card-background-color,#f7fafc);font-size:.9em}.settings-weekdays input:checked+span{background:#27c6c830;border-color:#18aeb5;color:var(--primary-text-color,#1a4651);font-weight:600}.settings-weekdays input:focus-visible+span{outline:3px solid #22c7c9;outline-offset:3px}.settings-field abbr{text-decoration:none;color:#289a9c}.settings-custom-currency{display:none}.settings-page form:has(select[name="currency_choice"] option[value="custom"]:checked) .settings-custom-currency{display:block}
.settings-calendar-navigation{display:grid;grid-template-columns:52px 1fr 52px;gap:12px;align-items:center;text-align:center}.settings-calendar-navigation button{padding:8px;font-size:24px}.settings-segmented [aria-pressed="true"]{background:#27c6c830;border-color:#18aeb5}
.tariff-basic-controls,.tariff-currency-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.tariff-currency-controls>.settings-custom-currency{grid-column:1/-1;order:3}.tariff-basic-controls .settings-field,.tariff-currency-controls .settings-field{min-width:0;padding:0}.tariff-basic-controls input,.tariff-basic-controls select,.tariff-currency-controls input,.tariff-currency-controls select{min-height:44px;padding:10px 12px}.tariff-periods{display:grid;gap:14px;border:0;padding:0;margin:0;min-width:0;min-inline-size:0}.tariff-periods[hidden]{display:none}.tariff-periods>legend{position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden}.tariff-period-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px}.tariff-period-toolbar .settings-secondary{padding:9px 12px;min-height:42px;font-size:13px}.tariff-period-list{display:grid;gap:8px}.tariff-period-row{display:flex;align-items:stretch;min-width:0;border:1px solid var(--line,#dce6ed);border-radius:13px;background:var(--surface,#f8fbfd);overflow:hidden}.tariff-period-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:1;min-width:0;border:0;padding:11px 13px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.tariff-period-summary>span:first-child{min-width:0}.tariff-period-summary strong{font-size:13px;font-weight:600;line-height:1.35;overflow-wrap:anywhere}.tariff-period-summary small{display:block;font-size:11px;margin-top:4px;color:var(--muted,#75869e)}.tariff-edit-label{font-size:12px;color:#139ba4}.tariff-period-remove{flex:0 0 40px;min-height:46px;border:0;border-left:1px solid var(--line,#dce6ed);background:transparent;color:var(--muted,#75869e);font-size:22px;cursor:pointer}.tariff-advanced{border-top:1px solid var(--line,#dce6ed);padding:3px 0}.tariff-advanced>summary{padding:12px 4px;cursor:pointer;color:var(--muted,#75869e);font-size:13px}.tariff-advanced>.settings-columns{padding-top:7px}.tariff-timetable{min-width:0;border:1px solid var(--line,#dce6ed);border-radius:15px;overflow:hidden;background:var(--surface,#f8fbfd);padding:12px 8px 14px}.tariff-week-head,.tariff-week-grid{display:grid;grid-template-columns:35px repeat(7,minmax(0,1fr));gap:3px}.tariff-week-head{padding:0 0 9px}.tariff-week-head>strong{text-align:center;font-size:11px;font-weight:500;color:var(--muted,#75869e)}.tariff-week-grid{height:320px}.tariff-hours{position:relative;margin-right:4px}.tariff-hours>span{position:absolute;right:0;transform:translateY(-50%);font-size:9px;line-height:1;white-space:nowrap;color:var(--muted,#75869e)}.tariff-hours>span:first-child{transform:none}.tariff-hours>span:last-child{transform:translateY(-100%)}.tariff-day-track{position:relative;min-width:0;border-left:1px solid var(--line,#dce6ed);background:repeating-linear-gradient(to bottom,var(--line,#dce6ed) 0 1px,transparent 1px calc(100% / 24))}.tariff-time-block{position:absolute;left:0;right:0;min-width:0;border:1px solid color-mix(in srgb,var(--tariff-period-color) 85%,#345);border-radius:4px;background:color-mix(in srgb,var(--tariff-period-color) 85%,transparent);padding:2px 1px;color:#173141;font:inherit;cursor:pointer;overflow:hidden;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}.tariff-time-block strong{font-size:11px;line-height:1.1;font-weight:600}.tariff-time-block small{font-size:8px;line-height:1.1;color:inherit;white-space:nowrap}.tariff-time-block:focus-visible,.tariff-period-summary:focus-visible,.tariff-period-remove:focus-visible{outline:2px solid #16bfc4;outline-offset:-2px}.tariff-period-dialog{width:min(520px,calc(100vw - 24px));max-width:520px;max-height:90dvh;overflow:auto;padding:22px;border:1px solid var(--line,#dce6ed);border-radius:22px;background:var(--sigen-detail-bg,#edf4fa);color:var(--sigen-detail-ink,#243047);font:14px system-ui,sans-serif}.tariff-period-dialog[open]{display:grid;gap:17px}.tariff-period-dialog::backdrop{background:#10273b80;backdrop-filter:blur(4px)}.tariff-period-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.tariff-period-heading h3{margin:0;font-size:18px}.tariff-editor-close{min-width:40px;min-height:40px;border:0;border-radius:50%;background:transparent;color:inherit;font-size:25px;cursor:pointer}.tariff-period-time{display:grid;grid-template-columns:minmax(0,1fr) 25px minmax(0,1fr);gap:8px;align-items:end}.tariff-period-time>span{align-self:center;justify-self:center;margin-top:22px;color:var(--muted,#75869e)}.tariff-period-dialog .settings-field{margin:0;padding:0;gap:6px;min-width:0}.tariff-period-dialog .settings-field input{padding:11px;min-height:44px;margin:0;min-width:0}.tariff-period-dialog .settings-field abbr{display:none}.tariff-select-all{display:flex;align-items:center;justify-content:space-between;gap:12px}.tariff-select-all strong{font-size:13px;font-weight:500}.tariff-select-all label{display:inline-flex;align-items:center;gap:7px;margin:0;font-size:12px;min-height:35px}.tariff-select-all input{display:inline-block;width:19px;height:19px;margin:0;padding:0;accent-color:#18bec2}.tariff-editor-days .settings-day-picker{padding:0}.tariff-editor-days legend{position:absolute;width:1px;height:1px;clip-path:inset(50%);overflow:hidden}.tariff-period-dialog .settings-weekdays{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}.tariff-period-dialog .settings-weekdays label{margin:0}.tariff-period-dialog .settings-weekdays span{min-width:0;min-height:40px;font-size:12px;border-radius:10px}.tariff-editor-unit{margin-top:-12px;color:var(--muted,#75869e);font-size:11px}.tariff-period-dialog [data-tariff-editor-error]{color:#c45555;font-size:12px;margin:0}.tariff-editor-actions{display:flex;gap:8px;justify-content:flex-end}.tariff-editor-actions button{min-height:44px;padding:10px 15px}.tariff-editor-actions [hidden]{display:none}@media(max-width:600px){.tariff-week-grid{height:280px}.tariff-period-summary{gap:8px;padding:10px}.tariff-edit-label{display:none}.tariff-period-dialog{padding:18px}.tariff-editor-actions button{padding:10px 12px}.tariff-period-dialog .settings-weekdays span{font-size:11px}}
.settings-display-list{display:grid;gap:9px}.settings-display-row{display:grid;grid-template-columns:1fr 72px auto;align-items:center;gap:12px;padding:13px 15px;border:1px solid var(--divider-color,#dce5ed);border-radius:16px;background:var(--card-background-color,#fff)}.settings-display-row>label{display:flex;align-items:center;gap:12px;cursor:pointer}.settings-display-row input{width:21px;height:21px;accent-color:#19bfc0}.settings-display-row select{width:70px;padding:9px;border:1px solid var(--divider-color,#dce5ed);border-radius:10px;color:inherit;background:var(--card-background-color,#fff);font:inherit}.settings-display-move{display:flex;gap:5px}.settings-display-move button{width:36px;height:36px;border:1px solid var(--divider-color,#dce5ed);border-radius:10px;color:inherit;background:var(--card-background-color,#fff);cursor:pointer}.settings-display-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px}.settings-preset-preview{display:grid;grid-template-columns:1fr 1fr;gap:14px}.settings-preset-preview figure{margin:0;border:1px solid var(--divider-color,#dce5ed);border-radius:16px;padding:13px;text-align:center}.settings-preset-preview .preview-layout{display:grid;gap:5px;grid-template-columns:2fr 1fr;height:76px;margin-bottom:10px}.settings-preset-preview i{display:block;border-radius:7px;background:#27c6c825}.settings-preset-preview .advanced i{background:#7c95f32a}.settings-preset-preview figcaption{font-size:.86em;color:var(--secondary-text-color,#75869e)}@media(max-width:600px){.settings-display-row{grid-template-columns:1fr 58px;gap:8px;padding:12px}.settings-display-row select{width:56px}.settings-display-move{grid-column:1/-1;justify-content:flex-end}.settings-display-toolbar{align-items:flex-start}}
@media(min-width:1600px){.settings-page{max-width:1200px}.settings-row{padding:24px 28px}}@media(max-width:600px){.settings-page{gap:14px}.settings-columns{grid-template-columns:1fr}.settings-row{padding:18px 16px}.settings-row-value{max-width:50%;font-size:.84em}.settings-metric{padding:17px}.settings-metric strong{font-size:1.4em}.settings-actions>*{flex:1}.settings-calendar{gap:4px}.settings-calendar>div{padding:9px 3px}}
`;

export function renderSettingsDetail(route, ctx = {}) {
  if (!SETTINGS_ROUTES.includes(route)) return null;
  if (CHARGER_MORE_ROUTES.includes(route)) { const page=moreChargerPage(route,ctx); return {...page,body:`<div class="settings-page" data-settings-route="${esc(route)}">${page.body}</div>`}; }
  const draft = prefs(ctx, route), p = ['strategy', 'charger_schedule'].includes(route) ? { ...suppliedSchedule(ctx, route), ...draft } : draft, control = attributes(ctx, 'control_status');
  let title = titleCase(route), subtitle = 'Sigenergy TC', body = '';
  switch (route) {
    case 'chart_settings': {
      title='Customize charts';
      const selected=Array.isArray(p.selected)?p.selected:DEFAULT_CHART_SELECTION;
      body=form(route,'<p class="settings-note">Default combines related measurements. Select the combined or individual charts you want to see.</p>'+CHART_CHOICES.map(([key,label])=>`<label class="settings-check"><span>${esc(label)}</span><input type="checkbox" name="selected" value="${key}"${selected.includes(key)?' checked':''}></label>`).join(''));
      break;
    }
    case 'settings':
      title='Settings';subtitle='';
      body=`<section class="settings-home"><h2 class="settings-home-title">Settings</h2><div class="settings-home-tools">${button('Search settings','search')}${button('Add to dashboard','dashboard_install')}</div><div class="settings-home-grid">${[
        ['energy_profile','Energy settings','Modes, tariffs, strategies and priorities'],
        ['connection_settings','Connections & data','Modbus, mySigen Cloud, forecasts and AI'],
        ['display_settings','Appearance','House, Flow, background and layout'],
        ['system_settings','System & safety','System information, owner limits and maintenance'],
        ['service','Service','Alerts, messages, installer and support'],
        ['about','About','Sigenergy TC and Home Assistant preferences'],
      ].map(([target,label,description])=>`<button type="button" class="settings-home-tile" data-detail="${target}"><span><strong>${label}</strong><small>${description}</small></span><b aria-hidden="true">›</b></button>`).join('')}</div></section>`;
      break;
    case 'connection_settings':
      title='Connections & data';
      body=group(row('System connections','connections')+row('Solar forecast','forecast_settings')+row('AI assistant','ai_settings'));
      break;
    case 'dashboard_install':
      title='Add to dashboard';subtitle='Choose where Sigenergy TC appears';
      body='<div data-dashboard-installer><p class="settings-note">Loading dashboards…</p></div>';
      break;
    case 'system_settings':
      title='System & safety';
      body=group(row('System information','system_about')+row('System details','system_details')+row('Safety & owner limits','safety')+row('Indicator lights','indicator_settings','','led_strips'))+group(row('Maintenance','system_maintenance'));
      break;
    case 'system_details': {
      const plant = object(ctx.config?.plant), type = own(p, 'system_type') === undefined ? normalizedChoice(plant.system_type ?? plant.type, SYSTEM_TYPES) : p.system_type;
      const address = own(p, 'system_address') === undefined ? plant.address ?? plant.location : p.system_address;
      title = 'System Details';
      body = form(route, select('system_type', 'System Type', type || '', [['', 'Choose a system type'], ...SYSTEM_TYPES], 'required') + field('system_name', 'System Name', own(p, 'system_name') === undefined ? plant.name ?? ctx.config?.title ?? '' : p.system_name, 'required minlength="1" maxlength="255"') + textarea('system_address', 'System Address', typeof address === 'string' ? address : '')) + disabled('Apply to system');
      break;
    }
    case 'indicator_settings': {
      const channel = indicatorChannel(ctx), source = indicatorSource(ctx), saved = p.channel && p.channel !== channel ? {} : p;
      const enabled = own(saved, 'enabled') === undefined ? source.enabled : saved.enabled, mode = normalizedChoice(own(saved, 'mode') === undefined ? source.mode : saved.mode, INDICATOR_MODES[channel]);
      const brightness = finiteSetting(own(saved, 'brightness') === undefined ? source.brightness : saved.brightness), minimum = finiteSetting(source.brightness_min ?? source.brightness_range?.min), maximum = finiteSetting(source.brightness_max ?? source.brightness_range?.max), step = finiteSetting(source.brightness_step ?? source.brightness_range?.step);
      const slider = brightness !== null && minimum !== null && maximum !== null && minimum < maximum && brightness >= minimum && brightness <= maximum;
      const bounds = `${minimum === null ? '' : ` min="${minimum}"`}${maximum === null ? '' : ` max="${maximum}"`}`;
      title = 'Indicator Settings';
      body = `<div class="settings-segmented">${button('LED Strips', 'indicator_settings', 'led_strips', `aria-pressed="${channel === 'led_strips'}"`)}${button('Front', 'indicator_settings', 'front', `aria-pressed="${channel === 'front'}"`)}</div>` + form(route, select('enabled', 'Enable LED', enabled === true ? 'enabled' : enabled === false ? 'disabled' : '', [['', 'Choose LED state'], ['enabled', 'Enabled'], ['disabled', 'Disabled']], 'required') + select('mode', 'Mode', mode, [['', 'Choose a mode'], ...INDICATOR_MODES[channel]], 'required') + field('brightness', 'Brightness', brightness ?? '', `type="${slider ? 'range' : 'number'}"${bounds} step="${step !== null && step > 0 ? step : 'any'}"`)) + disabled('Apply to system');
      break;
    }
    case 'system_maintenance':
      title = 'System Maintenance';
      body = `<div class="settings-metrics">${metric('System status', current(ctx, 'system_status'))}${metric('Grid status', current(ctx, 'grid_status'))}</div><div class="settings-actions">${disabled('Power-On')}${disabled('Power-Off')}${disabled('Go Off-Grid')}</div>` + group(row('Maintenance information', 'maintenance'));
      break;
    case 'app_settings': {
      const locale=object(ctx.haLocale);
      title='Home Assistant preferences';
      body=form(route,select('time_format','Time format',locale.time_format??'language',[['language','Follow language'],['system','Follow device'],['12','12-hour'],['24','24-hour']])+select('date_format','Date format',locale.date_format??'language',[['language','Follow language'],['system','Follow device'],['DMY','Day / month / year'],['MDY','Month / day / year'],['YMD','Year / month / day']])+select('number_format','Number format',locale.number_format??'language',[['language','Follow language'],['system','Follow device'],['comma_decimal','1,234.56'],['decimal_comma','1.234,56'],['space_comma','1 234,56'],['none','No separators']])+select('first_weekday','First weekday',locale.first_weekday??'language',[['language','Follow language'],['monday','Monday'],['sunday','Sunday'],['saturday','Saturday']]))+note('These preferences apply to your Home Assistant user account.')+group(nativeProfileLink('Account, language and security'));
      break;
    }
    case 'display_settings': {
      title = 'Homepage appearance'; const display = displayValues(ctx, p), hidden = new Set(display.hidden);
      body = form(route, select('appearance', 'House lighting', display.appearance, [['auto', 'Auto'], ['day', 'Day'], ['night', 'Night'], ['theme', 'Home Assistant theme']]) + note('House lighting follows the selected scene setting. Interface colours always follow Home Assistant’s light or dark theme. Auto follows the sun and falls back to the theme when sun data is unavailable.') + renderHomepageBackgroundFields(display) + select('main_display', 'Main display', display.main_display, [['house', 'House'], ['flow', 'Flow'], ['photo', 'Photo house']]) + select('preset', 'Layout', display.preset, [['custom', 'Default'], ['classic', 'Classic'], ['advanced', 'Advanced']], 'data-display-preset') + note('Classic shows a smaller selection of modules. Default balances key information with a compact layout. Advanced shows all modules.') + '<div class="settings-preset-preview" aria-hidden="true"><figure><div class="preview-layout"><i></i><i></i><i></i><i></i></div><figcaption>Classic</figcaption></figure><figure><div class="preview-layout advanced"><i></i><i></i><i></i><i></i><i></i><i></i></div><figcaption>Advanced</figcaption></figure></div>' + `<div class="settings-display-toolbar"><h3>Display modules</h3><button type="button" class="settings-secondary" data-display-restore>Restore defaults</button></div><div class="settings-display-list">${display.order.map((key, index) => { const item = DISPLAY_MODULES.find(module => module.key === key); return `<div class="settings-display-row" data-display-row data-display-key="${key}" draggable="true"><label><input type="checkbox" name="visible" value="${key}"${hidden.has(key) ? '' : ' checked'}><span>${esc(item.label)}</span></label><select name="order_${key}" aria-label="Order ${esc(item.label)}">${DISPLAY_KEYS.map((_, position) => `<option value="${position + 1}"${index === position ? ' selected' : ''}>${position + 1}</option>`).join('')}</select><div class="settings-display-move"><button type="button" data-display-move="-1" data-display-key="${key}" aria-label="Move ${esc(item.label)} up">↑</button><button type="button" data-display-move="1" data-display-key="${key}" aria-label="Move ${esc(item.label)} down">↓</button></div></div>`; }).join('')}</div>` + check('immersive_weather', 'Immersive Weather Experience', display.immersive_weather) + note('Available for sunny, cloudy, foggy, rainy, snowy and thunderstorm conditions.'));
      break;
    }
    case 'mode':
      title = 'Operating mode';
      body = `<div class="settings-metrics">${metric('App mode', current(ctx, 'cloud_mode'))}${metric('Local mode', current(ctx, 'native_mode'))}</div>` + form(route, select('mode', 'Operating mode', nativeModeChoices(ctx).length ? selectedMode(ctx) : own(p, 'mode') === undefined ? observedOperatingMode(ctx) : p.mode, [['', 'Choose an operating mode'], ...modeChoices(ctx)], 'required')) + (nativeModeChoices(ctx).length ? '' : disabled('Apply to Sigenergy')) + group(row('Buying & selling tariffs', 'tariffs') + row('Personal strategies', 'strategies') + row('Sigen AI overview', 'ai'));
      if(nativeModeChoices(ctx).length)body=body.replace('>Save draft</button>','>Apply</button>');
      break;
    case 'tariffs': {
      title = 'Buying & selling tariffs'; const edits = object(own(object(ctx.interfaceOptions), 'tariff_edit'));
      body = group(row('Buying', 'tariff_edit', edits.import?.currency || 'Configure import prices', 'import') + row('Selling', 'tariff_edit', edits.export?.currency || 'Configure export prices', 'export')) + note('Set import and export prices, including negative rates.') + group(row('Personal strategies', 'strategies') + row('Energy value', 'energy_value'));
      break;
    }
    case 'tariff_edit': {
      const direction = ctx.id === 'export' ? 'export' : 'import'; title = direction === 'export' ? 'Selling tariff' : 'Buying tariff';
      body = form(route, tariffFields(p, ctx)) + tariffPeriodEditor() + group(row('Seasons', 'tariff_seasons', '', direction));
      break;
    }
    case 'tariff_seasons': {
      const direction = ctx.id === 'export' ? 'export' : 'import', seasons = seasonItems(ctx, direction);
      title = `${direction === 'export' ? 'Selling' : 'Buying'} tariff seasons`;
      body = group(seasons.map(([id, item]) => row(item.name || 'Season', 'tariff_season', `${MONTHS[item.start_month - 1] || '—'}–${MONTHS[item.end_month - 1] || '—'}`, id)).join('') + row('Add season', 'tariff_season', '', `${direction}:new`)) + group(row('Year-round tariff', 'tariff_edit', '', direction));
      break;
    }
    case 'tariff_season': {
      const direction = seasonDirection(ctx), months = MONTHS.map((label, index) => [index + 1, label]);
      title = p.name || 'Tariff season';
      body = form(route, `<input type="hidden" name="direction" value="${direction}"><div class="settings-columns">${select('start_month', 'From month', p.start_month ?? 1, months)}${select('end_month', 'Through month', p.end_month ?? 12, months)}</div>` + tariffFields(p, ctx, 'Season name')) + tariffPeriodEditor() + note('Prices and windows apply only to this season. Month ranges may cross the year boundary.');
      break;
    }
    case 'strategy_control': {
      title='Scheduled strategies';
      const status=attributes(ctx,'control_status').strategy_status??{state:'disabled'};
      body=`<div class="settings-metrics">${metric('Status',status.state.replaceAll('_',' '))}</div>`+form(route,check('enabled','Run personal strategies',p.enabled===true))+group(row('Personal strategies','strategies'));
      if(status.reason)body+=note(status.reason);
      if(ctx.controlPermission)body=body.replace('>Save draft</button>','>Save</button>');
      break;
    }
    case 'strategies':
      title = 'Personal strategies'; body = group(row('Scheduling','strategy_control',attributes(ctx,'control_status').strategy_status?.state?.replaceAll('_',' ')??'disabled')) + group(editorLinks(ctx, 'strategy', 'Personal strategy') + row('Add personal strategy', 'strategy', '', 'new')) + group(row('Buying & selling tariffs', 'tariffs') + row('Safety & owner limits', 'safety') + row('Ask the AI assistant', 'ai'));
      break;
    case 'strategy': {
      title = p.name || 'Personal strategy';
      const eligibility=strategyExportEligibility(ctx),restricted=p.action==='battery_export'&&!eligibility.allowed;
      const include=`<label class="settings-check"><span>Enable this strategy</span><input type="checkbox" name="enabled"${p.enabled===true&&!restricted?' checked':''}${restricted?' disabled':''}></label>`;
      body = form(route, field('name', 'Name', p.name || '', 'required maxlength="80"') + dayPicker('weekdays', 'Repeat on', p.weekdays) + `<div class="settings-columns">${field('start', 'From', p.start ?? '', 'type="time" required')}${field('end', 'Until', p.end ?? '', 'type="time" required')}</div>` + note('An end before the start continues next morning.') + select('condition', 'Battery SOC condition', p.condition || 'above', [['above', 'Only when SOC is above'], ['below', 'Only when SOC is below'], ['none', 'No SOC condition']]) + field('soc', 'SOC threshold (%)', p.soc ?? '', 'type="number" min="0" max="100" step="0.1"') + select('action', 'Action', p.action || 'charge', STRATEGY_ACTIONS, 'data-strategy-action') + `<p class="settings-note" data-strategy-export-note${p.action==='battery_export'?'':' hidden'}>${esc(eligibility.reason)}</p>` + field('power_kw','Battery power limit (kW)',p.power_kw??'','type="number" min="0.001" max="100" step="0.001" placeholder="System limits"') + field('export_kw','Solar export limit (kW)',p.export_kw??'','type="number" min="0.001" max="100" step="0.001"') + field('priority', 'Priority (0–100)', p.priority ?? 50, 'type="number" min="0" max="100" step="1" required') + include) + (ctx.controlPermission?'':disabled('Run on system'));
      if(ctx.controlPermission)body=body.replace('>Save draft</button>','>Save strategy</button>');
      break;
    }
    case 'priority':
      title = 'Battery Discharging Priority';
      body = form(route, [1, 2, 3].map((n, i) => select(`priority_${n}`, `Priority ${n}`, p.order?.[i] || ['solar', 'evdc', 'grid'][i], [['solar', 'Solar'], ['evdc', 'EVDC'], ['grid', 'GRID']])).join('')) + disabled('Apply priority');
      break;
    case 'surplus_pv_priority': {
      const choices = surplusChoices(ctx), charger = chargerKind(ctx)?.toUpperCase();
      title = charger ? `${charger} Surplus PV Priority` : 'Surplus PV Priority';
      body = choices.length ? form(route, choices.map((_, index) => select(`priority_${index + 1}`, `Destination ${index + 1}`, p.order?.[index] || '', [['', 'Choose a destination'], ...choices], 'required')).join('')) : note('No energy destinations are mapped.') + group(row('Connections', 'connections'));
      break;
    }
    case 'charging_mode': {
      const kind = chargerKind(ctx); if (!kind) { title = 'Charging Mode'; body = note('Charger information is unavailable.') + group(row('Connections', 'connections')); break; }
      const dc = kind === 'dc', id = chargerId(ctx); title = `${kind.toUpperCase()} Charging Mode`;
      body = form(route, select('mode', 'Charging Mode', chargerMode(ctx, p), [['', 'Choose a charging mode'], ...chargerModes(dc)], 'required') + `<div class="settings-charger-options options-pv${dc ? ' options-fast' : ''}">${check('battery_boost', 'Battery Boost · Charge from home battery', p.battery_boost === true)}</div><div class="settings-charger-options options-pv">${check('grid_charging', 'Grid Charging · Temporary fast charging in PV surplus mode', p.grid_charging === true)}</div>` + (dc ? `<div class="settings-charger-options options-fast">${field('cutoff_soc', 'Cut-off SOC (%)', p.cutoff_soc ?? '', 'type="number" min="0" max="100" step="1"')}</div><div class="settings-charger-options options-v2x">${field('discharge_power_kw', 'Car Discharging Power (kW)', p.discharge_power_kw ?? '', 'type="number" min="0.001" step="any"')}${field('stop_discharging_soc', 'Stop Discharging (%)', p.stop_discharging_soc ?? '', 'type="number" min="20" max="99" step="1"')}</div>` : '')) + disabled('Apply charging mode') + group(row('Surplus PV Priority', 'surplus_pv_priority', '', id) + row('Schedule', 'charger_schedules', '', id) + row('Sigen AI setup', 'ai'));
      break;
    }
    case 'charger_schedules': {
      const page = chargerSchedulesPage(ctx); title = page.title; body = page.body; break;
    }
    case 'charger_schedule': {
      const identity = chargerScheduleIdentity(ctx); if (!identity) { title = 'Charging schedule'; body = note('Charger information is unavailable.') + group(row('Connections', 'connections')); break; }
      const id = identity.chargerId, source = identity.context;
      title = 'Charging schedule';
      body = form(route, field('name', 'Name', p.name || '', 'required maxlength="80"') + dayPicker('weekdays', 'Repeat on', p.weekdays) + `<div class="settings-columns">${field('start', 'From', p.start || '', 'type="time" required')}${field('end', 'Until', p.end || '', 'type="time" required')}</div>` + select('mode', 'Charging Mode', chargerMode(source, p, false), [['', 'Choose a charging mode'], ...chargerModes(isDC(source))], 'required') + check('enabled', 'Include in local plan', p.enabled !== false)) + note('An end before the start continues next morning.') + disabled('Send schedule') + group(row('All schedules', 'charger_schedules', '', id) + row('Charging mode', 'charging_mode', '', id) + row('Charging records', 'charger_records', '', id));
      break;
    }
    case 'charger_records': {
      const page = chargerRecordsPage(ctx); title = page.title; body = page.body; break;
    }
    case 'vehicles': {
      const chargers = inventory(ctx).filter(item => deviceKind(item) === 'dc'), id = chargers.length === 1 ? deviceId(chargers[0]) : null;
      const target = id !== undefined && id !== null && String(id) !== '' ? row('DC charging mode', 'charging_mode', '', String(id)) : chargers.length > 1 ? row('Choose a DC charger', 'devices') : disabled('DC charging mode');
      title = 'My Car'; body = group(editorLinks(ctx, 'vehicle', 'Vehicle') + row('Add My Car', 'vehicle', 'Local metadata', 'new')) + group(target);
      break;
    }
    case 'vehicle':
      title = p.brand || p.model ? `${p.brand || ''} ${p.model || ''}`.trim() : 'Add My Car';
      body = form(route, field('brand', 'Brand', p.brand || '', 'required maxlength="40"') + field('model', 'Type / model', p.model || '', 'required maxlength="60"') + field('year', 'Type date · model year', p.year ?? '', 'type="number" min="1900" max="2100" step="1" required') + field('capacity_kwh', 'Battery Capacity (kWh)', p.capacity_kwh ?? '', 'type="number" min="0.1" max="1000" step="any" required') + check('primary', 'Setting as primary vehicle', p.primary === true));
      break;
    case 'device_settings': {
      const selected = selectedDevice(ctx);
      if (hasDeviceId(ctx) && !selected) { title = 'Device Settings'; body = note('Device information is unavailable.') + group(row('Connections', 'connections')); break; }
      const name = selected?.name || (selected ? titleCase(deviceKind(selected)) : 'SigenStor');
      title = `${name} Settings`;
      body = form(route, field('name', 'Device Name', own(p, 'name') === undefined ? selected?.name ?? (hasDeviceId(ctx) ? '' : ctx.config?.title || '') : p.name, 'maxlength="60"')) + group(row('Network', 'network', '', ctx.id || '') + row('Maintenance', 'maintenance', '', ctx.id || '') + row('Add System Device', 'add_device') + row('Total Panel Capacity', 'pv_capacity') + row('Panel Brand', 'pv_brand') + row('Panel Model', 'pv_model') + row('PV String Name', 'string_names') + row('Safety & owner limits', 'safety'));
      break;
    }
    case 'network': {
      title = 'Network';
      const local=read(ctx,'modbus_status')?.attributes??{},connections=ctx.connections??[],localConnection=connections.find(item=>item.key==='modbus'),cloudConnection=connections.find(item=>item.key==='cloud');
      const deviceFields=[['Network type','network_type'],['Local address','ip_address'],['Signal strength','network_signal']].map(([label,key])=>[label,mappedFact(ctx,key)]).filter(([,value])=>value!=='—');
      body = `<div class="settings-metrics">${deviceFields.map(([label,value])=>metric(label,value)).join('')}${metric(localConnection?.shared_readings?'Shared local readings':'Local Modbus',localConnection?.description??(local.status==='connected'?'Connected':local.configured===false?'Not configured':'—'))}${metric('mySigen Cloud',cloudConnection?.description??cloudState(ctx))}${!hasDeviceId(ctx)&&local.host?metric('Modbus address',`${local.host}:${local.port??502}`):''}${local.poll_interval_seconds?metric('Local polling',`${local.poll_interval_seconds} seconds`):''}${local.read_only?metric('Modbus access','Additional read-only connection'):''}</div>`;
      if(local.trace&&Object.hasOwn(local.trace,'read_requests'))body+=group(`<div class="settings-readonly-row"><span>Successful read cycles</span><strong>${esc(local.trace.snapshots??0)}</strong></div><div class="settings-readonly-row"><span>Read requests / errors</span><strong>${esc(local.trace.read_requests)} / ${esc(local.trace.errors??0)}</strong></div>${local.trace.last_cycle_seconds===undefined?'':`<div class="settings-readonly-row"><span>Last read cycle</span><strong>${esc(local.trace.last_cycle_seconds)} s</strong></div>`}`);
      body+=group(row('Connections', 'connections') + row('Device settings', 'device_settings', '', ctx.id || ''));
      break;
    }
    case 'maintenance':
      title = 'Maintenance';
      body = `<div class="settings-metrics">${metric('System status', deviceStatus(ctx))}${metric('Model', mappedFact(ctx, 'model'))}${metric('Firmware', mappedFact(ctx, 'firmware'))}</div>` + group(row('Network', 'network', '', ctx.id || '') + row('Connections', 'connections'));
      break;
    case 'add_device': {
      title = 'Add System Device';
      const known = inventory(ctx).filter(item => ['inverter', 'batterymodule', 'gateway', 'ac', 'dc', 'solar'].includes(deviceKind(item)));
      body = (known.length ? group(known.map(item => `<div class="settings-row"><span>${esc(item.name || titleCase(item.type || 'Device'))}</span><span class="settings-row-value">${esc(item.model || '—')}</span></div>`).join('')) : note('No devices are mapped.')) + `<p class="settings-note"><a href="/config/integrations/dashboard">Open Home Assistant integrations</a></p>` + group(row('Connections', 'connections'));
      break;
    }
    case 'pv_capacity':
      title = 'Total Panel Capacity'; body = form(route, field('capacity_wp', 'Total Panel Capacity (Wp)', own(p, 'capacity_wp') === undefined ? inventoryCapacity(ctx) : p.capacity_wp, 'type="number" min="1" max="10000000" step="1" required'));
      break;
    case 'pv_brand': case 'pv_model': {
      const key = route === 'pv_brand' ? 'brand' : 'model'; title = route === 'pv_brand' ? 'Panel brand' : 'Panel model'; body = form(route, field(key, title, p[key] || '', 'maxlength="20" required')) + note('Up to 20 characters.'); break;
    }
    case 'string_names':
      title = 'PV String Name'; body = form(route, field('pv1', 'PV1', p.pv1 || 'PV1', 'maxlength="20" required') + field('pv2', 'PV2', p.pv2 || 'PV2', 'maxlength="20" required')) + note('Up to 20 characters per name.');
      break;
    case 'safety': {
      title = 'Safety & owner limits'; const caps = object(control.manual_control_power);
      body = `<div class="settings-metrics">${metric('Current battery SOC', numberText(value(ctx, 'battery_soc', 'soc'), '%'))}${metric('Export permitted', current(ctx, 'export_permitted'))}</div>` + form(route, field('reserve_soc', 'Battery reserve (%)', p.reserve_soc ?? '', 'type="number" min="0" max="100" step="1"') + field('max_charge_kw', 'Owner charging maximum (kW)', p.max_charge_kw ?? caps.charge?.user_max_kw ?? '', 'type="number" min="0.001" step="any"') + field('max_discharge_kw', 'Owner discharging maximum (kW)', p.max_discharge_kw ?? caps.discharge?.user_max_kw ?? '', 'type="number" min="0.001" step="any"') + check('export_requested', 'Request export in the proposed plan', p.export_requested === true)) + group(row('Connection capabilities', 'connections'));
      break;
    }
    case 'connections':
      title = 'Connections';
      { const status=attributes(ctx,'control_status').connections??{},labels={connected:'Connected',disabled:'Disabled',disconnected:'Unavailable',connecting:'Connecting',setup_required:'Set up required',authorisation_required:'Owner authorisation required',authentication_required:'Sign in required',rate_limited:'Rate limited',session_conflict:'Account session limit'};
        const items=ctx.connections??['modbus','cloud'].map(key=>({key,label:{modbus:'Modbus',cloud:'Cloud'}[key],description:key==='cloud'&&ctx.config?.cloud_paused?'Disabled':labels[status[key]?.status??read(ctx,`${key}_status`)?.state]??'Disabled'}));
        body=`<div class="settings-metrics">${items.map(item=>metric(item.label,item.description)).join('')}</div>`
          + `<button type="button" class="settings-secondary" data-configure-connections>Configure connections</button>`+group(row('Modbus server','modbus_server'));
      }
      break;
    case 'forecast_settings': {
      title = 'Solar forecast';
      const forecast=ctx.forecastConfiguration;
      body=`<div class="settings-metrics">${metric('Using', current(ctx, 'forecast_status'))}${metric('Today', numberText(value(ctx, 'forecast_today', 'energy'), ' kWh'))}${metric('Tomorrow', numberText(value(ctx, 'forecast_tomorrow', 'energy'), ' kWh'))}</div>`;
      if(!forecast){body+=note('Loading forecast sources…');break;}
      if(forecast.error){body+=note(forecast.error);break;}
      const selected=new Set(forecast.selected_sources??[]),sources=forecast.sources??[],main=sources.filter(source=>selected.has(source.id));
      body+=form(route,`<h3>Forecast sources</h3>`+sources.map(source=>`<label class="settings-check forecast-source"><span><strong>${esc(source.name)}</strong><small>${esc(source.title)}${source.loaded?'':' · Not loaded'}</small></span><input type="checkbox" name="sources" value="${esc(source.id)}"${selected.has(source.id)?' checked':''}></label>`).join('')+check('average','Average connected forecasts',forecast.average)+select('primary_source','Main forecast when averaging is off',forecast.primary_source,main.length?main.map(source=>[source.id,`${source.name} · ${source.title}`]):[['','No source selected']])+note('Select up to two forecasts covering the same panels. Missing source data is excluded.'));
      body+=`<div class="forecast-provider-links">${(forecast.providers??[]).filter(provider=>!provider.installed).map(provider=>`<a class="settings-secondary" href="${esc(provider.url)}" target="_blank" rel="noopener noreferrer">Connect ${esc(provider.name)}</a>`).join('')}</div>`;
      break;
    }
    case 'ai_settings':
      title = 'AI assistant'; body = form(route, select('provider', 'Provider', p.provider || 'none', [['none', 'Disabled'], ['home_assistant', 'Home Assistant conversation agent'], ['openai', 'OpenAI'], ['anthropic', 'Claude'], ['google', 'Gemini']]) + field('agent_entity', 'Configured conversation agent', p.agent_entity || '', 'placeholder="conversation.your_agent" maxlength="150"') + check('share_energy_data', 'Share energy context with the AI assistant', p.share_energy_data === true)) + note('Configure your conversation agent in Home Assistant.') + group(row('AI overview', 'ai') + row('Personal strategies', 'strategies'));
      break;
    case 'ai':
      title = 'Energy assistant'; body = `<div class="settings-metrics">${metric('Provider preference', titleCase(prefs(ctx, 'ai_settings').provider || 'Disabled'))}</div>` + form(route, textarea('request', 'Describe the energy plan you want', p.request || '')) + group(row('AI connection settings', 'ai_settings') + row('My personal strategies', 'strategies') + row('Production & consumption forecast', 'forecast_settings') + row('Revenue calendar', 'revenue_calendar') + row('Battery SOC & prices', 'tariffs'));
      break;
    case 'revenue_calendar': {
      title = 'Revenue Calendar'; let now = ctx.now instanceof Date ? ctx.now : new Date(ctx.now ?? Date.now()); if (!Number.isFinite(now.getTime())) now = new Date();
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timeZone(ctx), year: 'numeric', month: '2-digit' }).formatToParts(now);
      let month = Number(parts.find(x => x.type === 'month')?.value), year = Number(parts.find(x => x.type === 'year')?.value);
      const monthMatch = /^month:(\d{4})-(\d{2})$/.exec(String(ctx.id || '')), yearMatch = /^year:(\d{4})$/.exec(String(ctx.id || ''));
      if (monthMatch && Number(monthMatch[1]) >= 1900 && Number(monthMatch[2]) >= 1 && Number(monthMatch[2]) <= 12) { year = Number(monthMatch[1]); month = Number(monthMatch[2]); }
      if (yearMatch && Number(yearMatch[1]) >= 1900) year = Number(yearMatch[1]);
      const yearly = ctx.id === 'year' || Boolean(yearMatch), days = new Date(Date.UTC(year, month, 0)).getUTCDate(), offset = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
      const monthId = (y, m) => `month:${y}-${String(m).padStart(2, '0')}`;
      const shift = step => { const index = year * 12 + month - 1 + step; return monthId(Math.floor(index / 12), index % 12 + 1); };
      const heading = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...(yearly ? {} : { month: 'long' }), year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, 15)));
      const before = yearly ? `year:${year - 1}` : shift(-1), after = yearly ? `year:${year + 1}` : shift(1);
      const previousDisabled = year <= 1900 && (yearly || month === 1), nextDisabled = year >= 9999 && (yearly || month === 12);
      body = `<div class="settings-segmented">${button('Month', 'revenue_calendar', monthId(year, month), `aria-pressed="${!yearly}"`)}${button('Year', 'revenue_calendar', `year:${year}`, `aria-pressed="${yearly}"`)}</div><div class="settings-calendar-navigation">${button('‹', 'revenue_calendar', before, `aria-label="Previous ${yearly ? 'year' : 'month'}"${previousDisabled ? ' disabled' : ''}`)}<strong>${esc(heading)}</strong>${button('›', 'revenue_calendar', after, `aria-label="Next ${yearly ? 'year' : 'month'}"${nextDisabled ? ' disabled' : ''}`)}</div>` + note('Revenue history is unavailable.') + (yearly ? `<div class="settings-metrics">${MONTHS.map(label => metric(label, '—')).join('')}</div>` : `<div class="settings-calendar" aria-label="Revenue calendar">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => `<small>${day}</small>`).join('')}${Array.from({ length: offset }, () => '<span aria-hidden="true"></span>').join('')}${Array.from({ length: days }, (_, i) => `<div><small>${i + 1}</small><strong>—</strong></div>`).join('')}</div>`) + group(row('Energy value', 'energy_value') + row('Buying & selling tariffs', 'tariffs'));
      break;
    }
    case 'energy_value':
      title = 'Energy Value'; body = `<div class="settings-metrics">${metric('Import cost', '—')}${metric('Export income', '—')}${metric('Net energy cost', '—')}${metric('Savings', '—')}</div>` + note('Energy value needs interval readings and matching tariffs.') + group(row('Buying & selling tariffs', 'tariffs') + row('Revenue calendar', 'revenue_calendar'));
      break;
    case 'environment':
      title = 'Environmental Benefits'; body = `<div class="settings-metrics">${metric('Solar generated today', numberText(value(ctx, 'solar_today', 'energy'), ' kWh'))}${metric('CO₂ emissions avoided', '—')}${metric('Equivalent coal saved', '—')}${metric('Equivalent trees', '—')}</div>` + note('Environmental factors have not been configured.') + group(row('Energy value', 'energy_value') + row('About this integration', 'about'));
      break;
    case 'about':
      title = 'About Sigenergy TC'; body = group(row('Home Assistant preferences','app_settings')) + note('Sigenergy TC (Total Control): community Home Assistant integration with local telemetry and optional cloud features.');
      break;
  }
  if(route==='display_settings')body+=group(row('Customize charts','chart_settings'));
  return { title, subtitle, body: `<div class="settings-page" data-settings-route="${esc(route)}">${body}</div>` };
}

function plainValues(input) {
  if (typeof HTMLFormElement !== 'undefined' && input instanceof HTMLFormElement) input = new FormData(input);
  if (input && typeof input.entries === 'function' && !Array.isArray(input)) {
    const entries = [...input.entries()], result = Object.create(null);
    for (const key of new Set(entries.map(([name]) => name))) {
      const values = typeof input.getAll === 'function' ? input.getAll(key) : entries.filter(([name]) => name === key).map(([, val]) => val);
      result[key] = key === 'weekdays' || /^window_\d+_weekdays$/.test(key) || values.length > 1 ? values : values[0];
    }
    return result;
  }
  return object(input);
}
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
function text(v, name, max = 80, required = false) {
  if (v == null) v = '';
  if (typeof v !== 'string') throw new Error(`${name} must be text`);
  const cleaned = v.trim();
  if (required && !cleaned) throw new Error(`${name} is required`);
  if (cleaned.length > max || /[\u0000-\u001f\u007f]/.test(cleaned)) throw new Error(`${name} is invalid`);
  return cleaned;
}
function multilineText(v, name, max = 2000) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) throw new Error(`${name} is invalid`);
  return v.trim();
}
function numeric(v, name, min, max, optional = false, integer = false) {
  if (v == null || v === '') { if (optional) return null; throw new Error(`${name} is required`); }
  if (!['number', 'string'].includes(typeof v) || typeof v === 'string' && (!v.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v.trim()))) throw new Error(`${name} must be a number`);
  const n = Number(v); if (!Number.isFinite(n) || n < min || n > max || integer && !Number.isInteger(n)) throw new Error(`${name} is outside the permitted range`);
  return n;
}
function option(v, name, choices) { if (!choices.includes(v)) throw new Error(`${name} is invalid`); return v; }
function bool(v) { if (v === undefined || v === null || v === false || v === '') return false; if (v === true || v === 'on' || v === 'true') return true; throw new Error('Checkbox value is invalid'); }
function zone(v) { const z = text(v, 'Time zone', 80, true); try { new Intl.DateTimeFormat('en', { timeZone: z }); } catch { throw new Error('Time zone is invalid'); } return z; }
function clock(v, label) { if (typeof v !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new Error(`${label} must be a valid time`); return v; }
function weekdays(v) {
  const list = Array.isArray(v) ? v : text(v, 'Weekdays', 40, true).toLowerCase().split(',').map(x => x.trim());
  if (!list.length || list.some(d => !DAYS.includes(d)) || new Set(list).size !== list.length) throw new Error('Choose valid, unique weekdays');
  return DAYS.filter(d => list.includes(d));
}
function windowTimes(input) { const start = clock(input.start, 'From'), end = clock(input.end, 'Until'); if (start === end) throw new Error('From and Until must differ'); return { start, end, overnight: end < start }; }
export function validateTariffPeriods(periods, unit = 'major') {
  option(unit,'Price unit',['major','cent']);
  if(!Array.isArray(periods)||periods.length>TARIFF_MAX_PERIODS)throw new Error(`Use no more than ${TARIFF_MAX_PERIODS} time periods`);
  const windows=periods.map(period=>{period=object(period);const window={...windowTimes(period),weekdays:weekdays(period.weekdays),price:numeric(period.price,'Period price',-1000000,1000000)};window.price_per_kwh=window.price/(unit==='cent'?100:1);return window;});
  const slots=[];
  for(const window of windows)for(const day of window.weekdays){const start=DAYS.indexOf(day)*1440+Number(window.start.slice(0,2))*60+Number(window.start.slice(3)),end=DAYS.indexOf(day)*1440+Number(window.end.slice(0,2))*60+Number(window.end.slice(3))+(window.overnight?1440:0);if(slots.some(([a,b])=>Math.max(start,a)<Math.min(end,b)))throw new Error('TOU windows overlap');slots.push([start,end],[start-10080,end-10080],[start+10080,end+10080]);}
  return windows;
}
function identifier(v, name, prefix) { const s = text(v, name, 150); if (s && !new RegExp(`^${prefix}\\.[a-z0-9_]+$`).test(s)) throw new Error(`${name} is invalid`); return s; }
function objectId(ctx) { const id = String(ctx.id || 'new'); if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(id)) throw new Error('Draft ID is invalid'); return id; }

/** Validate form values. Plant dispatch additionally requires the bound HA backend. */
export function collectSettings(route, formValues, ctx = {}) {
  if (!SETTINGS_ROUTES.includes(route)) throw new Error('Unknown settings page');
  const f = plainValues(formValues), get = key => own(f, key), out = { route, local_only: true };
  switch (route) {
    case 'app_settings':
      out.time_format=option(get('time_format'),'Time format',['language','system','12','24']);
      out.date_format=option(get('date_format'),'Date format',['language','system','DMY','MDY','YMD']);
      out.number_format=option(get('number_format'),'Number format',['language','system','comma_decimal','decimal_comma','quote_decimal','space_comma','none']);
      out.first_weekday=option(get('first_weekday'),'First weekday',['language','monday','tuesday','wednesday','thursday','friday','saturday','sunday']);break;
    case 'chart_settings': {
      const raw=get('selected'),selected=raw===undefined?[]:Array.isArray(raw)?raw:[raw];
      if(selected.some(key=>!CHART_CHOICES.some(([known])=>known===key))||new Set(selected).size!==selected.length)throw new Error('Choose supported charts');
      out.selected=[...selected];break;
    }
    case 'system_details':
      out.system_type = option(get('system_type'), 'System Type', SYSTEM_TYPES.map(([key]) => key));
      out.system_name = text(get('system_name'), 'System Name', 255, true);
      out.system_address = multilineText(get('system_address'), 'System Address');
      break;
    case 'indicator_settings': {
      const channel = indicatorChannel(ctx), source = indicatorSource(ctx), minimum = finiteSetting(source.brightness_min ?? source.brightness_range?.min), maximum = finiteSetting(source.brightness_max ?? source.brightness_range?.max);
      out.id = channel; out.channel = channel;
      out.enabled = typeof get('enabled') === 'boolean' ? get('enabled') : option(get('enabled'), 'LED state', ['enabled', 'disabled']) === 'enabled';
      out.mode = option(get('mode'), 'Indicator mode', INDICATOR_MODES[channel].map(([key]) => key));
      out.brightness = numeric(get('brightness'), 'Brightness', -Number.MAX_VALUE, Number.MAX_VALUE, true);
      if (minimum !== null && maximum !== null && minimum > maximum) throw new Error('Brightness bounds are inconsistent');
      if (out.brightness !== null && (minimum !== null && out.brightness < minimum || maximum !== null && out.brightness > maximum)) throw new Error('Brightness is outside the supplied range');
      break;
    }
    case 'display_settings': {
      const defaults = displayDefaults(ctx);
      out.main_display = option(get('main_display') ?? defaults.main_display, 'Main display', ['house', 'flow', 'photo']);
      out.appearance = option(get('appearance') === undefined ? defaults.appearance : get('appearance'), 'Appearance', HOMEPAGE_APPEARANCES);
      out.background_type = option(get('background_type') === undefined ? defaults.background_type : get('background_type'), 'Background', HOMEPAGE_BACKGROUNDS);
      const color = get('background_color') === undefined ? defaults.background_color : get('background_color');
      if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Background color must be a six-digit hex color such as #17444e');
      out.background_color = color.toLowerCase();
      const image = get('background_image') === undefined ? defaults.background_image : get('background_image');
      if (typeof image !== 'string' || image !== '' && !validatedBackgroundURL(image) || out.background_type === 'image' && !image) throw new Error('Use a local Home Assistant path or an HTTPS image URL');
      out.background_image = image;
      out.preset = option(get('preset') ?? 'custom', 'Layout', ['custom', 'classic', 'advanced']);
      const preset = out.preset === 'custom' ? defaults : DISPLAY_PRESETS[out.preset];
      const validateList = (list, full = false) => {
        if (!Array.isArray(list) || list.some(key => !DISPLAY_KEYS.includes(key)) || new Set(list).size !== list.length || full && list.length !== DISPLAY_KEYS.length) throw new Error('Display modules are invalid');
        return [...list];
      };
      const positioned = DISPLAY_KEYS.some(key => get(`order_${key}`) !== undefined);
      if (get('order') !== undefined) out.order = validateList(get('order'), true);
      else if (positioned) {
        const positions = DISPLAY_KEYS.map(key => [key, numeric(get(`order_${key}`), 'Module position', 1, DISPLAY_KEYS.length, false, true)]);
        if (new Set(positions.map(([, position]) => position)).size !== DISPLAY_KEYS.length) throw new Error('Each module position must appear once');
        out.order = positions.sort((a, b) => a[1] - b[1]).map(([key]) => key);
      } else out.order = [...preset.order];
      if (get('hidden') !== undefined) out.hidden = validateList(get('hidden'));
      else if (get('visible') !== undefined || positioned) {
        const visible = get('visible') === undefined ? [] : Array.isArray(get('visible')) ? get('visible') : [get('visible')];
        validateList(visible); out.hidden = DISPLAY_KEYS.filter(key => !visible.includes(key));
      } else out.hidden = [...preset.hidden];
      out.immersive_weather = bool(get('immersive_weather'));
      break;
    }
    case 'mode': out.mode = option(get('mode'), 'Operating mode', modeChoices(ctx).map(x => x[0]));out.local_only=!nativeModeChoices(ctx).length; break;
    case 'tariff_edit': {
      out.id = ctx.id === 'export' ? 'export' : 'import'; out.name = text(get('name'), 'Rate plan name');
      const currencyChoice = get('currency_choice');
      out.currency = text(currencyChoice === undefined ? get('currency') ?? tariffCurrency(prefs(ctx,'tariff_edit'),ctx) : currencyChoice === 'custom' ? get('currency') : option(currencyChoice, 'Currency', ['EUR', 'GBP', 'USD']), 'Currency', 3, true); if (!/^[A-Z]{3}$/.test(out.currency)) throw new Error('Currency must be a three-letter code');
      out.unit = option(get('unit') ?? tariffUnit(prefs(ctx,'tariff_edit')), 'Price unit', ['major', 'cent']); out.timezone = zone(get('timezone') ?? timeZone(ctx));
      out.base_price = numeric(get('base_price'), 'Base price', -1000000, 1000000); out.base_price_per_kwh = out.base_price / (out.unit === 'cent' ? 100 : 1); out.windows = [];
      const tariffType=get('tariff_type')===undefined?null:option(get('tariff_type'),'Rate type',['flat','tou']),periods=[];
      for (let i = 0; i < TARIFF_MAX_PERIODS && tariffType!=='flat'; i++) {
        const start = get(`window_${i}_start`), end = get(`window_${i}_end`), price = get(`window_${i}_price`);
        if ((start == null || start === '') && (end == null || end === '') && (price == null || price === '')) continue;
        periods.push({start,end,price,weekdays:get(`window_${i}_weekdays`)});
      }
      if(tariffType==='tou'&&!periods.length)throw new Error('Add at least one time period');
      out.windows=validateTariffPeriods(periods,out.unit);
      break;
    }
    case 'tariff_season': {
      const pricePlan = collectSettings('tariff_edit', f, ctx), direction = seasonDirection(ctx);
      if (get('direction') !== undefined && get('direction') !== direction) throw new Error('Season direction is invalid');
      Object.assign(out, pricePlan, { route, id: objectId(ctx), direction,
        name: text(get('name'), 'Season name', 80, true),
        start_month: numeric(get('start_month'), 'From month', 1, 12, false, true),
        end_month: numeric(get('end_month'), 'Through month', 1, 12, false, true) });
      const selected = monthsInSeason(out.start_month, out.end_month);
      for (const [id, season] of seasonItems(ctx, direction)) if (id !== out.id && monthsInSeason(season.start_month, season.end_month).some(month => selected.includes(month))) throw new Error('Season month ranges overlap');
      break;
    }
    case 'strategy_control': out.enabled=bool(get('enabled'));break;
    case 'strategy':
      out.id = objectId(ctx); out.name = text(get('name'), 'Name', 80, true); out.weekdays = weekdays(get('weekdays')); Object.assign(out, windowTimes({ start: get('start'), end: get('end') }));
      out.condition = option(get('condition'), 'SOC condition', ['above', 'below', 'none']); out.soc = numeric(get('soc'), 'SOC threshold', 0, 100, out.condition === 'none'); out.action = option(get('action'), 'Action', STRATEGY_ACTIONS.map(([action])=>action)); out.priority = numeric(get('priority'), 'Priority', 0, 100, false, true); out.enabled = bool(get('enabled'));
      out.power_kw=numeric(get('power_kw'),'Battery power limit',.001,100,true);out.export_kw=numeric(get('export_kw'),'Solar export limit',.001,100,out.action!=='export'||!out.enabled);
      out.export_requested=['export','battery_export'].includes(out.action);
      if(out.export_requested)out.export_source=out.action==='battery_export'?'battery':'solar';
      if(out.action==='battery_export'&&out.enabled&&!strategyExportEligibility(ctx).allowed)throw new Error(strategyExportEligibility(ctx).reason);
      break;
    case 'priority': out.order = [1, 2, 3].map(n => option(get(`priority_${n}`), `Priority ${n}`, ['solar', 'evdc', 'grid'])); if (new Set(out.order).size !== 3) throw new Error('Each priority must appear once'); break;
    case 'surplus_pv_priority': {
      const choices = surplusChoices(ctx).map(([key]) => key);
      if (!choices.length) throw new Error('No energy destinations are mapped');
      requireCharger(ctx); out.id = String(chargerId(ctx));
      out.order = choices.map((_, index) => option(get(`priority_${index + 1}`), `Destination ${index + 1}`, choices));
      if (new Set(out.order).size !== choices.length) throw new Error('Each destination must appear once');
      break;
    }
    case 'charging_mode':
      requireCharger(ctx); out.id = String(chargerId(ctx)); out.mode = option(get('mode'), 'Charging Mode', chargerModes(isDC(ctx)).map(x => x[0])); out.battery_boost = bool(get('battery_boost')); out.grid_charging = bool(get('grid_charging')); out.cutoff_soc = numeric(get('cutoff_soc'), 'Cut-off SOC', 0, 100, true, true);
      if (isDC(ctx)) { out.discharge_power_kw = numeric(get('discharge_power_kw'), 'Car Discharging Power', .001, 10000, true); out.stop_discharging_soc = numeric(get('stop_discharging_soc'), 'Stop Discharging', 20, 99, true, true); } break;
    case 'charger_schedule': {
      const identity = chargerScheduleIdentity(ctx); if (!identity) throw new Error('Selected charger is unavailable');
      requireCharger(identity.context);
      if (identity.composite && identity.scheduleId === 'new') throw new Error('Allocate a unique schedule draft before saving');
      out.id = identity.id;
      if (identity.composite) { out.charger_id = identity.chargerId; out.schedule_id = identity.scheduleId; }
      out.name = text(get('name'), 'Name', 80, true); out.weekdays = weekdays(get('weekdays')); Object.assign(out, windowTimes({ start: get('start'), end: get('end') })); out.mode = option(get('mode'), 'Charging Mode', chargerModes(isDC(identity.context)).map(x => x[0])); out.enabled = bool(get('enabled'));
      break;
    }
    case 'vehicle': out.id = objectId(ctx); out.brand = text(get('brand'), 'Brand', 40, true); out.model = text(get('model'), 'Model', 60, true); out.year = numeric(get('year'), 'Model year', 1900, 2100, false, true); out.capacity_kwh = numeric(get('capacity_kwh'), 'Battery capacity', .1, 1000); out.primary = bool(get('primary')); break;
    case 'device_settings': out.name = text(get('name'), 'Device Name', 60); break;
    case 'pv_capacity': out.capacity_wp = numeric(get('capacity_wp'), 'Total Panel Capacity', 1, 10000000, false, true); break;
    case 'pv_brand': out.brand = text(get('brand'), 'Brand', 20, true); break;
    case 'pv_model': out.model = text(get('model'), 'Model', 20, true); break;
    case 'string_names': out.pv1 = text(get('pv1'), 'PV1', 20, true); out.pv2 = text(get('pv2'), 'PV2', 20, true); break;
    case 'safety': out.reserve_soc = numeric(get('reserve_soc'), 'Battery reserve', 0, 100, true, true); out.max_charge_kw = numeric(get('max_charge_kw'), 'Charging maximum', .001, 10000, true); out.max_discharge_kw = numeric(get('max_discharge_kw'), 'Discharging maximum', .001, 10000, true); out.export_requested = bool(get('export_requested')); break;
    case 'forecast_settings': {
      if(ctx.forecastConfiguration){
        const raw=get('sources'),sources=raw===undefined?[]:Array.isArray(raw)?raw:[raw],known=ctx.forecastConfiguration.sources??[];
        if(sources.length>32||new Set(sources).size!==sources.length||sources.some(id=>!known.some(source=>source.id===id)))throw new Error('Choose configured forecast sources');
        out.sources=sources;out.average=get('average')===true||get('average')==='on';out.primary_source=get('primary_source')||sources[0]||'';
        if(out.average&&sources.length>2)throw new Error('Choose at most two sources to average');
        if(sources.length&&!sources.includes(out.primary_source))throw new Error('Choose a main forecast from the selected sources');
        out.local_only=false;
      }else{
        out.provider=option(get('provider'),'Forecast provider',['none','forecast_solar','solcast','volcast','open_meteo_solar_forecast']);out.entity_id=identifier(get('entity_id'),'Forecast entity','sensor');
      }
      break;
    }
    case 'ai_settings': out.provider = option(get('provider'), 'AI provider', ['none', 'home_assistant', 'openai', 'anthropic', 'google']); out.agent_entity = identifier(get('agent_entity'), 'Conversation agent', 'conversation'); out.share_energy_data = bool(get('share_energy_data')); break;
    case 'ai': { const request = get('request'); if (typeof request !== 'string' || request.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(request)) throw new Error('Energy request is invalid'); out.request = request.trim(); break; }
    default: throw new Error('This page has no editable draft');
  }
  return out;
}

export const validateSettings = collectSettings;
