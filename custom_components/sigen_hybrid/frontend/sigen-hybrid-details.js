/* SPDX-License-Identifier: GPL-3.0-only
 * Pure device-detail views. Navigation, charts and data access belong to the host.
 */
import { renderChargerButtons } from './sigen-hybrid-overview.js?v=0.2.1';
import { renderDeviceGraphic } from './sigen-hybrid-devices.js?v=0.2.1';
export const escapeDetailHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const esc = escapeDetailHTML;
const absent = value => value === null || value === undefined || typeof value === 'string' && (!value.trim() || ['unknown', 'unavailable', 'none'].includes(value.toLowerCase()));
const text = value => absent(value) ? '—' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
const numeric = value => !['number', 'string'].includes(typeof value) || typeof value === 'string' && !value.trim() ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const ENTITY = /^(sensor|binary_sensor|weather)\.[a-z0-9_]+$/;

export function detailMeasurement(state, quantity = 'power') {
  if (!state || absent(state.state)) return null;
  const value = numeric(state.state);
  if (value === null) return null;
  if (quantity === 'soc' && (value < 0 || value > 100)) return null;
  if (quantity === 'energy' && value < 0) return null;
  const units = {
    power: { W: .001, kW: 1, MW: 1000 }, energy: { Wh: .001, kWh: 1, MWh: 1000 },
    soc: { '%': 1 }, voltage: { V: 1, mV: .001 }, current: { A: 1, mA: .001 },
    frequency: { Hz: 1 }, temperature: { '°C': 1, '℃': 1, C: 1 }, pv_capacity: { W: .001, kW: 1, kWp: 1 },
    reactive_power: { var: .001, Var: .001, kvar: 1, kVar: 1, Mvar: 1000, MVar: 1000 }, resistance: { 'Ω': .000001, 'kΩ': .001, 'MΩ': 1 },
  };
  if (quantity === 'number') return value;
  if (quantity === 'power_factor') {
    const unit = state.attributes?.unit_of_measurement, factor = unit === '%' ? .01 : unit === undefined || unit === null || unit === '' || unit === '1' ? 1 : null;
    return factor !== null && Math.abs(value * factor) <= 1 ? value * factor : null;
  }
  const factor = units[quantity]?.[state.attributes?.unit_of_measurement];
  return factor === undefined ? null : value * factor;
}

function state(ctx, key, item) {
  const mapped = item?.entities?.[key];
  if (item && !mapped) return null;
  try { return ctx.state?.(mapped ?? key) ?? null; } catch { return null; }
}
function entity(ctx, key, item) {
  const id = item?.entities?.[key] ?? ctx.entity?.(key) ?? ctx.entities?.[key] ?? (ENTITY.test(key) ? key : '');
  return typeof id === 'string' && ENTITY.test(id) && state(ctx, key, item) ? id : '';
}
function value(ctx, keys, quantity = 'power', item) {
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    const reading = state(ctx, key, item);
    if (reading) { const result = detailMeasurement(reading, quantity); if (result !== null) return result; continue; }
    const recorded = item?.realtime?.[key];
    if (recorded && typeof recorded === 'object') {
      const result = detailMeasurement({ state: recorded.value, attributes: { unit_of_measurement: recorded.unit } }, quantity);
      if (result !== null) return result;
    }
    if (!item) {
      try { const result = ctx.value?.(key, quantity); if (typeof result === 'number' && Number.isFinite(result) && (quantity !== 'energy' || result >= 0)) return result; } catch { /* An optional metric can be absent. */ }
    }
  }
  return null;
}
function fmt(number, unit = '', signed = true) {
  if (typeof number !== 'number' || !Number.isFinite(number) || ['Wh','kWh','MWh'].includes(unit) && number < 0) return '—';
  const magnitude = !signed && ['W','kW','MW'].includes(unit) ? Math.abs(number) : number;
  return `${magnitude.toLocaleString(undefined, { maximumFractionDigits: ['W','kW','MW','kVar','V','MΩ'].includes(unit) ? 3 : 2 })}${unit ? ` ${unit}` : ''}`;
}
function field(item, ...keys) {
  for (const key of keys) {
    const found = item?.[key] ?? item?.parameters?.[key];
    if (!absent(found) && ['string', 'number', 'boolean'].includes(typeof found)) return found;
  }
  return null;
}
function kind(item) {
  const raw = String(item?.type ?? item?.device_type ?? item?.deviceType ?? '').toLowerCase().replace(/[\s_-]/g, '');
  return ({ battery: 'battery_module', batterymodule: 'battery_module', ess: 'battery_module', aio: 'inverter', energycontroller: 'inverter', evac: 'ac', accharger: 'ac', evdc: 'dc', dccharger: 'dc', energygateway: 'gateway', pv: 'solar', pvarray: 'solar', solarpanel: 'solar', pvpanel: 'solar', pvstring: 'string', panel: 'optimizer', pvmodule: 'optimizer' })[raw] ?? raw;
}
const itemId = item => String(field(item, 'id', 'serial', 'serial_number', 'serialNumber') ?? '');
function withCloudModule(ctx, item) {
  if (kind(item) !== 'battery_module') return item;
  let cloud; try { cloud=ctx.state?.('cloud_status'); } catch { return item; }
  const serial=field(item,'serial','serial_number','serialNumber'),rows=cloud?.attributes?.battery_modules;
  if (!serial || !Array.isArray(rows)) return item;
  const matches=rows.filter(module=>module&&module.serial===serial);
  if (matches.length!==1) return item;
  const module=matches[0],merged={...item,parameters:{...item.parameters},realtime:{...item.realtime}};
  if (!absent(module.model)) merged.model=module.model;
  if (!absent(module.firmware)) merged.software_version=module.firmware;
  if (typeof module.rated_energy_kwh==='number' && module.rated_energy_kwh>0) merged.rated_energy_kwh=merged.parameters.rated_energy_kwh=module.rated_energy_kwh;
  if (cloud.state!=='connected' || module.available!==true) return merged;
  const keys={soc:'battery_soc',power_kw:'battery_power',voltage_v:'battery_pack_voltage',temperature_c:'battery_cell_temperature_average',cell_voltage_v:'battery_cell_voltage_average',total_discharge_kwh:'battery_discharge_lifetime'};
  const now=Number.isFinite(ctx.now)?ctx.now:Date.now();
  for (const [key,measurement] of Object.entries(module.measurements??{})) {
    if (!measurement || typeof measurement!=='object') continue;
    const clock=Date.parse(measurement.observed_at??measurement.retrieved_at??''),age=now-clock;
    if (!Number.isFinite(age)||age < -5000||age>1800000) continue;
    if (keys[key]) merged.realtime[keys[key]]={...measurement};
    else if (key==='heating'&&['On','Off'].includes(measurement.value)) merged.battery_heating=measurement.value;
  }
  return merged;
}
const inventory = ctx => Array.isArray(ctx.inventory) ? ctx.inventory.filter(item => item && typeof item === 'object').map(item=>withCloudModule(ctx,item)) : [];
function devices(ctx, type) { return inventory(ctx).filter(item => kind(item) === type); }
function selected(ctx, type) {
  const rows = devices(ctx, type);
  return (ctx.id ? rows.find(item => itemId(item) === String(ctx.id)) : rows[0]) ?? null;
}
function firstStateText(ctx, keys, item) {
  for (const key of keys) { const result = state(ctx, key, item)?.state; if (!absent(result)) return String(result).replaceAll('_', ' '); }
  return text(field(item, 'status', 'state'));
}
function status(label, tone = '') { return `<span class="detail-status ${tone}">${esc(label)}</span>`; }
function nav(route, label, id, className = '') {
  return `<button type="button" class="detail-link ${className}" data-detail="${esc(route)}"${absent(id) ? '' : ` data-id="${esc(id)}"`}><span>${esc(label)}</span><span aria-hidden="true">›</span></button>`;
}
function deviceSettings(item, label) { const id = itemId(item); return id ? nav('device_settings', label, id) : ''; }
function deviceTools(item) { const id = itemId(item); return id ? nav('network', 'Network', id) + nav('maintenance', 'Maintenance', id) : ''; }
function more(ctx, key, label, content, item, className = 'detail-metric') {
  const id = entity(ctx, key, item);
  return id ? `<button type="button" class="${className}" data-entity="${esc(id)}" aria-label="${esc(label)}">${content}</button>` : `<div class="${className}">${content}</div>`;
}
function metric(ctx, key, label, quantity, unit, item) {
  return more(ctx, key, label, `<small>${esc(label)}</small><strong>${esc(fmt(value(ctx, key, quantity, item), unit))}</strong>`, item);
}
function batteryPowerInfo(power) {
  // The normalized adapter convention is positive charge, negative discharge.
  // Display magnitudes with direction labels; leave the sensor value untouched.
  return power === null ? {label:'Battery power',status:'—',magnitude:null} : Math.abs(power)<.03 ? {label:'Standby power',status:'Standby',magnitude:Math.abs(power)} : {label:power>0?'Charging power':'Discharging power',status:power>0?'Charging':'Discharging',magnitude:Math.abs(power)};
}
function batteryPowerMetric(ctx, item, omitMissing = false) {
  const info = batteryPowerInfo(value(ctx, 'battery_power', 'power', item));
  return omitMissing && info.magnitude === null ? '' : more(ctx, 'battery_power', info.label, `<small>${esc(info.label)}</small><strong>${esc(fmt(info.magnitude,'kW'))}</strong>`, item);
}
function row(label, reading) { return `<tr><th scope="row">${esc(label)}</th><td>${esc(text(reading))}</td></tr>`; }
function optionalRow(label, reading) { return absent(reading) || reading==='—' ? '' : row(label,reading); }
function table(title, rows, open = false) { return `<details class="detail-table"${open ? ' open' : ''}><summary>${esc(title)}</summary><table><tbody>${rows.join('')}</tbody></table></details>`; }
function parameters(item, extra = [], ctx, covered = [], omitMissing = false) {
  const seen = new Set(['model', 'serial', 'serial_number', 'serialNumber', 'manufacturer', 'firmware', 'firmware_version', 'software_version', 'rated_energy_kwh', 'capacity_kwh', ...covered]);
  const fact = keys => ctx ? deviceFact(ctx,item,keys) : field(item,...keys);
  const makeRow = omitMissing ? optionalRow : row;
  const rows = [makeRow('Model', field(item, 'model', 'model_name', 'modelName')), makeRow('Serial number', field(item, 'serial', 'serial_number', 'serialNumber')), makeRow('Manufacturer', field(item, 'manufacturer')), makeRow('Firmware version', fact(['firmware', 'firmware_version'])), makeRow('Software version', fact(['software_version'])), ...extra].filter(Boolean);
  for (const [key, reading] of Object.entries(item?.parameters && typeof item.parameters === 'object' ? item.parameters : {})) if (!seen.has(key) && ['string', 'number', 'boolean'].includes(typeof reading)) { const supplied=makeRow(key.replaceAll('_', ' '),reading);if(supplied)rows.push(supplied); }
  return rows.length ? table('Parameters', rows) : '';
}
function safeImage(value) { return typeof value === 'string' && (value.startsWith('/') && !value.startsWith('//') || value.startsWith('https://')) && !/[\s<>"'\\]/.test(value) ? value : ''; }
function artwork(ctx, type, item) {
  const picture = safeImage(item?.image);
  if (picture) return `<img class="detail-device-image" src="${esc(picture)}" alt="${esc(field(item, 'name', 'model') ?? type)}">`;
  const art = ctx.config?.images?.[ctx.night ? 'night' : 'day'] ?? {};
  if (['solar','battery','battery_module','inverter','gateway','ac','dc'].includes(type)) return renderDeviceGraphic(type,{art,night:ctx.night});
  const source = safeImage(art[type === 'battery_module' ? 'battery' : type]);
  const crop = { battery: '476 553 127 268', battery_module: '476 553 127 268', gateway: '659 619 79 119', ac: ctx.night ? '55 482 53 88' : '50 489 42 84', dc: ctx.night ? '251 594 44 129' : '254 599 61 144' }[type];
  if (source && crop) return `<svg class="detail-device-image" viewBox="${crop}" role="img" aria-label="${esc(type.replaceAll('_', ' '))}"><image href="${esc(source)}" width="${type === 'dc' ? ctx.night ? 1125 : 1149 : 1170}" height="${type === 'dc' ? ctx.night ? 960 : 984 : type === 'ac' ? 1011 : 1013}"/></svg>`;
  return `<div class="detail-device-icon detail-icon-${esc(type)}" aria-hidden="true"><i></i><b></b><em></em></div>`;
}
function hero(ctx, type, item, title, stateLabel, metrics = '') {
  return `<section class="detail-hero">${artwork(ctx, type, item)}<div class="detail-hero-copy"><h3>${esc(title)}</h3>${absent(stateLabel)||stateLabel==='—'?'':status(stateLabel)}${field(item, 'model') ? `<p>${esc(field(item, 'model'))}</p>` : ''}</div></section>${metrics ? `<div class="detail-metrics">${metrics}</div>` : ''}`;
}
function inventoryTile(ctx, item) {
  const type = kind(item), id = itemId(item), label = text(field(item, 'name', 'model') ?? type.replaceAll('_', ' '));
  const body = `<span class="detail-inventory-icon">${artwork(ctx, type, item)}</span><span><strong>${esc(label)}</strong><small>${esc(field(item, 'model') ?? firstStateText(ctx, ['status'], item))}</small></span>`;
  return id ? `<button type="button" class="detail-inventory-tile" data-detail="${esc(type)}" data-id="${esc(id)}">${body}<span aria-hidden="true">›</span></button>` : `<div class="detail-inventory-tile">${body}</div>`;
}
function deviceLinks(ctx, types) { return types.flatMap(type => devices(ctx, type)).map(item => inventoryTile(ctx, item)).join(''); }
export function solarStringSeries(ctx = {}) {
  const aggregate = ctx.entities?.solar_power ?? ctx.entity?.('solar_power'), seen = new Set();
  return devices(ctx,'string').flatMap((item,index) => {
    const source = item.entities?.solar_power ?? item.entities?.power;
    if (typeof source!=='string' || !/^sensor\.[a-z0-9_]+$/.test(source) || source===aggregate || seen.has(source)) return [];
    seen.add(source);
    return [{id:itemId(item)||source,name:String(field(item,'name')??`PV${index+1}`),entity_id:source}];
  });
}
function phaseTable(ctx, prefix, item, label, bare = false) {
  const phases = ['l1', 'l2', 'l3'];
  const readings = phases.map(phase => ({ phase, voltage: value(ctx, [`${prefix}_${phase}_voltage`, `${prefix}_voltage_${phase}`], 'voltage', item), current: value(ctx, [`${prefix}_${phase}_current`, `${prefix}_current_${phase}`], 'current', item), power: value(ctx, [`${prefix}_${phase}_power`, `${prefix}_power_${phase}`], 'power', item), reactivePower: value(ctx, [`${prefix}_${phase}_reactive_power`, `${prefix}_reactive_power_${phase}`], 'reactive_power', item) })).filter(phase => [phase.voltage, phase.current, phase.power, phase.reactivePower].some(reading => reading !== null));
  if (!readings.length) return '';
  const reactive = readings.some(phase => phase.reactivePower !== null);
  const body = `<div class="detail-table-scroll"><table><thead><tr><th>Phase</th><th>Voltage</th><th>Current</th><th>Power</th>${reactive ? '<th>Reactive power</th>' : ''}</tr></thead><tbody>${readings.map(phase => `<tr><th scope="row">${phase.phase.toUpperCase()}</th><td>${esc(fmt(phase.voltage, 'V'))}</td><td>${esc(fmt(phase.current, 'A'))}</td><td>${esc(fmt(phase.power, 'kW', true))}</td>${reactive ? `<td>${esc(fmt(phase.reactivePower, 'kVar'))}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  return bare ? body : `<details class="detail-table" open><summary>${esc(label)}</summary>${body}</details>`;
}
function gatewaySide(ctx, prefix, item, label) {
  const ownItem = item ?? {}, aggregateGrid = prefix === 'grid' && !item?.entities && !item?.realtime && (item ? devices(ctx,'gateway').length===1 : !ctx.id), scope = aggregateGrid ? null : ownItem;
  const rows = [row('Voltage frequency',fmt(value(ctx,[`${prefix}_frequency`,`${prefix}_voltage_frequency`,`${prefix}_grid_frequency`],'frequency',scope),'Hz'))];
  if (prefix!=='inverter') rows.push(row(prefix==='grid'?'Total active power':'Active power',fmt(value(ctx,[`${prefix}_total_active_power`,`${prefix}_active_power`,`${prefix}_power`],'power',scope),'kW')),row(prefix==='grid'?'Total reactive power':'Reactive power',fmt(value(ctx,[`${prefix}_total_reactive_power`,`${prefix}_reactive_power`,`${prefix}_l1_reactive_power`],'reactive_power',scope),'kVar')),row(prefix==='grid'?'Grid side contactor status':'Generator side contactor status',scope?deviceFact(ctx,scope,[`${prefix}_contactor_status`,`${prefix}_contactor_state`]):firstStateText(ctx,[`${prefix}_contactor_status`,`${prefix}_contactor_state`])));
  if (prefix==='grid') {
    let phases = ['l1','l2','l3'].filter(phase=>[`${prefix}_${phase}_voltage`,`${prefix}_voltage_${phase}`,`${prefix}_${phase}_voltage_max_last_minute`,`${prefix}_${phase}_voltage_max_1m`,`${prefix}_${phase}_voltage_min_last_minute`,`${prefix}_${phase}_voltage_min_1m`].some(key=>value(ctx,key,'voltage',scope)!==null));
    if (!phases.length) phases=['l1'];
    for (const phase of phases) { const name={l1:'A',l2:'B',l3:'C'}[phase]; rows.push(row(`Maximum Phase ${name} voltage in the past minute`,fmt(value(ctx,[`grid_${phase}_voltage_max_last_minute`,`grid_${phase}_voltage_max_1m`],'voltage',scope),'V')),row(`Minimum Phase ${name} voltage in the past minute`,fmt(value(ctx,[`grid_${phase}_voltage_min_last_minute`,`grid_${phase}_voltage_min_1m`],'voltage',scope),'V'))); }
  }
  return `<details class="detail-table" open><summary>${esc(label)}</summary>${phaseTable(ctx,prefix,scope,label,true)}<table><tbody>${rows.join('')}</tbody></table></details>`;
}
function solarCapacity(ctx) {
  const measured = value(ctx, ['solar_capacity', 'pv_capacity'], 'pv_capacity');
  if (measured !== null && measured > 0) return measured;
  const item = devices(ctx, 'solar')[0], kwp = numeric(field(item, 'capacity_kwp')), wp = numeric(field(item, 'capacity_wp'));
  return kwp !== null && kwp > 0 ? kwp : wp !== null && wp > 0 ? wp / 1000 : null;
}
function lifetimeRow(ctx, label, keys, item) { return row(label, fmt(value(ctx, keys, 'energy', item), 'kWh')); }
function batteryHealthRows(ctx, item, omitMissing = false) {
  const cycles = value(ctx, ['battery_discharge_count', 'battery_discharge_cycles'], 'number', item);
  const makeRow = omitMissing ? optionalRow : row;
  return [makeRow('Battery heating', item ? deviceFact(ctx,item,['battery_heating','battery_heating_state']) : firstStateText(ctx,['battery_heating','battery_heating_state'])),
    makeRow('Maximum cell voltage', fmt(value(ctx, ['battery_cell_voltage_max', 'battery_max_cell_voltage'], 'voltage', item), 'V')),
    makeRow('Minimum cell voltage', fmt(value(ctx, ['battery_cell_voltage_min', 'battery_min_cell_voltage'], 'voltage', item), 'V')),
    makeRow('Discharge count', cycles !== null && Number.isInteger(cycles) && cycles >= 0 ? String(cycles) : null)].filter(Boolean);
}
const modules = ctx => { const rows = ctx.optimizers ?? ctx.config?.optimizers; return Array.isArray(rows) ? rows.filter(item => item && typeof item === 'object') : []; };
const moduleId = (item, index) => String(item.id ?? item.power ?? `module-${index + 1}`);
function moduleState(ctx, item, key) {
  if (typeof item[key] !== 'string' || !item[key]) return null;
  const reading = state(ctx, item[key]);
  if (!reading) return null;
  const observed = Date.parse(reading.attributes?.observed_at ?? reading.last_reported ?? reading.last_updated ?? '');
  const age = (Number.isFinite(ctx.now) ? ctx.now : Date.now()) - observed;
  return reading.attributes?.sample_data === true || Number.isFinite(age) && age >= -5000 && age <= 1800000 ? reading : null;
}
function moduleGrid(ctx, list = modules(ctx)) {
  if (!list.length) return '<div class="detail-empty">No panel monitoring configured</div>';
  const groups = new Map();
  for (const item of list) { const group = text(item.string ?? item.string_name ?? 'Panels'); if (!groups.has(group)) groups.set(group, []); groups.get(group).push(item); }
  return [...groups].map(([group, items]) => `<section class="detail-panel-string"><h4>${esc(group)} <small>${items.length} panels</small></h4><div class="detail-module-grid">${items.map(item => { const index = modules(ctx).indexOf(item), power = detailMeasurement(moduleState(ctx, item, 'power')); return `<button type="button" class="detail-module" data-detail="optimizer" data-id="${esc(moduleId(item, index))}" aria-label="${esc(item.name ?? `Panel ${index + 1}`)}"><span>${esc(item.name ?? index + 1)}</span><strong>${esc(fmt(power === null ? null : power * 1000, 'W'))}</strong></button>`; }).join('')}</div></section>`).join('');
}

function solar(ctx) {
  const strings = new Set(modules(ctx).map(item => item.string).filter(item => !absent(item)));
  const body = hero(ctx, 'solar', null, 'Solar', firstStateText(ctx, ['solar_status']), metric(ctx, 'solar_power', 'Solar power', 'power', 'kW') + metric(ctx, 'solar_today', 'Produced today', 'energy', 'kWh'))
    + `<div class="detail-links">${nav('strings', 'PV strings')}${modules(ctx).length ? nav('optimizer', `Panel monitoring · ${modules(ctx).length} panels`) : ''}</div>`
    + table('Real Time Info', [row('Solar power', fmt(value(ctx, 'solar_power'), 'kW')), row('Produced today', fmt(value(ctx, 'solar_today', 'energy'), 'kWh')), lifetimeRow(ctx, 'Total solar production', ['solar_lifetime', 'solar_energy_lifetime', 'total_pv_generation']), row('Installed array', fmt(solarCapacity(ctx), 'kWp')), row('Monitored strings', strings.size || null)], true)
    + `<section class="detail-basic-info"><h4>Basic Info</h4><div class="detail-device-list">${devices(ctx, 'inverter').map(item => itemId(item) ? nav('inverter', `Connected inverter · ${text(field(item, 'name', 'model') ?? 'Inverter')}`, itemId(item)) : inventoryTile(ctx, item)).join('')}</div><div class="detail-links">${nav('pv_capacity', 'Total Panel Capacity')}${nav('pv_brand', 'Panel Brand')}${nav('pv_model', 'Panel Model')}${nav('string_names', 'PV String Name')}</div></section>`;
  return { title: 'Solar', body };
}
function battery(ctx) {
  const power = value(ctx, 'battery_power'), info = batteryPowerInfo(power);
  const units = devices(ctx, 'battery_module');
  return { title: 'SigenStor', body: hero(ctx, 'battery', null, 'SigenStor', info.status, metric(ctx, 'battery_soc', 'State of charge', 'soc', '%') + batteryPowerMetric(ctx) + metric(ctx, 'battery_capacity', 'Battery capacity', 'energy', 'kWh'))
    + `<div class="detail-device-stack">${deviceLinks(ctx, ['inverter', 'battery_module', 'dc'])}</div>`
    + `<div class="detail-links">${nav('battery_energy', 'Battery energy')}${nav('device_settings', 'Battery settings', ctx.id)}</div>`
    + table('Real Time Info', [row('Battery state of charge', fmt(value(ctx, 'battery_soc', 'soc'), '%')), row(info.label, fmt(info.magnitude, 'kW')), row('Battery state of health', fmt(value(ctx, 'battery_soh', 'soc'), '%')), row('Battery temperature', fmt(value(ctx, 'battery_temperature', 'temperature'), '°C')), row('Battery modules', units.length || null), ...batteryHealthRows(ctx), lifetimeRow(ctx, 'Total charged', ['battery_charge_lifetime', 'battery_energy_charge_lifetime', 'total_charged_energy_of_the_ess']), lifetimeRow(ctx, 'Total discharged', ['battery_discharge_lifetime', 'battery_energy_discharge_lifetime', 'total_discharged_energy_of_the_ess'])], true) };
}
function batteryModule(ctx) {
  const item = selected(ctx, 'battery_module') ?? {};
  const soc = value(ctx, 'battery_soc', 'soc', item), power = value(ctx, 'battery_power', 'power', item), temperature = value(ctx, 'battery_temperature', 'temperature', item), cellTemperature=value(ctx,'battery_cell_temperature_average','temperature',item);
  const info = batteryPowerInfo(power), suppliedStatus = firstStateText(ctx, ['battery_status', 'status'], item);
  const metrics = (soc === null ? '' : metric(ctx, 'battery_soc', 'State of charge', 'soc', '%', item)) + batteryPowerMetric(ctx, item, true) + (temperature !== null ? metric(ctx, 'battery_temperature', 'Temperature', 'temperature', '°C', item) : cellTemperature !== null ? metric(ctx,'battery_cell_temperature_average','Average cell temperature','temperature','°C',item) : '');
  const liveRows = [optionalRow('State of charge', fmt(soc, '%')), optionalRow(info.label, fmt(info.magnitude, 'kW')), optionalRow('State of health', fmt(value(ctx, 'battery_soh', 'soc', item), '%')), optionalRow('Battery pack voltage', fmt(value(ctx, ['battery_pack_voltage','battery_voltage'], 'voltage', item), 'V')), optionalRow('Current', fmt(value(ctx, 'battery_current', 'current', item), 'A')), optionalRow('Temperature', fmt(temperature, '°C')), optionalRow('Average cell voltage',fmt(value(ctx,['battery_cell_voltage_average','battery_average_cell_voltage','average_cell_voltage'],'voltage',item),'V')), optionalRow('Average cell temperature',fmt(value(ctx,['battery_cell_temperature_average','battery_average_cell_temperature','average_cell_temperature'],'temperature',item),'°C')), ...batteryHealthRows(ctx, item, true), optionalRow('Total discharged',fmt(value(ctx, 'battery_discharge_lifetime', 'energy', item),'kWh'))].filter(Boolean);
  const energy = keys => { const amount = numeric(field(item, ...keys)); return amount !== null && amount > 0 ? amount : null; };
  const total = energy(['total_energy_kwh','rated_energy_kwh']), usable = energy(['usable_energy_kwh','usable_capacity_kwh']), capacity = energy(['capacity_kwh']);
  const energyRows = [optionalRow('Total energy capacity',fmt(total,'kWh')),optionalRow('Usable energy capacity',fmt(usable,'kWh')),total === null && usable === null ? optionalRow('Energy capacity',fmt(capacity,'kWh')) : ''].filter(Boolean);
  const headingStatus = suppliedStatus === '—' ? info.status : suppliedStatus;
  return { title: text(field(item, 'name', 'model') ?? 'Battery module'), subtitle: field(item, 'serial', 'serial_number', 'serialNumber'), body: hero(ctx, 'battery_module', item, text(field(item, 'name') ?? 'Battery module'), headingStatus, metrics)
    + (liveRows.length ? table('Real Time Info',liveRows,true) : '<p class="detail-empty">No current module readings</p>')
    + parameters(item, energyRows, ctx, ['total_energy_kwh','usable_energy_kwh','usable_capacity_kwh'], true)
    + `<div class="detail-links">${deviceSettings(item, 'Battery settings')}${deviceTools(item)}</div>` };
}
function inverter(ctx) {
  const item = selected(ctx, 'inverter');
  const rated = value(ctx,['inverter_rated_power','rated_power'],'power',item) ?? numeric(field(item,'rated_power_kw'));
  return { title: text(field(item, 'name') ?? 'Inverter'), subtitle: field(item, 'model'), body: hero(ctx, 'inverter', item, text(field(item, 'name') ?? 'Inverter'), firstStateText(ctx, ['inverter_status', 'status'], item), metric(ctx, 'inverter_power', 'Output power', 'power', 'kW', item) + metric(ctx, 'inverter_temperature', 'Temperature', 'temperature', '°C', item))
    + `<div class="detail-links">${nav('strings', 'PV strings', itemId(item))}${deviceSettings(item, 'Inverter settings')}${deviceTools(item)}</div>`
    + table('Real Time Info', [row('Inverter startup time',deviceFact(ctx,item,['inverter_startup_time','startup_time'])),row('Inverter shutdown time',deviceFact(ctx,item,['inverter_shutdown_time','shutdown_time'])),row('Output power', fmt(value(ctx, 'inverter_power', 'power', item), 'kW')),row('Reactive power',fmt(value(ctx,['inverter_reactive_power','reactive_power'],'reactive_power',item),'kVar')),row('Power factor',fmt(value(ctx,['inverter_power_factor','power_factor'],'power_factor',item))),row('Grid frequency',fmt(value(ctx,['inverter_grid_frequency','grid_frequency'],'frequency',item),'Hz')),row('PV power',fmt(value(ctx,['solar_power','inverter_pv_power','pv_power'],'power',item),'kW')),row('PV1 current',fmt(value(ctx,['pv1_current','inverter_pv1_current'],'current',item),'A')),row('PV1 voltage',fmt(value(ctx,['pv1_voltage','inverter_pv1_voltage'],'voltage',item),'V')),row('PV2 current',fmt(value(ctx,['pv2_current','inverter_pv2_current'],'current',item),'A')),row('PV2 voltage',fmt(value(ctx,['pv2_voltage','inverter_pv2_voltage'],'voltage',item),'V')),row('Temperature', fmt(value(ctx, 'inverter_temperature', 'temperature', item), '°C')),row('Insulation resistance',fmt(value(ctx,['inverter_insulation_resistance','insulation_resistance'],'resistance',item),'MΩ'))], true) + phaseTable(ctx, 'inverter', item, 'AC side') + parameters(item,[row('Rated power',fmt(rated!==null&&rated>0?rated:null,'kW')),row('Output mode',deviceFact(ctx,item,['output_mode']))],ctx,['rated_power_kw','output_mode']) };
}
function gateway(ctx) {
  const item = selected(ctx, 'gateway');
  return { title: text(field(item, 'name') ?? 'Energy Gateway'), body: hero(ctx, 'gateway', item, 'Energy Gateway', firstStateText(ctx, ['grid_status', 'gateway_status']), metric(ctx, 'grid_power', 'Grid power', 'power', 'kW') + metric(ctx, 'home_power', 'Load power', 'power', 'kW'))
    + `<div class="detail-links">${nav('grid', 'Grid')}${nav('load', 'Load')}${deviceSettings(item, 'Gateway settings')}${deviceTools(item)}</div>${ctx.controlPermission===true&&ctx.capabilities?.grid_switch?.available===true?nav('grid_connection','Grid connection'): '<button type="button" class="detail-charging-disabled" disabled aria-disabled="true">Go Off-Grid</button>'}`
    + gatewaySide(ctx,'grid',item,'Grid side info') + gatewaySide(ctx,'generator',item,'Generator side info') + gatewaySide(ctx,'inverter',item,'Inverter side info') + phaseTable(ctx, 'backup', item?.entities || item?.realtime ? item : null, 'Backup side') + phaseTable(ctx, 'load', item?.entities || item?.realtime ? item : null, 'Load side') + parameters(item,[row('Communication status',deviceFact(ctx,item??{},['communication_status','gateway_communication_status'])),row('MAC address',deviceFact(ctx,item??{},['mac_address','mac']))],ctx,['communication_status','gateway_communication_status','mac_address','mac']) };
}
function grid(ctx) {
  const power = value(ctx, 'grid_power'), direction = power === null ? '—' : Math.abs(power) < .03 ? 'Balanced' : power > 0 ? 'Importing' : 'Exporting';
  return { title: 'Grid', body: hero(ctx, 'grid', null, 'Grid', direction, metric(ctx, 'grid_power', 'Grid power', 'power', 'kW') + metric(ctx, 'grid_import_today', 'Imported today', 'energy', 'kWh') + metric(ctx, 'grid_export_today', 'Exported today', 'energy', 'kWh'))
    + `<div class="detail-links">${nav('gateway', 'Energy Gateway')}${nav('device_settings', 'Grid settings')}</div>` + phaseTable(ctx, 'grid', null, 'Grid side') + table('Real Time Info', [row('Grid and system status', firstStateText(ctx, ['grid_status'])), row('Grid frequency', fmt(value(ctx, 'grid_frequency', 'frequency'), 'Hz')), lifetimeRow(ctx, 'Total imported', ['grid_import_lifetime', 'grid_energy_import_lifetime', 'total_imported_energy']), lifetimeRow(ctx, 'Total exported', ['grid_export_lifetime', 'grid_energy_export_lifetime', 'total_exported_energy'])], true) };
}
function load(ctx) {
  return { title: 'Load', body: hero(ctx, 'load', null, 'Home consumption', firstStateText(ctx, ['load_status']), metric(ctx, 'home_power', 'Load power', 'power', 'kW') + metric(ctx, 'home_today', 'Consumed today', 'energy', 'kWh'))
    + `<div class="detail-links">${nav('gateway', 'Energy Gateway')}</div>` + phaseTable(ctx, 'load', null, 'Load side') + table('Real Time Info', [row('Load power', fmt(value(ctx, 'home_power'), 'kW')), row('Consumed today', fmt(value(ctx, 'home_today', 'energy'), 'kWh')), lifetimeRow(ctx, 'Total consumption', ['home_lifetime', 'load_energy_lifetime', 'total_load_consumption'])], true) };
}
function charger(ctx, type) {
  const item = selected(ctx, type), title = type === 'ac' ? 'AC charger' : 'DC charger', id = itemId(item) || type;
  const scope = item?.entities || item?.realtime || devices(ctx, type).length > 1 ? item : null;
  return { title: text(field(item, 'name') ?? title), body: hero(ctx, type, item, title, firstStateText(ctx, [`${type}_state`, `${type}_status`, 'status'], scope), metric(ctx, `${type}_power`, 'Charging power', 'power', 'kW', scope) + metric(ctx, `${type}_session_energy`, 'Session energy', 'energy', 'kWh', scope))
    + `<div class="detail-charger-actions">${renderChargerButtons(ctx,type,id)}${nav('charging_mode', 'Charging mode', id, 'detail-primary-link')}</div>`
    + `<div class="detail-links">${nav('charger_schedules', 'Charging schedule', id)}${nav('charger_records', 'Charging records', id)}${nav('vehicles', 'Vehicles', id)}${deviceSettings(item, 'Charger settings')}${itemId(item)?nav(`${type}_more`,'More',itemId(item)):''}${deviceTools(item)}</div>`
    + table('Real Time Info', [row('Status', firstStateText(ctx, [`${type}_state`, `${type}_status`], scope)), row('Charging power', fmt(value(ctx, `${type}_power`, 'power', scope), 'kW')), row('Session energy', fmt(value(ctx, `${type}_session_energy`, 'energy', scope), 'kWh')), row('Voltage', fmt(value(ctx, `${type}_voltage`, 'voltage', scope), 'V')), row('Current', fmt(value(ctx, `${type}_current`, 'current', scope), 'A')), row('Vehicle state of charge', fmt(value(ctx, `${type}_vehicle_soc`, 'soc', scope), '%')), lifetimeRow(ctx, 'Total charged', [`${type}_energy_lifetime`, `${type}_charge_lifetime`, `${type}_total_energy_consumed`], scope), ...(type === 'dc' ? [row('Battery pack voltage',fmt(value(ctx,['dc_pack_voltage','dc_battery_pack_voltage'],'voltage',scope),'V')),row('Charging current',fmt(value(ctx,['dc_charging_current','dc_current'],'current',scope),'A')),row('Discharge output current',fmt(value(ctx,['dc_discharge_output_current','dc_discharge_current'],'current',scope),'A')),lifetimeRow(ctx, 'Total discharged', ['dc_discharge_lifetime', 'dc_energy_discharge_lifetime'], scope)] : [])], true) + phaseTable(ctx, type, scope, 'Charging phases') + parameters(item,[],ctx) };
}
function optimizer(ctx) {
  const list = modules(ctx), index = list.findIndex((item, i) => moduleId(item, i) === String(ctx.id)), item = index >= 0 ? list[index] : null;
  if (!item) return { title: 'Panel monitoring', body: moduleGrid(ctx) };
  const power = detailMeasurement(moduleState(ctx, item, 'power'));
  const fields = [['Power', 'power', 'power', 'W'], ['Energy', 'energy', 'energy', 'kWh'], ['Voltage', 'voltage', 'voltage', 'V'], ['Current', 'current', 'current', 'A']];
  return { title: text(item.name ?? `Panel ${index + 1}`), subtitle: text(item.string), body: hero(ctx, 'optimizer', item, text(item.name ?? `Panel ${index + 1}`), firstStateText(ctx, [item.status ?? 'optimizer_status']), `<div class="detail-metric"><small>Power</small><strong>${esc(fmt(power === null ? null : power * 1000, 'W'))}</strong></div>`)
    + table('Real Time Info', fields.map(([label, key, quantity, unit]) => { let reading = detailMeasurement(moduleState(ctx, item, key), quantity); if (key === 'power' && reading !== null) reading *= 1000; return row(label, fmt(reading, unit)); }), true) + parameters(item, [row('String', item.string), row('Panel', item.name)],ctx) + `<div class="detail-links">${nav('strings', 'PV strings')}${entity(ctx, item.power ?? '') ? more(ctx, item.power, 'Panel entity', '<span>Home Assistant entity</span>', null, 'detail-link') : ''}</div>` };
}
function strings(ctx) {
  const rows = devices(ctx, 'string'), body = rows.map(item => `<section class="detail-string-info">${table(text(field(item, 'name') ?? 'PV string'), [row('Power', fmt(value(ctx, 'solar_power', 'power', item), 'kW')), row('Voltage', fmt(value(ctx, 'voltage', 'voltage', item), 'V')), row('Current', fmt(value(ctx, 'current', 'current', item), 'A')), lifetimeRow(ctx, 'Produced today', ['energy_today'], item), lifetimeRow(ctx, 'Total production', ['energy_lifetime'], item)], true)}</section>`).join('');
  return { title: 'PV strings & panels', body: body + moduleGrid(ctx) };
}
function deviceList(ctx) {
  const rows = inventory(ctx).filter(item => ['inverter', 'battery_module', 'gateway', 'ac', 'dc'].includes(kind(item)));
  const hasSolar = devices(ctx,'solar').length>0 || typeof ctx.entities?.solar_power==='string' || Boolean(state(ctx,'solar_power'));
  const fallback = [['battery_soc', 'battery', 'SigenStor'], ['grid_power', 'grid', 'Grid'], ['ac_power', 'ac', 'AC charger'], ['dc_power', 'dc', 'DC charger']].filter(([key]) => state(ctx, key));
  const entries = (hasSolar?nav('solar','Solar'):'') + (rows.length ? rows.map(item => inventoryTile(ctx, item)).join('') : fallback.map(([, route, label]) => nav(route, label)).join(''));
  return { title: 'Devices', body: `<div class="detail-device-list">${entries || '<div class="detail-empty">Device information unavailable</div>'}${modules(ctx).length ? nav('strings', `PV panels · ${modules(ctx).length}`) : ''}</div><div class="detail-links">${nav('add_device', 'Add System Device')}${nav('network', 'Network')}${nav('maintenance', 'Maintenance')}</div>` };
}
function forecast(ctx) {
  const source = firstStateText(ctx, ['forecast_status']), provider = ({ forecast_solar: 'Forecast.Solar', 'forecast solar': 'Forecast.Solar', solcast: 'Solcast', volcast: 'Volcast' })[source] ?? source;
  const actual = value(ctx, 'solar_today', 'energy'), predicted = value(ctx, 'forecast_today', 'energy');
  return { title: 'Solar forecast', subtitle: provider, body: `<div class="detail-metrics">${metric(ctx, 'forecast_today', 'Today', 'energy', 'kWh')}${metric(ctx, 'forecast_tomorrow', 'Tomorrow', 'energy', 'kWh')}</div>`
    + table('Production comparison', [row('Forecast today', fmt(predicted, 'kWh')), row('Produced so far', fmt(actual, 'kWh'))], true) + `<div class="detail-links">${nav('solar', 'Solar production')}${nav('weather', 'Weather')}${nav('forecast_settings', 'Forecast settings')}</div>` };
}
function weather(ctx) {
  const key = ctx.config?.weather_entity ?? 'weather', reading = state(ctx, key), data = reading?.attributes ?? {};
  const label = absent(reading?.state) ? '—' : String(reading.state).replaceAll('_', ' ');
  const weatherValue = (metric, unitKey, validUnits) => numeric(data[metric]) !== null && validUnits.includes(data[unitKey]) ? `${fmt(numeric(data[metric]), data[unitKey], true)}` : null;
  const temperature = weatherValue('temperature', 'temperature_unit', ['°C', '°F']);
  const symbol = ({ sunny: '☀', 'clear-night': '☾', partlycloudy: '⛅', cloudy: '☁', rainy: '☂', pouring: '☂', snowy: '❄', 'snowy-rainy': '❄', lightning: 'ϟ', 'lightning-rainy': 'ϟ', fog: '≋', windy: '≋', 'windy-variant': '≋' })[reading?.state] ?? '—';
  return { title: 'Weather', body: `<section class="detail-weather"><div class="detail-weather-symbol" data-weather-field="symbol" aria-hidden="true">${symbol}</div><h3 data-weather-field="condition">${esc(label)}</h3><strong data-weather-field="temperature">${esc(text(temperature))}</strong></section>`
    + table('Weather conditions', [row('Temperature', temperature), row('Humidity', numeric(data.humidity) === null ? null : fmt(numeric(data.humidity), '%')), row('Wind speed', weatherValue('wind_speed', 'wind_speed_unit', ['km/h', 'm/s', 'mph', 'kn'])), row('Pressure', weatherValue('pressure', 'pressure_unit', ['hPa', 'Pa', 'kPa', 'bar', 'inHg', 'mmHg'])), row('Visibility', weatherValue('visibility', 'visibility_unit', ['km', 'mi', 'm']))], true)
    + (entity(ctx, key) ? more(ctx, key, 'Weather entity', '<span>Weather details in Home Assistant</span>', null, 'detail-link') : '') };
}
function batteryEnergy(ctx) {
  const measured = value(ctx, ['battery_stored_energy', 'battery_energy_stored'], 'energy'), soc = value(ctx, 'battery_soc', 'soc'), capacity = value(ctx, 'battery_capacity', 'energy');
  const estimated = measured === null && soc !== null && soc >= 0 && soc <= 100 && capacity !== null && capacity > 0;
  const stored = measured !== null && measured >= 0 ? measured : estimated ? soc / 100 * capacity : null;
  return { title: 'Battery energy', body: `<div class="detail-metrics"><div class="detail-metric"><small>${estimated ? 'Estimated stored energy' : 'Stored energy'}</small><strong>${esc(fmt(stored, 'kWh'))}</strong></div>${metric(ctx, 'battery_charge_today', 'Charged today', 'energy', 'kWh')}${metric(ctx, 'battery_discharge_today', 'Discharged today', 'energy', 'kWh')}${metric(ctx, 'battery_capacity', 'Battery capacity', 'energy', 'kWh')}</div>`
    + table('Energy sources', [row('From Solar', fmt(value(ctx, 'battery_charge_from_solar', 'energy'), 'kWh')), row('From Grid', fmt(value(ctx, 'battery_charge_from_grid', 'energy'), 'kWh'))])
    + table('Lifetime energy', [lifetimeRow(ctx, 'Total charged', ['battery_charge_lifetime', 'battery_energy_charge_lifetime', 'total_charged_energy_of_the_ess']), lifetimeRow(ctx, 'Total discharged', ['battery_discharge_lifetime', 'battery_energy_discharge_lifetime', 'total_discharged_energy_of_the_ess'])]) + `<div class="detail-links">${nav('battery', 'SigenStor')}</div>` };
}
function providerSection(ctx) {
  const config = ctx.config ?? {}, info = config.plant ?? {};
  if (!absent(ctx.id) && !absent(info.id) && String(ctx.id) !== String(info.id)) return '';
  const candidates = [config.service_provider, info.service_provider, config.service?.provider, config.system_about?.service_provider, info.installer, config.system_about?.installer];
  for (const supplied of candidates) {
    if (supplied && typeof supplied === 'object' && supplied.available === false) return '';
    const provider = typeof supplied === 'string' ? { name: supplied } : supplied && typeof supplied === 'object' && !Array.isArray(supplied) ? supplied : null;
    if (!provider) continue;
    const contact = key => {
      const reading = typeof provider[key] === 'string' ? provider[key].trim() : '';
      return reading && !['unknown','unavailable','none','null'].includes(reading.toLowerCase()) ? reading : null;
    };
    const rows = [['Name',contact('name')],['Phone',contact('phone')],['Email',contact('email')],['Address',contact('address')]].filter(([,reading]) => reading !== null);
    if (rows.length) return `<section class="detail-provider">${table('Service provider',rows.map(([label,reading]) => row(label,reading)),true)}</section>`;
  }
  return '';
}
function plant(ctx) {
  const info = ctx.config?.plant ?? {}, title = text(info.name ?? ctx.config?.title ?? 'My plant');
  return { title, body: `<section class="detail-plant"><h3>${esc(title)}</h3>${status(firstStateText(ctx, ['grid_status']))}${status(firstStateText(ctx, ['cloud_mode', 'native_mode']))}</section><div class="detail-links">${nav('devices', 'Devices')}${nav('alerts', 'Alerts')}${nav('device_settings', 'Plant settings', 'plant')}${nav('network', 'Network')}${nav('maintenance', 'Maintenance')}${nav('add_device', 'Add System Device')}</div>` + table('Plant information', [row('Name', title), row('Location', info.location), row('Time zone', ctx.timezone), row('Commissioned', info.commissioned_at), row('Installed PV capacity', fmt(solarCapacity(ctx), 'kWp')), row('Battery capacity', fmt(value(ctx, 'battery_capacity', 'energy'), 'kWh'))], true) + providerSection(ctx) };
}
function alertSource(ctx, history = false) {
  const config = ctx.config ?? {}, supplied = history ? config.alert_history : config.alerts_active ?? config.alerts;
  if (Array.isArray(supplied) && config[history ? 'alert_history_available' : 'alerts_active_available'] !== false) return {available:true,rows:supplied.filter(item => item && typeof item === 'object')};
  const legacy = history ? [] : inventory(ctx).flatMap(item => Array.isArray(item.alerts) ? item.alerts : []).filter(item => item && typeof item === 'object');
  return {available:false,rows:legacy};
}
const alertId = (item,index,history) => `${history?'history':'active'}:${encodeURIComponent(String(field(item,'id')??index))}`;
function alertDate(raw, ctx) {
  if (dateLabel(raw,ctx) === '—') return '';
  if (raw.length === 10) return raw;
  try { return new Intl.DateTimeFormat('en-CA',{timeZone:ctx.timezone??'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.parse(raw)); } catch { return ''; }
}
export function filterDetailAlerts(rows, filters = {}, ctx = {}) {
  filters = filters && typeof filters === 'object' && !Array.isArray(filters) ? filters : {};
  const query = typeof filters.query === 'string' ? filters.query.trim().toLowerCase().slice(0,150) : '', selectedType = ['inverter','battery','charger'].includes(filters.type) ? filters.type : 'all';
  const from = typeof filters.from === 'string' ? filters.from : '', to = typeof filters.to === 'string' ? filters.to : '';
  if ((from && alertDate(from,ctx) !== from) || (to && alertDate(to,ctx) !== to) || from && to && from > to) return [];
  return (Array.isArray(rows) ? rows : []).filter(item => {
    if (!item || typeof item !== 'object') return false;
    const type = String(item.device_type??item.type??'').toLowerCase().replace(/[ _-]/g,''), normalized = ['battery','batterymodule'].includes(type)?'battery':['charger','ac','dc','accharger','dccharger','evac','evdc'].includes(type)?'charger':type;
    if (selectedType !== 'all' && normalized !== selectedType) return false;
    const searchable = ['code','alarm_code','system_id','device_serial','serial','device_sn','title','name','message'].map(key => field(item,key)).filter(item => item !== null).join(' ').toLowerCase();
    if (query && !searchable.includes(query)) return false;
    const date = alertDate(item.occurred_at??item.occurred??item.time,ctx);
    return (!from || date && date >= from) && (!to || date && date <= to);
  });
}
function alertTabs(history) {
  return `<div class="detail-tabs" role="tablist"><button type="button" role="tab" aria-selected="${!history}" data-detail="alerts">Active</button><button type="button" role="tab" aria-selected="${history}" data-detail="alert_history">History</button></div>`;
}
function alertToolbar(ctx) {
  const filters = ctx.alertFilters ?? {};
  return `<div class="detail-alert-toolbar"><label class="detail-alert-search"><span>Search alerts</span><input type="search" data-alert-filter="query" value="${esc(typeof filters.query==='string'?filters.query:'')}" maxlength="150" placeholder="Alarm Code / System ID / Device SN"></label><label><span>Device type</span><select data-alert-filter="type">${[['all','All'],['inverter','Inverter'],['battery','Battery'],['charger','Charger']].map(([key,label]) => `<option value="${key}"${filters.type===key||key==='all'&&!['inverter','battery','charger'].includes(filters.type)?' selected':''}>${label}</option>`).join('')}</select></label><details class="detail-alert-range"><summary>Date range</summary><div class="detail-alert-range-panel"><label><span>From</span><input type="date" data-alert-filter="from" value="${esc(filters.from??'')}"></label><label><span>To</span><input type="date" data-alert-filter="to" value="${esc(filters.to??'')}"></label></div></details></div>`;
}
function alertRecord(ctx, item) {
  if (!item) return '<div class="detail-empty">Alert details unavailable</div>';
  const source = typeof item.entity_id === 'string' && ENTITY.test(item.entity_id) && state(ctx,item.entity_id) ? more(ctx,item.entity_id,'View entity','<span>Home Assistant entity</span>',null,'detail-link') : '';
  return `<article class="detail-alert">${status(text(item.severity))}<h3>${esc(text(item.title??item.name??item.code??item.alarm_code))}</h3><p>${esc(text(item.message??item.reason))}</p>${table('Alert information',[row('Alarm code',item.code??item.alarm_code),row('System ID',item.system_id),row('Error device',item.error_device??item.device_name??item.device_type),row('Device SN',item.device_serial??item.device_sn??item.serial),row('Occurred',dateLabel(item.occurred_at??item.occurred??item.time,ctx)),row('Resolved',dateLabel(item.resolved_at??item.resolved,ctx)),row('Suggestion',item.suggestion)],true)}${source}</article>`;
}
function alertPage(ctx, history) {
  const source = alertSource(ctx,history), filtered = filterDetailAlerts(source.rows,ctx.alertFilters,ctx);
  const selected = history && ctx.id ? filtered.find(item => alertId(item,source.rows.indexOf(item),true)===String(ctx.id)) ?? filtered[0] : filtered[0];
  const list = filtered.map(item => { const index = source.rows.indexOf(item); return `<button type="button" class="detail-alert-list-row" data-detail="${history?'alert_history':'alert_detail'}" data-id="${esc(alertId(item,index,history))}"><span><strong>${esc(text(item.title??item.name??item.code??item.alarm_code))}</strong><small>${esc(text(item.error_device??item.device_name??item.device_type))}</small><small>${esc(text(item.message??item.reason))}</small></span><time>${esc(dateLabel(item.occurred_at??item.occurred??item.time,ctx))}</time></button>`; }).join('');
  const empty = !source.available && !source.rows.length ? 'Alert information unavailable' : !source.rows.length ? history?'No alert history':'No active alerts' : 'No matching alerts';
  return {title:history?'Alert History':'Alerts',body:alertTabs(history)+alertToolbar(ctx)+(filtered.length?history?`<div class="detail-alert-split"><div class="detail-alert-list">${list}</div><section class="detail-alert-selected">${alertRecord(ctx,selected)}</section></div>`:`<div class="detail-alert-list">${list}</div>`:`<div class="detail-empty">${empty}</div>`)};
}
function alertDetail(ctx) {
  const all = [false,true].flatMap(history => alertSource(ctx,history).rows.map((item,index) => ({item,id:alertId(item,index,history)})));
  return {title:'Alert Details',body:alertRecord(ctx,all.find(item => item.id===String(ctx.id))?.item)};
}
const alerts = ctx => alertPage(ctx,false);

function deviceFact(ctx, item, keys) {
  for (const key of keys) { const supplied = state(ctx, key, item)?.state; if (!absent(supplied) && ['string', 'number', 'boolean'].includes(typeof supplied)) return supplied; }
  return field(item, ...keys);
}
function documentURL(raw) {
  if (!safeImage(raw)) return '';
  if (raw.startsWith('/')) return raw;
  try { const url = new URL(raw); return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? raw : ''; } catch { return ''; }
}
function dateLabel(raw, ctx, dateOnly = false) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(raw)) return '—';
  const time = Date.parse(raw);
  if (!Number.isFinite(time) || new Date(`${raw.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== raw.slice(0, 10)) return '—';
  try { return new Intl.DateTimeFormat(undefined, {timeZone: raw.length === 10 ? 'UTC' : ctx.timezone ?? 'UTC', year:'numeric', month:'short', day:'numeric', ...(dateOnly || raw.length === 10 ? {} : {hour:'2-digit', minute:'2-digit'})}).format(time); } catch { return '—'; }
}
function systemAbout(ctx) {
  const info = ctx.config?.plant ?? {}, extra = ctx.config?.system_about ?? {};
  return {title:'System About', body:table('System information', [row('System name', info.name ?? ctx.config?.title), row('Installation address', info.location), row('Commissioning date', dateLabel(info.commissioned_at, ctx, true)), row('Time zone', ctx.timezone), row('Installed PV capacity', fmt(solarCapacity(ctx), 'kWp')), row('Battery capacity', fmt(value(ctx, 'battery_capacity', 'energy'), 'kWh')), row('System version', extra.version ?? info.version)], true)
    + `<div class="detail-links">${nav('plant','Plant information')}${nav('system_details','System Details')}${nav('devices', 'Devices')}${nav('software_update', 'Software Update')}${nav('warranty', 'Warranty')}${nav('care', 'SigenCare')}${nav('diagnosis', 'Diagnosis')}</div>`};
}
function softwareUpdate(ctx) {
  const rows = inventory(ctx).filter(item => ['inverter','battery_module','gateway','ac','dc'].includes(kind(item)));
  return {title:'Software Update', body:rows.length ? rows.map(item => `<section class="detail-software-device">${inventoryTile(ctx,item)}${table('Software information', [row('Installed firmware', deviceFact(ctx,item,['firmware','firmware_version','software_version'])), row('Update status', deviceFact(ctx,item,['update_status','firmware_update_status'])), row('Available version', deviceFact(ctx,item,['available_firmware','available_version']))], true)}</section>`).join('') : '<div class="detail-empty">Software information unavailable</div>'};
}
function warranty(ctx) {
  const rows = inventory(ctx).filter(item => ['inverter','battery_module','gateway','ac','dc'].includes(kind(item)));
  const devicesBody = rows.map(item => `<section class="detail-warranty-device">${inventoryTile(ctx,item)}${table('Warranty', [row('Model', field(item,'model')), row('Serial number', field(item,'serial','serial_number','serialNumber')), row('Warranty expires', dateLabel(deviceFact(ctx,item,['warranty_expires','warranty_expiry']),ctx,true))], true)}</section>`).join('');
  return {title:'Warranty', body:(devicesBody || '<div class="detail-empty">Warranty information unavailable</div>') + `<div class="detail-links">${nav('warranty_download','Download Warranty')}</div>`};
}
function warrantyDownload(ctx) {
  const item = ctx.id ? inventory(ctx).find(item => itemId(item) === String(ctx.id)) : null;
  const supplied = ctx.id ? item ? [field(item,'warranty_policy_url','warranty_url')] : [] : [ctx.config?.warranty_policy_url,ctx.config?.plant?.warranty_policy_url,...inventory(ctx).map(item => field(item,'warranty_policy_url','warranty_url'))];
  const urls = [...new Set(supplied.map(documentURL).filter(Boolean))];
  return {title:'Download Warranty', body:urls.length ? `<div class="detail-links">${urls.map((url,index) => `<a class="detail-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><span>${urls.length > 1 ? `Warranty document ${index+1}` : 'Open warranty document'}</span></a>`).join('')}</div>` : '<div class="detail-empty">Warranty document unavailable</div>'};
}
function care(ctx) {
  const cost = state(ctx,'net_cost_today') ?? state(ctx,'energy_net_cost_today'), money = numeric(cost?.state), unit = cost?.attributes?.unit_of_measurement;
  const netCost = money !== null && typeof unit === 'string' && /^(?:[A-Z]{3}|€|£|\$)$/.test(unit) ? fmt(money,unit,true) : null;
  const sections = [
    ['Network Reliability','network',ctx.config?.cloud_paused === true ? 'Paused' : firstStateText(ctx,['cloud_status'])],
    ['Revenue Performance','energy_value',netCost],
    ['Equipment Reliability','alerts',firstStateText(ctx,['grid_status'])],
    ['Environmental Reliability','weather',firstStateText(ctx,[ctx.config?.weather_entity??'weather'])],
    ['Battery Health','battery',fmt(value(ctx,'battery_soh','soc'),'%')],
    ['Capacity Assessment','battery_energy',fmt(value(ctx,'battery_capacity','energy'),'kWh')],
  ];
  return {title:'SigenCare', body:`<div class="detail-care-grid">${sections.map(([label,route,reading]) => `<section class="detail-care-category"><h3>${esc(label)}</h3><strong>${esc(text(reading))}</strong>${nav(route,'View details')}</section>`).join('')}</div><button type="button" class="detail-charging-disabled" disabled aria-disabled="true">Start test</button>`};
}
const DIAGNOSIS_CATEGORIES = [
  ['power_sensor_connection','Power Sensor Connection'],['gateway_connection','Gateway Connection'],['network','Network'],['battery_terminal_connection','Battery Terminal Connection'],['dc_side_cable_connection','DC-side Cable Connection'],['ac_side_environmental_status','AC-side Environmental Status'],['energy_storage_status','Energy Storage Status'],['dc_charger_connection_status','DC Charger Connection Status'],
];
const diagnosisRecords = ctx => (Array.isArray(ctx.config?.diagnosis_history) ? ctx.config.diagnosis_history : []).filter(item => item && typeof item === 'object');
const reportId = (item,index) => String(field(item,'id') ?? `history-${index}`);
function diagnosisSelection(ctx) {
  const raw = String(ctx.id ?? ''), match = /^(abnormal|alerts|full):(.*)$/.exec(raw);
  let id = match ? match[2] : raw;
  try { if (match) id = decodeURIComponent(id); } catch { return {mode:'abnormal',report:null,id:''}; }
  const reports = diagnosisRecords(ctx), current = ctx.config?.diagnosis && typeof ctx.config.diagnosis === 'object' && !Array.isArray(ctx.config.diagnosis) ? ctx.config.diagnosis : null;
  const report = id ? reports.find((item,index) => reportId(item,index) === id) ?? (current && field(current,'id') !== null && String(field(current,'id')) === id ? current : null) : current ?? reports[0] ?? null;
  return {mode:match?.[1] ?? 'abnormal',report,id:id || (report ? String(field(report,'id') ?? '') : '')};
}
function diagnosisFullReport(report) {
  const supplied = Array.isArray(report.categories) ? report.categories.filter(item => item && typeof item === 'object') : [];
  const key = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');
  return DIAGNOSIS_CATEGORIES.map(([category,label]) => {
    const item = supplied.find(item => key(item.key ?? item.label) === key(category));
    let readings = (Array.isArray(item?.rows) ? item.rows : []).filter(item => item && typeof item === 'object');
    if (category==='network') readings = ['Ethernet','WLAN','Cellular'].map(label => readings.find(item => key(item.label)===key(label)) ?? {label}).concat(readings.filter(item => !['ethernet','wlan','cellular'].includes(key(item.label))));
    return table(label,[row('Status',item?.status),...readings.map(reading => row(reading.label,absent(reading.status ?? reading.value) ? null : `${text(reading.status ?? reading.value)}${reading.currently_used === true ? ' · Currently used' : ''}`))],true);
  }).join('');
}
function diagnosisIssues(report, mode) {
  const supplied = report[mode], rows = Array.isArray(supplied) ? supplied.filter(item => item && typeof item === 'object') : null;
  if (!rows) return '<div class="detail-empty">Report information unavailable</div>';
  if (!rows.length) return `<div class="detail-empty">${mode === 'abnormal' ? 'No recorded abnormalities' : 'No recorded alerts'}</div>`;
  return `<div class="detail-alerts">${rows.map(item => `<article class="detail-alert"><h4>${esc(text(item.title ?? item.name ?? item.code))}</h4><p>${esc(text(item.message ?? item.description))}</p>${item.status ? status(item.status) : ''}</article>`).join('')}</div>`;
}
function diagnosisDetail(ctx) {
  const {mode,report,id} = diagnosisSelection(ctx), tabs = [['abnormal','Abnormal'],['alerts','Alert'],['full','Full Report']];
  if (!report) return {title:'Diagnosis',body:'<div class="detail-empty">Diagnosis report unavailable</div>'+nav('diagnosis_history','Diagnosis History')};
  return {title:'Diagnosis',body:`<div class="detail-report-header"><time>${esc(dateLabel(report.saved_at ?? report.savedAt,ctx))}</time>${nav('diagnosis_history','Diagnosis History')}<button type="button" class="detail-charging-disabled" disabled aria-disabled="true">Check Again</button></div><div class="detail-tabs" role="tablist">${tabs.map(([key,label]) => `<button type="button" role="tab" aria-selected="${key===mode}" data-detail="diagnosis_detail" data-id="${esc(`${key}:${encodeURIComponent(id)}`)}">${label}</button>`).join('')}</div><section role="tabpanel">${mode==='full'?diagnosisFullReport(report):diagnosisIssues(report,mode)}</section>`};
}
function diagnosisHistory(ctx) {
  const supplied = ctx.config?.diagnosis_history, rows = diagnosisRecords(ctx);
  return {title:'Diagnosis History',body:Array.isArray(supplied) ? rows.length ? `<div class="detail-links">${rows.map((item,index) => nav('diagnosis_detail',dateLabel(item.saved_at ?? item.savedAt,ctx),`abnormal:${encodeURIComponent(reportId(item,index))}`)).join('')}</div>` : '<div class="detail-empty">No diagnosis reports</div>' : '<div class="detail-empty">Diagnosis history unavailable</div>'};
}
function modbusServer(ctx) {
  const supplied = ctx.config?.modbus_server ?? {}, reading = state(ctx,'modbus_server_enabled')?.state;
  const suppliedEnabled = absent(reading) ? supplied.enabled : reading, raw = typeof suppliedEnabled==='string' ? suppliedEnabled.trim().toLowerCase() : suppliedEnabled;
  const enabled = [true,1,'1','on','enabled','true'].includes(raw) ? true : [false,0,'0','off','disabled','false'].includes(raw) ? false : null;
  const ip = state(ctx,'modbus_ip_address')?.state ?? supplied.ip_address;
  return {title:'Modbus Server',body:`<section class="detail-modbus-server"><div class="detail-modbus-setting"><span>Enabled</span>${enabled === null ? '<strong>—</strong>' : `<input type="checkbox" role="switch" aria-label="Modbus server enabled" disabled${enabled?' checked':''}>`}</div>${table('Connection',[row('IP address',absent(ip)?null:ip)],true)}</section>`};
}
function supportHistory(ctx) {
  const supplied = ctx.config?.support_history ?? {}, parts = String(ctx.id??'issues:all').split(':'), workorders = parts[0]==='workorders';
  const filters = workorders ? ['all','processing','finished'] : ['all','processing','escalated','closed'], filter = filters.includes(parts[1]) ? parts[1] : 'all';
  const records = supplied[workorders?'workorders':'issues'], rows = Array.isArray(records) ? records.filter(item => item && typeof item === 'object' && (filter==='all'||String(item.status??'').toLowerCase()===filter)) : null;
  const portal = documentURL(supplied.portal_url ?? ctx.config?.support_portal_url);
  const tabs = `<div class="detail-tabs" role="tablist">${[['issues','Issue List'],['workorders','Workorder List']].map(([key,label]) => `<button type="button" role="tab" aria-selected="${workorders?key==='workorders':key==='issues'}" data-detail="support_history" data-id="${key}:all">${label}</button>`).join('')}</div>`;
  const choices = `<div class="detail-support-filters">${filters.map(key => `<button type="button" aria-pressed="${key===filter}" data-detail="support_history" data-id="${workorders?'workorders':'issues'}:${key}">${key[0].toUpperCase()+key.slice(1)}</button>`).join('')}</div>`;
  const list = rows === null ? '<div class="detail-empty">Support history unavailable</div>' : !rows.length ? `<div class="detail-empty">${workorders?'No workorders':'No issues'}</div>` : rows.map(item => `<article class="detail-alert"><h3>${esc(text(item.title??item.subject??item.id))}</h3>${status(text(item.status))}${table('Record',[row('Reference',item.id),row('Description',item.description??item.message),row('Created',dateLabel(item.created_at,ctx)),row('Updated',dateLabel(item.updated_at,ctx))],true)}${documentURL(item.url)?`<a class="detail-link" href="${esc(documentURL(item.url))}" target="_blank" rel="noopener noreferrer">Open support record</a>`:''}</article>`).join('');
  return {title:'History',body:tabs+choices+list+`<div class="detail-links">${portal?`<a class="detail-link" href="${esc(portal)}" target="_blank" rel="noopener noreferrer">Open Sigenergy support</a>`:''}<a class="detail-link" href="/config/logs">Home Assistant logs</a><a class="detail-link" href="/config/repairs">Home Assistant repairs</a></div>`};
}
function service(ctx) {
  const config = ctx.config?.service ?? {};
  const support = documentURL(config.support_url), community = documentURL(config.community_url ?? ctx.config?.community_url), source = alertSource(ctx);
  const brief = source.rows.slice(0,3).map((item,index) => nav('alert_detail',text(item.title??item.name??item.code??item.alarm_code),alertId(item,index,false))).join('');
  const alertsBody = brief || `<div class="detail-empty">${source.available?'No active alerts':'Alert information unavailable'}</div>`;
  return {title:'Service',body:nav('plant','Installer & plant information')+nav('software_update','Software update')+nav('warranty','Warranty')+nav('care','Care services')
    + `<div class="detail-service-shortcuts">${nav('diagnosis','Diagnosis')}${nav('messages','Message')}${support?`<a class="detail-link" href="${esc(support)}" target="_blank" rel="noopener noreferrer"><span>Support</span></a>`:nav('support_history','Support')}${community?`<a class="detail-link" href="${esc(community)}" target="_blank" rel="noopener noreferrer"><span>Community</span></a>`:'<button type="button" class="detail-charging-disabled" disabled aria-disabled="true">Community</button>'}</div>`
    + `<section class="detail-service-alerts"><div class="detail-service-heading"><h3>Active Alerts</h3>${nav('alerts','All')}</div>${alertsBody}</section>`};
}
const MESSAGE_CATEGORIES = [['all','All'],['system','System'],['after_sales','After-sales'],['update','Update'],['community','Community'],['events','Events']];
function messageSource(ctx) {
  const supplied = ctx.config?.messages, records = Array.isArray(supplied) ? supplied : supplied?.records;
  return Array.isArray(records) && supplied?.available !== false ? {available:true,records:records.filter(item => item && typeof item === 'object')} : {available:false,records:[]};
}
const messageId = (item,index) => `message:${encodeURIComponent(String(field(item,'id')??index))}`;
const messageCategory = item => String(field(item,'category','type')??'').trim().toLowerCase().replace(/[ -]+/g,'_');
function messages(ctx) {
  const source = messageSource(ctx), category = MESSAGE_CATEGORIES.some(([key])=>key===ctx.id) ? ctx.id : 'all';
  const rows = category==='all' ? source.records : source.records.filter(item => messageCategory(item)===category);
  const tabs = `<div class="detail-tabs detail-message-tabs" role="tablist">${MESSAGE_CATEGORIES.map(([key,label]) => `<button type="button" role="tab" aria-selected="${category===key}" data-detail="messages" data-id="${key}">${label}</button>`).join('')}</div>`;
  const list = rows.map(item => `<button type="button" class="detail-message-list-row" data-detail="message_detail" data-id="${esc(messageId(item,source.records.indexOf(item)))}"><span><strong>${esc(text(field(item,'title','subject','name')))}</strong><small>${esc(text(field(item,'summary','message','body','content')))}</small></span><span class="detail-message-meta"><time>${esc(dateLabel(field(item,'created_at','sent_at','time'),ctx))}</time>${item.unread===true||item.read===false?'<span class="detail-status">Unread</span>':''}</span></button>`).join('');
  return {title:'Message Centre',body:tabs+(list?`<div class="detail-message-list">${list}</div>`:`<div class="detail-empty">${!source.available?'Message information unavailable':!source.records.length?'No messages':'No messages in this category'}</div>`)};
}
function messageDetail(ctx) {
  const source = messageSource(ctx), item = source.records.find((item,index) => messageId(item,index)===String(ctx.id));
  if (!item) return {title:'Message',body:'<div class="detail-empty">Message unavailable</div>'+nav('messages','Message Centre')};
  const category = messageCategory(item), label = MESSAGE_CATEGORIES.find(([key])=>key===category)?.[1] ?? text(field(item,'category','type')), url = documentURL(field(item,'url'));
  return {title:text(field(item,'title','subject','name')??'Message'),body:`<article class="detail-message"><div class="detail-message-meta">${status(label)}<time>${esc(dateLabel(field(item,'created_at','sent_at','time'),ctx))}</time></div><h3>${esc(text(field(item,'title','subject','name')))}</h3><p>${esc(text(field(item,'body','content','message','summary')))}</p>${url?`<a class="detail-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open provided link</a>`:''}</article>${nav('messages','Message Centre',category)}`};
}

export function renderDeviceDetail(route, ctx = {}) {
  const routes = { solar, load, battery, battery_module: batteryModule, inverter, gateway, grid, ac: context => charger(context, 'ac'), dc: context => charger(context, 'dc'), optimizer, strings, devices: deviceList, forecast, weather, battery_energy: batteryEnergy, plant, alerts, alert_history:context=>alertPage(context,true), alert_detail:alertDetail, system_about:systemAbout, software_update:softwareUpdate, warranty, warranty_download:warrantyDownload, care, sigen_care:care, diagnosis:diagnosisDetail, diagnosis_detail:diagnosisDetail, diagnosis_history:diagnosisHistory, modbus_server:modbusServer, support_history:supportHistory, service, messages, message_detail:messageDetail };
  const renderer = Object.hasOwn(routes, route) ? routes[route] : null;
  return renderer ? renderer(ctx) : { title: 'Details', body: '<div class="detail-empty">Details unavailable</div>' };
}

export const DETAIL_STYLE = `
.detail-service-shortcuts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:20px 0}.detail-service-shortcuts>.detail-link{margin:0;min-height:48px;box-sizing:border-box}.detail-service-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}.detail-service-heading>h3{font-size:18px}.detail-service-heading>.detail-link{width:auto;min-width:70px}.detail-message-tabs{overflow-x:auto}.detail-message-tabs>button{flex:1 0 auto;white-space:nowrap}.detail-message-list{display:grid;gap:12px}.detail-message-list-row{display:flex;align-items:start;justify-content:space-between;gap:20px;text-align:left;padding:20px;border:1px solid var(--line,#dce6ed);border-radius:18px;background:var(--surface,#fff);color:var(--ink,#1e2b43);font:inherit;cursor:pointer}.detail-message-list-row>span:first-child{display:grid;gap:10px;min-width:0}.detail-message-list-row strong{font-size:16px;overflow-wrap:anywhere}.detail-message-list-row small{font-size:13px;color:var(--muted,#657a99);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.detail-message-meta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;color:var(--muted,#657a99);font-size:12px}.detail-message-list-row>.detail-message-meta{flex:0 0 130px;justify-content:flex-end}.detail-message{padding:20px 0}.detail-message h3{font-size:22px}.detail-message p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65}@container(max-width:520px){.detail-service-shortcuts{grid-template-columns:repeat(2,minmax(0,1fr))}.detail-message-list-row{gap:12px;padding:16px}.detail-message-list-row>.detail-message-meta{flex-basis:95px}}
.detail-modbus-setting{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:22px;border:1px solid var(--line,#dce6ed);border-radius:18px}.detail-modbus-setting input{width:23px;height:23px;accent-color:#18bfc1}.detail-support-filters{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.detail-support-filters button{border:1px solid var(--line,#dce6ed);border-radius:14px;padding:10px 15px;background:var(--surface,#fff);color:inherit;font:inherit;cursor:pointer}.detail-support-filters button[aria-pressed=true]{background:#27c6c830;border-color:#18bfc155}
.detail-alert-toolbar{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin:18px 0}.detail-alert-toolbar label{display:grid;gap:7px;color:var(--muted,#657a99);font-size:13px}.detail-alert-search{flex:1;min-width:200px}.detail-alert-toolbar input,.detail-alert-toolbar select{min-height:44px;border:1px solid var(--line,#dce6ed);border-radius:12px;background:var(--surface,#fff);color:var(--ink,#1e2b43);font:inherit;padding:10px 12px;box-sizing:border-box;max-width:100%}.detail-alert-range{position:relative}.detail-alert-range>summary{cursor:pointer;padding:13px;border:1px solid var(--line,#dce6ed);border-radius:12px}.detail-alert-range-panel{position:absolute;right:0;top:calc(100% + 8px);display:grid;gap:12px;padding:16px;background:var(--surface,#fff);border:1px solid var(--line,#dce6ed);border-radius:14px;z-index:2;box-shadow:0 8px 25px #0002}.detail-alert-split{display:grid;grid-template-columns:minmax(210px,.85fr) minmax(0,1.3fr);gap:20px;align-items:start}.detail-alert-list{display:grid;gap:10px}.detail-alert-list-row{display:flex;align-items:start;justify-content:space-between;gap:16px;padding:17px;border:1px solid var(--line,#dce6ed);border-radius:16px;background:var(--surface,#fff);color:var(--ink,#1e2b43);text-align:left;font:inherit;cursor:pointer}.detail-alert-list-row>span{display:grid;gap:8px;min-width:0}.detail-alert-list-row strong{font-size:15px}.detail-alert-list-row small,.detail-alert-list-row time{font-size:12px;color:var(--muted,#657a99);overflow-wrap:anywhere}.detail-alert-list-row time{flex:0 0 105px;text-align:right}.detail-alert-selected{min-width:0}.detail-alert-selected>.detail-alert{margin-top:0}@container(max-width:700px){.detail-alert-split{grid-template-columns:1fr}.detail-alert-toolbar{align-items:stretch}.detail-alert-search{flex-basis:100%}}
.detail-care-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:20px}.detail-care-category{padding:20px;border:1px solid var(--line,#dce6ed);border-radius:20px}.detail-care-category h3{font-size:17px;margin:0 0 12px}.detail-care-category>strong{display:block;font-size:25px}.detail-report-header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0 18px}.detail-report-header>time{margin-right:auto;color:var(--muted,#657a99)}.detail-tabs{display:flex;gap:6px;padding:5px;margin:18px 0;border-radius:16px;background:var(--surface,#f5f9fc)}.detail-tabs>button{flex:1;border:1px solid transparent;border-radius:12px;padding:12px;background:transparent;color:inherit;font:inherit;cursor:pointer}.detail-tabs>button[aria-selected=true]{border-color:#18bfc155;background:#27c6c830}.detail-software-device,.detail-warranty-device{margin:16px 0}.detail-link[href]{display:flex;align-items:center;justify-content:space-between;text-decoration:none}@container(max-width:520px){.detail-care-grid{grid-template-columns:1fr}}
.detail-basic-info{margin:22px 0}.detail-basic-info>h4{font-size:17px;margin:0 0 12px}.detail-charger-actions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:stretch;gap:12px;margin:15px 0}.detail-charger-actions .detail-link{margin:0}.detail-charging-disabled{border:1px solid var(--line,#dce6ed);border-radius:14px;padding:14px;color:var(--muted,#657a99);background:var(--surface,#f5f9fc);font:inherit;opacity:.6;cursor:not-allowed}.detail-primary-link{background:color-mix(in srgb,#17c5c8 16%,var(--surface,#f5f9fc))}
.detail-hero{display:flex;align-items:center;justify-content:center;gap:28px;min-height:180px;padding:22px 10px}.detail-hero-copy h3{font-size:22px;margin:0 0 12px}.detail-hero-copy p{color:var(--muted,#657a99);font-size:13px}.detail-status{display:inline-flex;border-radius:20px;background:color-mix(in srgb,#00c8c8 12%,transparent);color:var(--ink,#1e2b43);padding:6px 11px;font-size:12px;margin:3px 5px 3px 0}.detail-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:14px 0}.detail-metric{display:block;text-align:left;background:var(--surface,#f5f9fc);border:1px solid var(--line,#dce6ed);border-radius:16px;padding:15px;color:inherit;font:inherit;min-width:0}.detail-metric small{display:block;color:var(--muted,#657a99);font-size:12px}.detail-metric strong{display:block;font-size:23px;font-weight:600;margin-top:9px;font-variant-numeric:tabular-nums}.detail-links{display:grid;gap:8px;margin:16px 0}.detail-link{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:48px;border:1px solid var(--line,#dce6ed);border-radius:14px;background:var(--surface,#f5f9fc);padding:12px 16px;color:inherit;font:inherit;text-align:left}.detail-link>span:last-child[aria-hidden]{font-size:23px;color:var(--muted,#657a99)}button.detail-link,button.detail-metric,.detail-inventory-tile[data-detail],.detail-module{cursor:pointer}button.detail-link:hover,button.detail-metric:hover,.detail-inventory-tile[data-detail]:hover{border-color:#23c6ca}.detail-table{border:1px solid var(--line,#dce6ed);border-radius:17px;overflow:hidden;margin:12px 0;background:var(--surface,#f8fbfe)}.detail-table summary{cursor:pointer;padding:16px;font-weight:600;list-style-position:inside}.detail-table table{width:100%;border-collapse:collapse;font-size:13px}.detail-table th,.detail-table td{text-align:left;padding:12px 16px;border-top:1px solid var(--line,#e5edf3);font-weight:400;overflow-wrap:anywhere}.detail-table tbody th{color:var(--muted,#657a99);width:52%}.detail-table td{text-align:right;font-variant-numeric:tabular-nums}.detail-table thead th{font-size:11px;color:var(--muted,#657a99)}.detail-table-scroll{overflow-x:auto}.detail-device-stack,.detail-device-list{display:grid;gap:10px;margin:12px 0}.detail-inventory-tile{display:flex;align-items:center;gap:15px;border:1px solid var(--line,#dce6ed);background:var(--surface,#f5f9fc);border-radius:16px;padding:12px 16px;color:inherit;font:inherit;text-align:left}.detail-inventory-tile>span:last-child[aria-hidden]{margin-left:auto;font-size:24px}.detail-inventory-tile strong,.detail-inventory-tile small{display:block}.detail-inventory-tile small{font-size:11px;color:var(--muted,#657a99);margin-top:5px}.detail-device-image{height:150px;width:125px;object-fit:contain;flex-shrink:0}.detail-inventory-icon{width:48px;height:65px;display:flex;align-items:center;justify-content:center}.detail-inventory-icon .detail-device-image{width:42px;height:60px}.detail-device-icon{position:relative;flex-shrink:0;width:86px;height:135px;border:1px solid #d4dce2;border-radius:12px;background:linear-gradient(95deg,#f2f4f6,#fff 55%,#dbe2e8);box-shadow:7px 10px 16px #20384b19}.detail-device-icon i{position:absolute;top:18px;left:calc(50% - 4px);width:8px;height:8px;background:#00bfc5;border:2px solid #e6f5f5;border-radius:50%}.detail-device-icon b{position:absolute;bottom:10px;left:10px;right:10px;height:2px;background:#d0d8df}.detail-icon-battery,.detail-icon-battery_module{height:150px}.detail-icon-battery:after,.detail-icon-battery_module:after{content:'';position:absolute;left:0;right:0;top:50%;border-top:1px solid #cad2d9}.detail-icon-inverter{height:85px;width:96px;border-radius:10px}.detail-icon-gateway{height:110px;width:76px}.detail-icon-ac,.detail-icon-dc{height:140px;width:85px;border-radius:42px 42px 22px 22px;background:radial-gradient(circle at 50% 32%,#253d4f 0 22px,#eef5f9 23px,#fff 28px)}.detail-icon-ac i,.detail-icon-dc i{top:35px;left:37px;background:#09d0cd}.detail-icon-ac:after,.detail-icon-dc:after{content:'';position:absolute;right:-22px;top:52px;width:25px;height:80px;border:4px solid #516576;border-left:0;border-radius:0 20px 24px 0}.detail-icon-solar,.detail-icon-optimizer{width:110px;height:135px;border:4px solid #6b8ca2;border-radius:4px;background:repeating-linear-gradient(0deg,transparent 0,transparent 23%,#cce3f455 24%,transparent 25%),repeating-linear-gradient(90deg,#143d5b 0,#143d5b 24%,#cce3f455 25%,#143d5b 26%);transform:perspective(220px) rotateY(-12deg)}.detail-icon-solar i,.detail-icon-optimizer i{display:none}.detail-icon-load{height:100px;width:110px;border-radius:5px;margin-top:30px}.detail-icon-load:before{content:'';position:absolute;width:78px;height:78px;transform:rotate(45deg);background:#d8e6ee;left:15px;top:-36px;z-index:-1}.detail-icon-grid{width:75px;height:130px;background:transparent;border:5px solid #849caa;border-top-width:9px;border-bottom:0;border-radius:0;transform:perspective(180px) rotateX(10deg)}.detail-inventory-icon .detail-device-icon{transform:scale(.4);transform-origin:center;box-shadow:none}.detail-module-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:6px}.detail-panel-string h4{font-size:14px;margin:18px 0 10px}.detail-panel-string h4 small{font-weight:400;color:var(--muted,#657a99);margin-left:8px}.detail-module{aspect-ratio:2/3;min-width:0;border:1px solid #427492;border-radius:5px;display:flex;flex-direction:column;justify-content:space-between;align-items:center;padding:5px;color:#e6f6ff;background:repeating-linear-gradient(0deg,transparent 0,transparent 24%,#ffffff19 25%),repeating-linear-gradient(90deg,#10334e 0,#10334e 24%,#ffffff19 25%,#10334e 26%)}.detail-module span{font-size:9px;max-width:100%;overflow:hidden;text-overflow:ellipsis}.detail-module strong{font-size:clamp(9px,1.4cqi,13px);white-space:nowrap}.detail-empty{padding:32px 18px;text-align:center;color:var(--muted,#657a99);font-size:13px}.detail-weather{text-align:center;padding:18px}.detail-weather-symbol{font-size:70px;color:#8aa9c0;line-height:1.2}.detail-weather h3{font-size:17px;text-transform:capitalize}.detail-weather>strong{font-size:34px}.detail-plant{padding:15px 4px}.detail-plant h3{font-size:23px;margin:0 0 15px}.detail-alert{border:1px solid var(--line,#dce6ed);border-radius:15px;padding:16px;margin:10px 0}.detail-alert h4{margin:12px 0 6px}.detail-alert p,.detail-alert time{font-size:12px;color:var(--muted,#657a99)}.detail-device-stack button:focus-visible,.detail-link:focus-visible,.detail-module:focus-visible,.detail-metric:focus-visible{outline:3px solid #00bcc7;outline-offset:3px}@container(max-width:520px){.detail-hero{gap:18px;padding:20px 5px}.detail-device-image{width:95px;height:130px}.detail-hero-copy h3{font-size:20px}.detail-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.detail-metric{padding:12px}.detail-metric strong{font-size:21px}.detail-module-grid{grid-template-columns:repeat(6,minmax(0,1fr))}.detail-table th,.detail-table td{padding:11px 12px}}
`;
