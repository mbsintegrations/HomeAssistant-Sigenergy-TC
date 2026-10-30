/* SPDX-License-Identifier: GPL-3.0-only
 * Pure compact overview panels. The host supplies normalized readings and
 * handles detail navigation; these renderers never access a provider or HA.
 */
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const MISSING = new Set(['', 'unknown', 'unavailable', 'none']);
/** A readable, scene-independent power summary for narrow dashboards. */
export function renderMobilePower(ctx = {}) {
  const definitions=[['solar_power','Solar','solar'],['home_power','Home','load'],['battery_power','Battery','battery'],['grid_power','Grid','grid'],['ac_power','AC charger','ac'],['dc_power','DC charger','dc']];
  return `<div class="mobile-power-grid" aria-label="Live power readings">${definitions.filter(([key])=>ctx.entities?.[key]||ctx.has?.(key)).map(([key,label,route])=>{
    let value=null;try{const reading=ctx.value?.(key,'power');if(typeof reading==='number'&&Number.isFinite(reading))value=reading;}catch{}
    const formatted=value===null?'—':`${Math.abs(value).toLocaleString(ctx.haLocale?.language,{maximumFractionDigits:2})} kW`;
    let detail='';
    if(value!==null&&key==='battery_power'){const soc=ctx.value?.('battery_soc','soc');detail=[typeof soc==='number'&&Number.isFinite(soc)?`${soc.toLocaleString(undefined,{maximumFractionDigits:1})}%`:'',Math.abs(value)<.05?'Idle':value>0?'Charging':'Discharging'].filter(Boolean).join(' · ');}
    if(value!==null&&key==='grid_power')detail=Math.abs(value)<.05?'Idle':value>0?'Importing':'Exporting';
    return `<button type="button" data-detail="${route}" aria-label="${esc(`${label}: ${formatted}${detail?', '+detail:''}. Open details`)}"><span>${label}</span><strong>${esc(formatted)}</strong>${detail?`<small>${esc(detail)}</small>`:''}</button>`;
  }).join('')}</div>`;
}
function reading(ctx, key, quantity = 'energy') {
  try {
    const state = ctx.state?.(key);
    if (state && (MISSING.has(String(state.state ?? '').trim().toLowerCase()) || state.attributes?.available === false)) return null;
    if (state && !(quantity === 'soc' ? ['%'] : ['Wh', 'kWh', 'MWh']).includes(state.attributes?.unit_of_measurement)) return null;
    const value = ctx.value?.(key, quantity);
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && (quantity !== 'soc' || value <= 100) ? value : null;
  } catch { return null; }
}
function number(ctx, value, digits = 2, minimum = 0) {
  if (value === null) return '—';
  const options = { minimumFractionDigits: minimum, maximumFractionDigits: digits };
  try { return value.toLocaleString(ctx.locale?.language ?? ctx.haLocale?.language, options); } catch { return value.toLocaleString(undefined, options); }
}
const metric = (ctx, key, label, route, quantity = 'energy') => {
  const value = reading(ctx, key, quantity), unit = quantity === 'soc' ? '%' : 'kWh';
  const formatted = value === null ? '—' : quantity === 'soc' ? `${number(ctx, value, 1, 1)}%` : `${number(ctx, value)} kWh`;
  return `<button type="button" class="overview-energy-metric" data-detail="${route}" aria-label="${esc(`${label}: ${formatted}. Open details`)}"><small>${esc(label)}</small><strong>${esc(formatted)}</strong></button>`;
};

function chargerType(item) {
  const raw = String(item?.type ?? item?.device_type ?? item?.deviceType ?? '').toLowerCase().replace(/[\s_-]/g, '');
  return ({ac:'ac',evac:'ac',accharger:'ac',dc:'dc',evdc:'dc',dccharger:'dc'})[raw] ?? null;
}
function absentCapability(ctx, type) {
  const aliases = type === 'ac' ? ['ac','evac','ac_charger'] : ['dc','evdc','dc_charger'];
  return [ctx.capabilities,ctx.config?.capabilities].some(values => values && typeof values === 'object' && aliases.some(key => values[key] === false || values[key]?.available === false || values[key]?.installed === false));
}
function mapped(ctx, key) {
  try { return Boolean(ctx.entities?.[key]) || ctx.has?.(key) === true; } catch { return false; }
}
function itemIdentity(item) {
  for (const key of ['id','serial','serial_number','serialNumber']) {
    const value = item?.[key];
    if ((typeof value === 'string' && value.trim()) || typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}
/** Installed charger types determine the denominator: an unavailable reading
 * from either installed type prevents a misleading partial combined total. */
export function chargerEnergyModel(ctx = {}) {
  const supplied = Array.isArray(ctx.inventory) ? ctx.inventory : [], authoritative = supplied.length > 0;
  const inventory = supplied.filter(item => item && typeof item === 'object' && !Array.isArray(item));
  const items = [];
  for (const type of ['ac','dc']) {
    if (absentCapability(ctx, type)) continue;
    const devices = inventory.filter(item => chargerType(item) === type && item.installed !== false && item.capability !== false && item.capability?.available !== false && item.capabilities !== false && item.capabilities?.available !== false);
    const installed = authoritative ? devices.length > 0 : ['today','power','state','status'].some(suffix => mapped(ctx, `${type}_${suffix}`));
    if (!installed) continue;
    items.push({type,label:type === 'ac' ? 'AC charger' : 'DC charger',value:reading(ctx, `${type}_today`),id:devices.length === 1 ? itemIdentity(devices[0]) : ''});
  }
  const complete = items.length > 0 && items.every(item => item.value !== null);
  return {items,complete,total:complete ? items.reduce((sum,item) => sum + item.value,0) : null,label:items.length === 2 ? 'AC/DC charger' : items[0]?.label ?? ''};
}
/** Charger actions stay locked until a supported, owner-approved control path
 * exists. Inventory links never pick an arbitrary device of the same type. */
export function renderChargerButtons(ctx = {}, type, id = '') {
  const control=ctx.state?.('control_status')?.attributes??{},raw=control.owner_devices?.[`${type}SnList`],serials=Array.isArray(raw)?raw:[];
  const device=(ctx.inventory??[]).find(device=>itemIdentity(device)===id),own=[device?.serial,device?.serial_number,device?.serialNumber].find(serial=>serials.includes(serial));
  const serial=own??(serials.length===1?serials[0]:null),enabled=ctx.controlPermission===true&&ctx.capabilities?.[`${type}_charging`]?.available===true&&typeof serial==='string';
  const label=type==='ac'?'AC charger':'DC charger';
  return `<div class="control-buttons">${[['start','Start charging'],['stop','Stop charging']].map(([action,title])=>`<button type="button" data-charger-action="${action}" data-charger-type="${type}"${serial?` data-serial="${esc(serial)}"`:''}${enabled?'':' disabled aria-disabled="true"'} aria-label="${action==='start'?'Start':'Stop'} ${label} charging">${title}</button>`).join('')}</div>`;
}
export function renderChargerControls(ctx = {}, onlyType) {
  const items=chargerEnergyModel(ctx).items.filter(item=>!onlyType||item.type===onlyType);
  if (!items.length) return '';
  return `<div class="overview-charger-controls">${items.map(item => `<section class="overview-charger-control" data-charger-type="${item.type}" aria-label="${item.label} controls"><button type="button" class="overview-charger-heading" data-detail="${item.id ? item.type : 'devices'}"${item.id ? ` data-id="${esc(item.id)}"` : ''}>${item.label}<span aria-hidden="true">›</span></button>${renderChargerButtons(ctx,item.type,item.id)}</section>`).join('')}</div>`;
}
function chargingTile(ctx, model) {
  if (!model.items.length) return '';
  const formatted = model.total === null ? '—' : `${number(ctx, model.total)} kWh`;
  return `<button type="button" class="overview-energy-metric" data-detail="charging_energy" aria-label="${esc(`${model.label} charged today: ${formatted}. Open details`)}"><small>${esc(model.label)}</small><strong>${esc(formatted)}</strong></button>`;
}

export function renderChargingEnergy(ctx = {}) {
  const model = chargerEnergyModel(ctx), formatted = model.total === null ? '—' : `${number(ctx, model.total)} kWh`;
  const body = model.items.length ? `<div class="overview-charging-total"><small>Charged today</small><strong>${esc(formatted)}</strong></div><div class="overview-charging-breakdown">${model.items.map(item => `<section class="overview-charging-channel"><button type="button" class="overview-energy-metric" data-detail="${item.type}"${item.id ? ` data-id="${esc(item.id)}"` : ''} aria-label="${esc(`${item.label} charged today: ${item.value === null ? '—' : number(ctx,item.value)+' kWh'}. Open details`)}"><small>${esc(item.label)}</small><strong>${esc(item.value === null ? '—' : number(ctx,item.value)+' kWh')}</strong></button><sigen-history-chart data-chart="${item.type}"${item.id ? ` data-id="${esc(item.id)}"` : ''}></sigen-history-chart></section>`).join('')}</div>` : '<p class="detail-empty">No charger installed</p>';
  return {title:'Charging energy today',body:`<div class="overview-charging-detail">${body}</div>`};
}

export function renderTodayEnergy(ctx = {}) {
  const charging = chargerEnergyModel(ctx);
  return `<section class="panel overview-compact-panel overview-today-energy" aria-label="Today's energy"><h2>Today's energy</h2><div class="overview-energy-metrics${charging.items.length ? '' : ' overview-energy-five'}">${metric(ctx, 'solar_today', 'Solar produced', 'solar')}${metric(ctx, 'grid_import_today', 'Grid imported', 'grid')}${metric(ctx, 'grid_export_today', 'Grid exported', 'grid')}${metric(ctx, 'battery_charge_today', 'Battery charged', 'battery')}${metric(ctx, 'battery_discharge_today', 'Battery discharged', 'battery')}${chargingTile(ctx,charging)}</div></section>`;
}

export function renderBatteryLevel(ctx = {}) {
  const soc = reading(ctx, 'battery_soc', 'soc');
  const candidate = reading(ctx, 'battery_capacity'), capacity = candidate !== null && candidate > 0 ? candidate : null;
  const supplied = reading(ctx, 'battery_stored_energy') ?? reading(ctx, 'battery_energy_stored');
  const measured = supplied !== null && (capacity === null || supplied <= capacity) ? supplied : null;
  const estimate = measured === null && supplied === null && soc !== null && capacity !== null ? soc / 100 * capacity : null;
  const stored = measured ?? estimate, approximate = estimate !== null;
  const energyText = stored !== null && capacity !== null ? `${approximate ? '≈ ' : ''}${number(ctx, stored, 1)} of ${number(ctx, capacity, 1)} kWh` : stored !== null ? `${number(ctx, stored, 1)} kWh stored` : capacity !== null ? `${number(ctx, capacity, 1)} kWh capacity` : '—';
  const energyRing = (key, label, route, tone) => {
    const amount = reading(ctx, key), text = amount === null ? '—' : number(ctx, amount);
    return `<button type="button" class="overview-circle-button" data-detail="${route}" aria-label="${esc(`${label}: ${amount === null ? 'Unavailable' : text+' kWh'}. Open details`)}"><span class="overview-circle-label">${label}</span><span class="overview-summary-ring${amount === null ? ' is-unavailable' : ''}" style="--ring-tone:${tone};--ring-fill:${amount === null ? 0 : 100}%"><span class="overview-ring-centre"><strong>${esc(text)}</strong><small>kWh · Today</small></span></span></button>`;
  };
  return `<section class="panel overview-compact-panel overview-battery-level overview-circle-panel" aria-label="Energy and battery"><div class="overview-circle-grid">${energyRing('solar_today','PV production','production','#efc900')}${energyRing('home_today','Consumption','consumption','#a45bf0')}<button type="button" class="overview-circle-button overview-battery-link" data-detail="battery_energy" aria-label="Open battery energy details"><span class="overview-circle-label">Battery level</span><span class="overview-summary-ring${soc === null ? ' is-unavailable' : ''}" role="progressbar" aria-label="Battery state of charge" aria-valuemin="0" aria-valuemax="100"${soc === null ? ' aria-valuetext="Unavailable"' : ` aria-valuenow="${soc}" aria-valuetext="${esc(number(ctx, soc, 1, 1))}%"`} style="--ring-tone:#26c9c8;--ring-fill:${soc ?? 0}%"><span class="overview-ring-centre"><strong class="overview-battery-soc">${soc === null ? '—' : `${esc(number(ctx, soc, 1, 1))}%`}</strong><small>State of charge</small></span></span></button></div><small class="overview-battery-energy overview-circle-storage"${approximate ? ' aria-label="Estimated stored energy from state of charge and battery capacity" title="Estimated from state of charge and battery capacity"' : ''}>${esc(energyText)}</small></section>`;
}

export const OVERVIEW_STYLE = `
.overview-circle-grid>.overview-circle-button{display:grid}.overview-circle-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.overview-circle-button{appearance:none;display:grid;align-content:start;justify-items:center;gap:10px;min-width:0;width:100%;border:0;background:transparent;color:inherit;padding:0;font:inherit;cursor:pointer}.overview-circle-label{font-size:11px;line-height:1.3;min-height:28px;text-align:center;display:grid;place-items:center}.overview-summary-ring{display:grid;place-items:center;width:100%;aspect-ratio:1;border-radius:50%;padding:8px;background:conic-gradient(var(--ring-tone) var(--ring-fill),var(--overview-track,#dce8ef) 0)}.overview-ring-centre{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;background:var(--overview-ring-bg,#f1f6fa);min-width:0;text-align:center}.overview-circle-panel .overview-summary-ring strong,.overview-circle-panel .overview-summary-ring .overview-battery-soc{font-size:clamp(10px,4.3cqi,19px);line-height:1.2;font-weight:650;letter-spacing:-.03em}.overview-ring-centre small{font-size:clamp(7px,2.5cqi,10px);margin-top:5px;line-height:1.2;color:var(--muted)}.overview-circle-panel .overview-circle-storage{font-size:11px;text-align:center;margin-top:12px;line-height:1.4}.night .overview-circle-panel{--overview-ring-bg:#27333f}.overview-circle-button:focus-visible{outline:2px solid #16bfc4;outline-offset:4px;border-radius:12px}.overview-summary-ring.is-unavailable{background:var(--overview-track,#dce8ef)}@container(max-width:240px){.overview-circle-grid{gap:5px}.overview-summary-ring{padding:5px}.overview-circle-label{font-size:9px}.overview-ring-centre small{font-size:7px}}
.overview-energy-five>.overview-energy-metric:last-child{grid-column:1/-1}.overview-charging-total{padding:4px 0 24px}.overview-charging-total small{display:block;color:var(--muted,#748595);font-size:14px;margin-bottom:8px}.overview-charging-total strong{display:block;font-size:32px;line-height:1.2}.overview-charging-breakdown{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.overview-charging-breakdown:has(>.overview-charging-channel:only-child){grid-template-columns:1fr}.overview-charging-channel{min-width:0}.overview-charging-channel>sigen-history-chart{display:block;min-width:0;margin-top:14px}.overview-charging-breakdown .overview-energy-metric{width:100%;min-height:104px;padding:18px}.overview-charging-breakdown .overview-energy-metric small{font-size:15px}.overview-charging-breakdown .overview-energy-metric strong{font-size:25px}.night .overview-charging-detail{--overview-tile:#ffffff0b;--overview-tile-hover:#ffffff13}
@container(max-width:700px){.overview-charging-breakdown{grid-template-columns:1fr}}
.overview-compact-panel.panel{margin:0;padding:20px;border:1px solid var(--line,#dce7ee);border-radius:22px;background:var(--surface,#f8fcfe);color:var(--ink,#263647);box-shadow:none;min-width:0;box-sizing:border-box}.overview-compact-panel h2{font-size:19px;line-height:1.25;letter-spacing:0;font-weight:650;margin:0 0 16px}.overview-energy-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.overview-energy-metric{appearance:none;border:0;border-radius:15px;min-width:0;min-height:78px;padding:12px 13px;text-align:left;background:var(--overview-tile,#edf4f8);color:inherit;font:inherit;cursor:pointer;box-sizing:border-box}.overview-energy-metric small{display:block;color:var(--muted,#748595);font-size:12px;font-weight:450;line-height:1.3;margin:0 0 6px;overflow-wrap:anywhere}.overview-energy-metric strong{display:block;color:inherit;font-size:21px;font-weight:650;line-height:1.2;overflow-wrap:anywhere}.overview-energy-metric:focus-visible,.overview-battery-link:focus-visible{outline:2px solid #16bfc4;outline-offset:3px}.overview-energy-metric:hover{background:var(--overview-tile-hover,#e3eff4)}.overview-battery-link{appearance:none;display:block;width:100%;border:0;background:transparent;padding:0;text-align:left;color:inherit;font:inherit;cursor:pointer}.overview-battery-link h2{margin-bottom:15px}.overview-battery-soc{display:block;font-size:25px;line-height:1.2;font-weight:650}.overview-battery-track{height:12px;overflow:hidden;border-radius:8px;background:var(--overview-track,#dce8ef);margin:15px 0 12px}.overview-battery-track>span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#1bbbbb,#6cded1)}.overview-battery-track>span[hidden]{display:none}.overview-battery-energy{display:block;font-size:14px;line-height:1.25;color:var(--muted,#748595);font-weight:400}.night .overview-compact-panel{--overview-tile:#ffffff0b;--overview-tile-hover:#ffffff13;--overview-track:#ffffff1a}.overview-compact-panel{container-type:inline-size}@container(max-width:250px){.overview-energy-metric{padding:11px 10px}.overview-energy-metric strong{font-size:18px}.overview-energy-metric small{font-size:11px}}@container(max-width:180px){.overview-energy-metrics{grid-template-columns:1fr}}
`;
