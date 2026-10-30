/* SPDX-License-Identifier: GPL-3.0-only
 * Decorative device illustrations and a read-only overview. Owner-supplied
 * artwork is cropped from its atlas; original vector illustrations are used
 * when artwork is absent. The host owns all navigation and measurements.
 */
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const MISSING = new Set(['', 'unknown', 'unavailable', 'none']);
const TYPES = Object.freeze({pv:'solar',pvarray:'solar',solarpanel:'solar',pvpanel:'solar',pvmodule:'solar',optimizer:'solar',solar:'solar',battery:'storage',batterysystem:'storage',batterymodule:'storage',battery_module:'storage',ess:'storage',sigenstor:'storage',sigenstorsystem:'storage',storage:'storage',aio:'storage',inverter:'storage',energycontroller:'storage',controller:'storage',ac:'ac',evac:'ac',accharger:'ac',sigenaccharger:'ac',dc:'dc',evdc:'dc',dccharger:'dc',sigendccharger:'dc',gateway:'gateway',energygateway:'gateway',sigengateway:'gateway',grid:'grid',load:'load',home:'load'});
function kind(value) {
  const raw = String(value && typeof value === 'object' ? value.type ?? value.device_type ?? value.deviceType ?? '' : value ?? '').toLowerCase().replace(/[\s_-]/g, '');
  return Object.hasOwn(TYPES,raw) ? TYPES[raw] : '';
}
function safeImage(value) { return typeof value === 'string' && value && !value.startsWith('//') && !/[\s<>"'\\]/.test(value) && (value.startsWith('/') || value.startsWith('https://')) ? value : ''; }
function illustration(type) {
  if (type === 'solar') return '<path d="M34 100 L30 121 M80 96 L91 119 M20 123 H43 M81 121 H101" stroke="#7b929f" stroke-width="5" stroke-linecap="round"/><g transform="translate(12 11) skewY(-8)"><rect x="5" y="5" width="88" height="93" rx="3" fill="#183d5f" stroke="#90a5b4" stroke-width="5"/><path d="M27 7 V96 M49 7 V96 M71 7 V96 M7 28 H91 M7 51 H91 M7 74 H91" stroke="#a0c5df" stroke-width="1.2"/><path d="M10 10 H88 V92" fill="none" stroke="#d9efff" stroke-opacity=".35" stroke-width="2"/></g>';
  if (type === 'storage') return '<path d="M31 11 L89 7 L101 16 V148 L87 154 L31 148 Z" fill="#d7dfe5" stroke="#8fa2af"/><rect x="25" y="11" width="63" height="137" rx="8" fill="#f6f9fa" stroke="#9baeba" stroke-width="1.5"/><path d="M25 51 H88 M25 98 H88" stroke="#ccd5db"/><path d="M34 17 H79" stroke="#ffffff" stroke-width="3"/><circle cx="70" cy="32" r="5" fill="#263e49"/><circle cx="70" cy="32" r="2.5" fill="#3ad5cf"/><path d="M34 141 H79" stroke="#d4dde2" stroke-width="2"/>';
  if (type === 'ac') return '<rect x="31" y="17" width="53" height="100" rx="17" fill="#ccd7de"/><rect x="25" y="12" width="54" height="96" rx="17" fill="#f7fafb" stroke="#90a5b3" stroke-width="1.5"/><circle cx="52" cy="40" r="14" fill="#203b4c"/><circle cx="52" cy="40" r="5" fill="#35d4cb"/><path d="M52 69 V89" stroke="#c6d4de" stroke-width="2"/><path d="M79 61 C111 62 109 124 88 130 C69 135 62 119 65 105" fill="none" stroke="#536876" stroke-width="5" stroke-linecap="round"/><path d="M63 103 L64 89 L73 89 L74 106 Z" fill="#263f4c"/><path d="M39 114 H65" stroke="#a3b4bf" stroke-width="4"/>';
  if (type === 'dc') return '<path d="M35 7 L81 4 L92 13 V143 L80 150 L35 146 Z" fill="#d3dde4" stroke="#92a8b6"/><rect x="28" y="8" width="53" height="136" rx="7" fill="#f7fafb" stroke="#8ca3b2" stroke-width="1.5"/><rect x="38" y="25" width="32" height="25" rx="5" fill="#243e4f"/><circle cx="54" cy="37" r="4" fill="#39d6cc"/><path d="M39 70 H69 M39 76 H69" stroke="#c7d4de" stroke-width="2"/><path d="M81 61 C110 67 109 133 92 135 C74 137 77 110 77 99" fill="none" stroke="#536a79" stroke-width="5" stroke-linecap="round"/><path d="M74 98 V82 H85 V100 Z" fill="#2b4657"/><path d="M22 147 H88 L97 155 H16 Z" fill="#9dafba"/>';
  if (type === 'gateway') return '<rect x="31" y="29" width="61" height="89" rx="7" fill="#d1dce3"/><rect x="23" y="25" width="63" height="86" rx="7" fill="#f6fafb" stroke="#9bb0be" stroke-width="1.5"/><path d="M33 35 H73 M33 40 H73" stroke="#dbe5eb" stroke-width="2"/><circle cx="66" cy="54" r="3.5" fill="#2ecdc6"/><path d="M36 111 V127 M53 111 V131 M70 111 V127" stroke="#9cafba" stroke-width="4" stroke-linecap="round"/>';
  if (type === 'grid') return '<path d="M59 10 L27 145 M61 10 L93 145 M23 145 H97 M37 98 H83 M43 69 H77 M47 43 H73 M29 44 H91 M23 71 H97 M15 100 H105 M29 143 L78 70 M91 143 L42 70 M44 68 L73 42 M76 68 L47 42" fill="none" stroke="#809aaa" stroke-width="4" stroke-linejoin="round"/><path d="M29 43 V55 M91 43 V55 M23 71 V84 M97 71 V84 M15 100 V113 M105 100 V113" stroke="#b7c9d4" stroke-width="4"/>';
  if (type === 'load') return '<path d="M17 72 L60 29 L103 72 V142 H17 Z" fill="#e6eff4" stroke="#91a8b8" stroke-width="3"/><path d="M8 75 L60 20 L112 75" fill="none" stroke="#6f8c9f" stroke-width="7" stroke-linejoin="round"/><rect x="48" y="103" width="25" height="39" rx="2" fill="#9eb5c4"/><rect x="28" y="81" width="17" height="20" fill="#6bcfcf"/><rect x="75" y="81" width="17" height="20" fill="#6bcfcf"/>';
  return '';
}

/** Decorative and intentionally inert. An atlas image is clipped to the
 * equipment viewBox, never shown as a complete house or empty generic box. */
export function renderDeviceGraphic(type, ctx = {}) {
  const device = kind(type);
  if (!device) return '';
  const art = ctx.art ?? {}, night = ctx.night === true, key = device === 'storage' ? 'battery' : device;
  const atlas = safeImage(art[key]);
  const crop = {
    storage: {bounds:'476 553 127 268',size:[1170,1013]}, gateway:{bounds:'659 619 79 119',size:[1170,1013]},
    ac:{bounds:night?'55 482 53 88':'50 489 42 84',size:[1170,1011]},
    dc:{bounds:night?'251 594 44 129':'254 599 61 144',size:night?[1125,960]:[1149,984]},
  }[device];
  const image = atlas && crop ? `<svg viewBox="${crop.bounds}" preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden="true"><image href="${esc(atlas)}" width="${crop.size[0]}" height="${crop.size[1]}" preserveAspectRatio="none"/></svg>` : `<svg viewBox="0 0 120 160" preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden="true">${illustration(device)}</svg>`;
  return `<span class="sigen-device-graphic${atlas && crop ? ' is-owner-art' : ' is-vector'}" data-device-graphic="${device}" aria-hidden="true">${image}</span>`;
}

function mapped(ctx, key) { try { return Boolean(ctx.entities?.[key]) || ctx.has?.(key) === true; } catch { return false; } }
function reading(ctx, key, quantity = 'power') {
  try {
    const state = ctx.state?.(key);
    if (state && (MISSING.has(String(state.state ?? '').trim().toLowerCase()) || state.attributes?.available === false)) return null;
    const value = ctx.value?.(key, quantity);
    return typeof value === 'number' && Number.isFinite(value) && (quantity !== 'soc' || value >= 0 && value <= 100) ? value : null;
  } catch { return null; }
}
function stateText(ctx, key) {
  try { const state = ctx.state?.(key), value = state && typeof state === 'object' ? state.state : state; return value === undefined || value === null || MISSING.has(String(value).trim().toLowerCase()) ? '' : String(value).replaceAll('_',' '); } catch { return ''; }
}
function identity(item) {
  for (const key of ['id','serial','serial_number','serialNumber']) if ((typeof item?.[key] === 'string' && item[key].trim()) || typeof item?.[key] === 'number' && Number.isFinite(item[key])) return String(item[key]);
  return '';
}
function absentCapability(ctx, type) {
  const names = {solar:['solar','pv'],storage:['storage','sigenstor'],ac:['ac','evac','ac_charger'],dc:['dc','evdc','dc_charger'],gateway:['gateway','energy_gateway']}[type] ?? [];
  return [ctx.capabilities,ctx.config?.capabilities].some(values=>values&&typeof values==='object'&&names.some(key=>values[key]===false||values[key]?.installed===false));
}
const DEFINITIONS = [
  {type:'solar',title:'Solar',route:'solar',keys:['solar_power','solar_today'],power:'solar_power'},
  {type:'storage',title:'SigenStor',route:'battery',keys:['battery_power','battery_soc','battery_capacity','inverter_power','inverter_ac_power','inverter_state'],power:'battery_power'},
  {type:'ac',title:'Sigen AC charger',route:'ac',keys:['ac_power','ac_state','ac_status','ac_today'],power:'ac_power'},
  {type:'dc',title:'Sigen DC charger',route:'dc',keys:['dc_power','dc_state','dc_status','dc_today'],power:'dc_power'},
  {type:'gateway',title:'Gateway',route:'gateway',keys:['gateway_state','grid_status','grid_power','home_power'],power:'grid_power'},
];

/** Inventory controls installed/not-installed status; offline devices remain
 * visible. Entity mappings provide discovery when inventory is incomplete. */
export function deviceOverviewModel(ctx = {}) {
  const inventory = Array.isArray(ctx.inventory) ? ctx.inventory.filter(item=>item&&typeof item==='object'&&!Array.isArray(item)) : [];
  const result = [];
  for (const definition of DEFINITIONS) {
    const supplied = inventory.filter(item=>kind(item)===definition.type), installed = supplied.filter(item=>item.installed!==false);
    if (absentCapability(ctx,definition.type) || supplied.length && !installed.length || !installed.length && !definition.keys.some(key=>mapped(ctx,key))) continue;
    const offline = installed.length > 0 && installed.every(item=>item.available===false||item.status==='offline'||item.state==='offline');
    let route = definition.route, powerKey = definition.power;
    if (definition.type === 'storage' && !['battery_power','battery_soc','battery_capacity'].some(key=>mapped(ctx,key)) && installed.every(item=>['inverter','energycontroller','aio','controller'].includes(String(item.type??item.device_type??item.deviceType??'').toLowerCase().replace(/[\s_-]/g,'')))) {
      route='inverter'; powerKey = mapped(ctx,'inverter_power') ? 'inverter_power' : 'inverter_ac_power';
    }
    if (definition.type==='gateway'&&!mapped(ctx,'grid_power')&&mapped(ctx,'home_power')) powerKey='home_power';
    const power = offline ? null : reading(ctx,powerKey), soc = definition.type==='storage'&&!offline ? reading(ctx,'battery_soc','soc') : null;
    let detail = offline ? 'Unavailable' : '';
    if (!detail && definition.type==='storage' && power!==null) detail = Math.abs(power)<.03?'Idle':power>0?'Charging':'Discharging';
    if (!detail && definition.type==='ac') detail=stateText(ctx,'ac_state')||stateText(ctx,'ac_status');
    if (!detail && definition.type==='dc') detail=stateText(ctx,'dc_state')||stateText(ctx,'dc_status')||(power===null?'':Math.abs(power)<.03?'Idle':power>0?'Charging':'Discharging');
    if (!detail && definition.type==='gateway') detail=stateText(ctx,'gateway_state')||stateText(ctx,'grid_status')||(powerKey==='home_power'?'Home consumption':power===null?'':Math.abs(power)<.03?'Balanced':power>0?'Importing':'Exporting');
    result.push({...definition,route,power,soc,detail,offline,count:installed.length,id:['ac','dc','gateway'].includes(definition.type)&&installed.length===1?identity(installed[0]):''});
  }
  return result;
}

export function renderDeviceOverview(ctx = {}) {
  const devices = deviceOverviewModel(ctx);
  const format = value => value===null?'—':`${Math.abs(value).toLocaleString(undefined,{maximumFractionDigits:2})} kW`;
  return `<section class="panel sigen-device-overview"><div class="section-title"><h2>Your devices</h2></div>${devices.length ? `<div class="sigen-device-grid">${devices.map(device=>`<button type="button" class="sigen-device-card" data-detail="${device.route}"${device.id?` data-id="${esc(device.id)}"`:''} aria-label="${esc(`${device.title}: ${format(device.power)}${device.detail?`, ${device.detail}`:''}. Open details`)}">${renderDeviceGraphic(device.type,ctx)}<span class="sigen-device-copy"><strong class="sigen-device-title">${device.title}</strong><strong class="sigen-device-reading">${esc(format(device.power))}</strong>${device.soc!==null?`<small class="sigen-device-soc">${esc(device.soc.toLocaleString(undefined,{maximumFractionDigits:1}))}% SOC</small>`:''}${device.detail?`<small class="sigen-device-status">${esc(device.detail)}</small>`:''}</span><span class="sigen-device-open" aria-hidden="true">›</span></button>`).join('')}</div>` : '<p class="sigen-device-empty">No devices configured</p>'}</section>`;
}

export const DEVICE_STYLE = `
.sigen-device-graphic{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:96px;height:116px;padding:4px;box-sizing:border-box}.sigen-device-graphic>svg{display:block;width:100%;height:100%;overflow:hidden;filter:drop-shadow(3px 5px 5px #20384b15)}.sigen-device-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,175px),1fr));gap:12px}.sigen-device-card{position:relative;appearance:none;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:12px;min-width:0;min-height:218px;padding:16px;border:1px solid var(--line,#dce7ee);border-radius:20px;background:var(--surface,#f8fcfe);color:inherit;font:inherit;text-align:center;cursor:pointer}.sigen-device-card:hover{border-color:#21bfc6}.sigen-device-card:focus-visible{outline:2px solid #16bfc4;outline-offset:3px}.sigen-device-copy{display:flex;flex-direction:column;gap:6px;align-items:center;min-width:0;max-width:100%;overflow-wrap:anywhere}.sigen-device-title{font-size:14px;font-weight:600;line-height:1.3}.sigen-device-reading{font-size:20px;font-weight:650;line-height:1.25;font-variant-numeric:tabular-nums}.sigen-device-soc,.sigen-device-status{font-size:12px;line-height:1.3;color:var(--muted,#657a99)}.sigen-device-open{position:absolute;right:13px;top:11px;font-size:22px;color:var(--muted,#657a99)}.sigen-device-empty{text-align:center;color:var(--muted,#657a99);padding:18px;margin:0}.detail-hero .sigen-device-graphic{width:120px;height:160px}.detail-inventory-icon .sigen-device-graphic{width:48px;height:65px;padding:2px}.sigen-device-overview{container-type:inline-size}@container(max-width:400px){.sigen-device-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.sigen-device-card{padding:13px 9px;min-height:204px}.sigen-device-card .sigen-device-graphic{width:80px;height:100px}.sigen-device-title{font-size:12px}.sigen-device-reading{font-size:18px}}@container(max-width:240px){.sigen-device-grid{grid-template-columns:minmax(0,1fr)}}
`;
