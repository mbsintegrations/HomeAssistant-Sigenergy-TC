/* SPDX-License-Identifier: GPL-3.0-only
 * Pure My Energy Profile views. The host owns navigation and data access.
 */
export const ENERGY_ROUTES = Object.freeze([
  'energy_profile', 'grid_export_limit', 'grid_import_limit', 'grid_connection_current',
  'block_battery_export', 'peak_shaving', 'charging_source_priority', 'battery_levels',
  'battery_preheating', 'battery_power_limit', 'solar_source_priority', 'solar_power_limit',
  'backup_reserve', 'backup_history', 'backup_events', 'energy_saving', 'aggregator_allocation',
  'grid_automation', 'battery_automation', 'manual_control', 'grid_connection',
]);
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const text = value => typeof value === 'string' && value.trim() && !['unknown', 'unavailable', 'none', 'null'].includes(value.trim().toLowerCase()) ? value.trim() : null;
const number = value => ['number', 'string'].includes(typeof value) && !(typeof value === 'string' && !value.trim()) && Number.isFinite(Number(value)) ? Number(value) : null;
const bounded = (value, min = 0, max = Infinity) => { const n = number(value); return n !== null && n >= min && n <= max ? n : null; };
const power = value => { const n = bounded(value); return n !== null && n < 4294967.295 ? n : null; };
const fmt = (value, unit = '') => value === null ? '—' : `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;
const bool = value => typeof value === 'boolean' ? value : null;
const boolText = value => value === null ? '—' : value ? 'Enabled' : 'Disabled';
const awareTime = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
const inventory = ctx => Array.isArray(ctx.inventory) ? ctx.inventory.filter(item => item && typeof item === 'object') : [];
const plantType = item => ['plant', 'system'].includes(item?.type);

// Connectivity is an explicit system reading, never inferred from power flow.
export function gridConnectionStatus(reading) {
  if (!reading || reading.attributes?.available === false) return null;
  const state = text(reading.state)?.toLowerCase().replace(/[\s_-]+/g, ' ');
  if (['on grid', 'on grid mode', 'grid mode'].includes(state)) return 'on_grid';
  if (['off grid', 'off grid mode'].includes(state)) return 'off_grid';
  return null;
}

export function readingSource(state) {
  const source=state?.attributes?.data_source??'';
  return /modbus|^local$/.test(source)?'modbus':/cloud/.test(source)?'cloud':/api/.test(source)?'api':null;
}

export function freshReading(state, now=Date.now()) {
  if(!state||['unknown','unavailable','none',''].includes(String(state.state))||state.attributes?.available===false)return false;
  const source=readingSource(state);if(source==='api')return false;if(!source)return true;
  const stamp=Date.parse(state.attributes?.observed_at??state.attributes?.bridge_captured_at??'');
  const age=(now-stamp)/1000,max={modbus:120,cloud:1800}[source];
  return Number.isFinite(age)&&age>=-5&&age<=max;
}

export function selectReadingState(candidates,now=Date.now()) {
  return candidates.filter(state=>freshReading(state,now)).map((state,index)=>({state,index,priority:{modbus:0,cloud:1,api:2}[readingSource(state)]??3})).sort((a,b)=>a.priority-b.priority||a.index-b.index)[0]?.state;
}

export function connectionIndicators(ctx={}) {
  const meta=ctx.state?.('control_status')?.attributes?.connections??{},now=ctx.now instanceof Date?ctx.now.getTime():Number(ctx.now??Date.now());
  return ['modbus','cloud'].map(key=>{
    const explicit=meta[key],sensor=ctx.state?.(`${key}_status`);
    let status=explicit?.status??(sensor?.state==='connected'?'connected':'disabled');
    let enabled=explicit?.enabled??sensor?.attributes?.enabled??status!=='disabled',sharedReadings=false;
    if(key==='modbus'){
      const local=['solar_power','home_power','battery_power','battery_soc'].map(k=>ctx.rawState?.(k)??ctx.state?.(k)).filter(state=>readingSource(state)==='modbus');
      if(local.length&&!enabled){enabled=true;sharedReadings=true;status=local.some(state=>freshReading(state,now))?'connected':'disconnected';}
    }
    if(key==='cloud'&&ctx.config?.cloud_paused===true){enabled=false;status='disabled';}
    const stamp=explicit?.last_success??sensor?.attributes?.last_success;
    if(status==='connected'&&stamp){const age=(now-Date.parse(stamp))/1000;if(!Number.isFinite(age)||age>({modbus:120,cloud:1800}[key])||age< -5)status='disconnected';}
    const tone=status==='connected'?'green':!enabled||status==='disabled'?'grey':['setup_required','connecting','authorisation_required','authentication_required','rate_limited','session_conflict'].includes(status)?'amber':'red';
    const label=sharedReadings?'Local feed':{modbus:'Modbus',cloud:'Cloud'}[key],description=sharedReadings?(status==='connected'?'Shared readings connected':'Shared readings unavailable'):{connected:'Connected',disabled:'Disabled',disconnected:'Unavailable',setup_required:'Set up required',connecting:'Connecting',authorisation_required:'Owner authorisation required',authentication_required:'Sign in required',rate_limited:'Rate limited',session_conflict:'Account session limit'}[status]??'Unavailable';
    return {key,label,status,tone,description,enabled,shared_readings:sharedReadings,last_success:stamp??null};
  });
}

export const CONTROL_ROUTES=Object.freeze({mode:'native_mode',grid_connection:'grid_switch',charging_mode:'charger_control',charger_schedule:'charger_control',ac_more:'charger_control',dc_more:'charger_control'});

export const OWNER_SETTING_ROUTES=Object.freeze({
  grid_export_limit:['grid_export_limit','Grid export power limit'],grid_import_limit:['grid_import_limit','Grid import power limit'],
  grid_connection_current:['grid_connection_current','Grid connection current'],block_battery_export:['battery_export_block','Block battery export'],
  battery_levels:['battery_levels','Battery SOC limits'],battery_power_limit:['battery_power_limits','Battery power limits'],
  solar_power_limit:['pv_power_limit','Solar power limit'],backup_reserve:['backup_reserve','Backup reserve'],
  priority:['discharge_priority','Battery discharge priority'],solar_source_priority:['solar_priority','Solar destination priority'],
  surplus_pv_priority:['solar_priority','Solar destination priority'],peak_shaving:['peak_shaving','Peak shaving'],
  dc_charging_settings:['dc_charge_settings','DC charging settings'],
});
export function ownerSettingTarget(route,ctx={}) {
  if(OWNER_SETTING_ROUTES[route]){
    const [setting,title]=OWNER_SETTING_ROUTES[route];
    if(setting==='dc_charge_settings'&&ctx.id!=null&&ctx.id!==''){
      const device=inventory(ctx).find(item=>[item.id,item.serial,item.serial_number,item.serialNumber].some(value=>value!=null&&String(value)===String(ctx.id)));
      if(!device||!['dc','dccharger','evdc'].includes(String(device.type??'').toLowerCase().replace(/[^a-z]/g,'')))return null;
      return {setting,title,serial:device.serial??device.serial_number??device.serialNumber};
    }
    return {setting,title};
  }
  if(route!=='charging_mode')return null;
  const device=inventory(ctx).find(item=>[item.id,item.serial,item.serial_number,item.serialNumber].some(value=>value!=null&&String(value)===String(ctx.id)));
  const type=String(device?.type??'').toLowerCase().replace(/[^a-z]/g,'');
  const kind=['dc','dccharger','evdc'].includes(type)?'dc':['ac','accharger','evac'].includes(type)?'ac':null;
  return kind?{setting:`${kind}_charge_mode`,title:`${kind.toUpperCase()} charging mode`,serial:device.serial??device.serial_number??device.serialNumber}:null;
}
const nativeInput=(name,label,value,extra='')=>`<label class="settings-field"><span>${esc(label)}</span><input name="${esc(name)}" value="${esc(value??'')}" ${extra}></label>`;
const nativeCheck=(name,label,value)=>`<label class="settings-check"><span>${esc(label)}</span><input type="checkbox" name="${esc(name)}"${value===true?' checked':''}></label>`;
const nativeSelect=(name,label,value,options)=>`<label class="settings-field"><span>${esc(label)}</span><select name="${esc(name)}">${options.map(([id,label])=>`<option value="${esc(id)}"${String(id)===String(value)?' selected':''}>${esc(label)}</option>`).join('')}</select></label>`;
const nativeNumber=(name,label,value,max=4294967.295)=>nativeInput(name,label,value,`type="number" min="0" max="${max}" step="any"`);
const peakWindow=(i,slot={weekdays:[1,2,3,4,5,6,7],start:'',end:'',power_kw:''})=>`<fieldset class="native-peak-window" data-native-peak-window="${i}"><legend>Window</legend><div class="settings-weekdays">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day,n)=>`<label><input type="checkbox" name="slot_${i}_days" value="${n+1}"${slot.weekdays.includes(n+1)?' checked':''}><span>${day}</span></label>`).join('')}</div><div class="settings-columns">${nativeInput(`slot_${i}_start`,'From',slot.start,'type="time"')}${nativeInput(`slot_${i}_end`,'Until',slot.end,'type="time"')}${nativeNumber(`slot_${i}_power`,'Maximum imported grid power (kW)',slot.power_kw)}</div><button type="button" class="settings-secondary" data-native-remove-window>Remove window</button></fieldset>`;
export function bindOwnerSettingForm(form){
  if(!form||form.dataset.nativeOwnerForm!=='peak_shaving'||form._nativeBound)return;form._nativeBound=true;
  form.addEventListener('click',event=>{
    const remove=event.target.closest?.('[data-native-remove-window]'),add=event.target.closest?.('[data-native-add-window]');
    if(!remove&&!add)return;event.preventDefault();event.stopPropagation();
    if(remove)remove.closest('[data-native-peak-window]').remove();
    else{const rows=[...form.querySelectorAll('[data-native-peak-window]')];if(rows.length>=64)return;const next=Math.max(-1,...rows.map(row=>Number(row.dataset.nativePeakWindow)))+1,template=form.ownerDocument.createElement('template');template.innerHTML=peakWindow(next);form.querySelector('[data-native-peak-list]').append(template.content);}
    form.dispatchEvent(new Event('input',{bubbles:true}));
  });
}
export function renderOwnerSetting(route,ctx={}) {
  const target=ownerSettingTarget(route,ctx);if(!target)return null;
  if(!ctx.ownerConfiguration&&ctx.state?.('control_status')?.attributes?.control_api_version!==1)return null;
  const state=ctx.ownerConfiguration;
  if(!state||state.route!==route||String(state.id??'')!==String(ctx.id??''))return {title:target.title,body:note('Reading current plant settings…')};
  if(state.error)return {title:target.title,body:note(state.error)};
  if(state.value===undefined)return {title:target.title,body:note('The current plant setting could not be read.')};
  const v=state.value,key=target.setting,metadata=state.metadata??{};
  let content='';
  if(['grid_export_limit','grid_import_limit','grid_connection_current'].includes(key)){
    const amps=key==='grid_connection_current',field=amps?'limit_a':'limit_kw';
    content=nativeCheck('enabled','Enable owner limit',v.enabled)+nativeNumber(field,amps?'Maximum current (A)':'Maximum power (kW)',v[field],amps?(metadata.installerSetLimitation??10000):(metadata.installer_limit_kw??4294967.295));
  }else if(key==='battery_export_block')content=nativeCheck('enabled','Block battery export to grid',v);
  else if(key==='battery_power_limits')content=nativeNumber('charge_kw','Maximum charging power (kW)',v.charge_kw)+nativeNumber('discharge_kw','Maximum discharging power (kW)',v.discharge_kw)+note('Leave blank to use your configured power limits.');
  else if(key==='pv_power_limit')content=nativeNumber('limit_kw','Maximum solar power (kW)',v.limit_kw)+note('Leave blank to use the system maximum.');
  else if(key==='backup_reserve')content=nativeNumber('soc','Backup reserve (%)',v.soc,100);
  else if(key==='battery_levels')content=[['charge_soc','Charging cut-off (%)'],['discharge_soc','Discharging cut-off (%)'],['backup_soc','Backup reserve (%)'],...(v.peak_shaving_soc!==null?[['peak_shaving_soc','Peak-shaving reserve (%)']]:[])].map(([field,label])=>nativeNumber(field,label,v[field],100)).join('');
  else if(['discharge_priority','solar_priority'].includes(key))content=v.order.map((item,index)=>nativeSelect(`priority_${index}`,`Priority ${index+1}`,item,v.order.map((key,i)=>[key,metadata.destinations?.find(row=>row.id===key)?.label??({pv:'Solar',evdc:'DC charger',grid:'Grid'})[key]??(key.startsWith('destination-')?`Destination ${i+1}`:key.replace(/[_-]/g,' '))]))).join('');
  else if(key==='peak_shaving'){
    content=nativeCheck('enabled','Enable peak shaving',v.enabled)+nativeNumber('soc','Minimum battery SOC (%)',v.soc,100);
    content+=`<div data-native-peak-list>${v.slots.map((slot,i)=>peakWindow(i,slot)).join('')}</div><button type="button" class="settings-secondary" data-native-add-window>Add window</button>`;
  }else if(key.endsWith('_charge_mode')){
    const dc=key.startsWith('dc_');
    content=nativeSelect('mode','Charging mode',v.mode,[[0,'Fast charging'],[1,'PV surplus'],[dc?3:2,'Sigen AI']]);
    if(v.battery_boost!==null)content+=nativeCheck('battery_boost','Charge from home battery',v.battery_boost);
    if(v.grid_charging!==null)content+=nativeCheck('grid_charging','Allow grid charging',v.grid_charging);
    if(v.cutoff_soc!==null)content+=nativeNumber('cutoff_soc','Home battery cut-off SOC (%)',v.cutoff_soc,metadata.socUpperLimit??100);
    if(v.max_grid_power_kw!==null)content+=nativeNumber('max_grid_power_kw','Maximum grid charging power (kW)',v.max_grid_power_kw);
  }else if(key==='dc_charge_settings')content=nativeNumber('power_kw','Maximum DC charging power (kW)',v.power_kw,metadata.ratedPower??4294967.295)+nativeNumber('cutoff_soc','Vehicle charging cut-off SOC (%)',v.cutoff_soc,100);
  const enabled=ctx.controlPermission===true&&ctx.capabilities?.[key]?.available===true&&(key!=='grid_connection_current'||metadata.installerSetLimitation!==undefined&&metadata.installerSetLimitation!==''&&metadata.installerSetLimitation!==null);
  return {title:target.title,subtitle:'Plant settings',body:`<form data-native-owner-form="${esc(key)}"${key==='grid_connection_current'&&!enabled?' data-owner-unavailable':''}>${content}<div class="settings-actions"><button type="button" class="settings-secondary" data-detail-back>Cancel</button><button type="submit" class="settings-save"${enabled?'':' disabled'}>Apply</button></div><output class="settings-form-result" aria-live="polite"></output></form>`};
}
export function collectOwnerSetting(form,state) {
  const before=state?.value,key=state?.setting;
  if(before===undefined||!key||!state.revision)throw new Error('Reopen this setting to read the current plant value');
  const get=name=>form.querySelector(`[name="${name}"]`),num=(name,optional=false)=>{
    const value=get(name)?.value;if(optional&&value==='')return null;
    if(value===undefined||value===''||!Number.isFinite(Number(value)))throw new Error('Enter a valid number');
    return Number(value);
  };
  if(['grid_export_limit','grid_import_limit','grid_connection_current'].includes(key)){const field=key==='grid_connection_current'?'limit_a':'limit_kw';return {enabled:get('enabled').checked,[field]:num(field)};}
  if(key==='battery_export_block')return get('enabled').checked;
  if(key==='battery_power_limits')return {charge_kw:num('charge_kw',true),discharge_kw:num('discharge_kw',true)};
  if(key==='pv_power_limit')return {limit_kw:num('limit_kw',true)};
  if(key==='backup_reserve')return {soc:num('soc')};
  if(key==='battery_levels')return {...before,...Object.fromEntries(['charge_soc','discharge_soc','backup_soc','peak_shaving_soc'].filter(field=>get(field)).map(field=>[field,num(field)]))};
  if(['discharge_priority','solar_priority'].includes(key)){
    const order=before.order.map((_,i)=>get(`priority_${i}`).value);if(new Set(order).size!==order.length)throw new Error('Use each destination once');return {order};
  }
  if(key==='peak_shaving'){
    const slots=[];
    for(const row of form.querySelectorAll('[data-native-peak-window]')){const i=Number(row.dataset.nativePeakWindow),start=get(`slot_${i}_start`).value,end=get(`slot_${i}_end`).value;slots.push({start,end,weekdays:[...row.querySelectorAll(`input[name="slot_${i}_days"]:checked`)].map(input=>Number(input.value)),power_kw:num(`slot_${i}_power`)});}
    return {enabled:get('enabled').checked,soc:num('soc'),slots};
  }
  if(key.endsWith('_charge_mode')){
    const result={...before,mode:Number(get('mode').value)};
    for(const field of ['battery_boost','grid_charging'])if(get(field))result[field]=get(field).checked;
    for(const field of ['cutoff_soc','max_grid_power_kw'])if(get(field))result[field]=num(field);
    return result;
  }
  if(key==='dc_charge_settings')return {power_kw:num('power_kw'),cutoff_soc:num('cutoff_soc')};
  throw new Error('Unknown native setting');
}

// An explicit unmatched ID must never borrow another plant's settings.
function profile(ctx) {
  const root = object(ctx.config?.energy_profile), id = ctx.id === undefined || ctx.id === null || ctx.id === '' ? null : String(ctx.id);
  if (id === null) return root;
  const plants = object(root.plants);
  if (own(plants, id) && plantType(inventory(ctx).find(item => String(item.id) === id))) return object(plants[id]);
  const knownPlant = plantType(inventory(ctx).find(item => String(item.id) === id)) || ctx.config?.plant?.id !== undefined && String(ctx.config.plant.id) === id;
  return knownPlant && (root.plant_id === undefined || String(root.plant_id) === id) ? root : {};
}
function currentMode(ctx, source) {
  const supplied = text(source.current_mode); if (supplied && !/^[-+]?\d+(?:\.\d+)?$/.test(supplied)) return supplied;
  if (ctx.id !== undefined && ctx.id !== null && ctx.id !== '') return '—';
  for (const key of ['cloud_mode', 'native_mode']) {
    try { const label = text(ctx.state?.(key)?.state); if (label && !/^[-+]?\d+(?:\.\d+)?$/.test(label)) return label; } catch { /* Optional cached reading. */ }
  }
  return '—';
}
function link(route, label, value = '', id) {
  return `<button type="button" class="energy-profile-row" data-detail="${esc(route)}"${id === undefined ? '' : ` data-id="${esc(id)}"`}><span>${esc(label)}</span><span class="energy-profile-row-end">${value ? `<small>${esc(value)}</small>` : ''}<b aria-hidden="true">›</b></span></button>`;
}
const group = body => `<div class="energy-profile-group">${body}</div>`;
const heading = title => `<h3 class="energy-profile-heading">${esc(title)}</h3>`;
const note = value => `<p class="energy-profile-note">${esc(value)}</p>`;
const metric = (label, value) => `<div class="energy-profile-metric"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`;
const metrics = body => `<div class="energy-profile-metrics">${body}</div>`;
const disabled = label => `<button type="button" class="energy-profile-action" disabled>${esc(label)}</button>`;
function readField(label, value, unit = '') {
  return `<label class="energy-profile-field"><span>${esc(label)}${unit ? ` (${esc(unit)})` : ''}</span><input type="text" value="${esc(value)}" readonly disabled></label>`;
}
function toggle(label, value) {
  return `<div class="energy-profile-toggle"><span>${esc(label)}</span><span class="energy-profile-toggle-value">${esc(boolText(value))}${value === null ? '' : `<input type="checkbox" aria-label="${esc(label)}" disabled${value ? ' checked' : ''}>`}</span></div>`;
}
function section(profile, key) { return object(profile[key]); }
function settingUnavailable(source) { return source.available === false ? note(text(source.reason) ?? 'Setting unavailable.') : ''; }
function order(source) {
  if (!Array.isArray(source.order) || !source.order.length) return note('Priority unavailable.');
  const allowed = { solar: 'Solar', battery: 'Battery', evdc: 'EVDC', evac: 'EVAC', grid: 'GRID', home: 'Home', load: 'Load' };
  if (source.order.length > 7 || new Set(source.order).size !== source.order.length || source.order.some(key => typeof key !== 'string' || !own(allowed, key))) return note('Priority unavailable.');
  return `<ol class="energy-profile-priority">${source.order.map(key => `<li>${esc(allowed[key])}</li>`).join('')}</ol>`;
}
function chargerLinks(ctx, kind, label) {
  const types = kind === 'ac' ? ['ac', 'ac_charger', 'evac'] : ['dc', 'dc_charger', 'evdc'];
  const selected = ctx.id === undefined || ctx.id === null || ctx.id === '' ? null : String(ctx.id);
  const chargers = inventory(ctx).filter(item => types.includes(item.type) && item.id !== undefined && item.id !== null && String(item.id) !== '' && (selected === null || item.plant_id !== undefined && String(item.plant_id) === selected));
  if (!chargers.length) return `<div class="energy-profile-row energy-profile-unavailable"><span>${esc(label)}</span><small>Unavailable</small></div>`;
  return chargers.map(item => link(`${kind}_more`, chargers.length === 1 ? label : `${label} · ${text(item.name) ?? String(item.id)}`, '', String(item.id))).join('');
}
function hub(ctx, source) {
  const id = ctx.id === undefined || ctx.id === null || ctx.id === '' ? undefined : String(ctx.id);
  const row = (route, label, value) => link(route, label, value, id);
  return group(row('mode', 'Current Mode', currentMode(ctx, source)) + row('strategies', 'Personal Strategies') + link('strategy', 'Add Personal Strategy', '', 'new') + row('manual_control', 'Instant Manual Control'))
    + heading('Grid Settings') + group(row('grid_export_limit', 'Grid Export Power Limit') + row('grid_import_limit', 'Grid Import Power Limit') + row('grid_connection_current', 'Max Grid Connection Current') + row('block_battery_export', 'Block Battery Grid Export') + row('peak_shaving', 'Peak Shaving') + row('tariffs', 'Tariff Plan') + row('grid_automation', 'Grid Automation'))
    + heading('Battery Settings') + group(row('charging_source_priority', 'Charging Source Priority') + row('priority', 'Battery Discharging Priority') + row('battery_levels', 'Battery Level Settings') + row('battery_preheating', 'Preheating Scheduling') + row('battery_power_limit', 'Battery Power Limit') + row('battery_automation', 'Battery Automation'))
    + heading('Solar Settings') + group(row('solar_source_priority', 'Solar Producing Source Priority') + row('solar_power_limit', 'Solar Producing Power Limit'))
    + heading('Load Usage Preference') + group(chargerLinks(ctx, 'ac', 'EVAC Settings') + chargerLinks(ctx, 'dc', 'EVDC Settings'))
    + heading('Backup Settings') + group(row('backup_reserve', 'Backup Reserve') + row('backup_history', 'Backup History') + row('backup_events', 'Backup Event Center'))
    + heading('Other') + group(row('energy_saving', 'Energy Saving Mode') + row('aggregator_allocation', 'Virtual Battery Allocation for Aggregator'));
}
function limits(title, source, unit, valueKey, hint) {
  return group(toggle(title, bool(source.enabled)) + readField(title, fmt(unit === 'kW' ? power(source[valueKey]) : bounded(source[valueKey]), unit))) + note(hint);
}
function schedules(source) {
  if (!Array.isArray(source.schedules) || !source.schedules.length) return note(source.available === true ? 'No schedules.' : 'Schedule unavailable.');
  const days = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }, clock = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
  const valid = source.schedules.filter(item => item && clock(item.start) && clock(item.end) && Array.isArray(item.weekdays) && item.weekdays.length && new Set(item.weekdays).size === item.weekdays.length && item.weekdays.every(day => own(days, day)));
  if (!valid.length) return note('Schedule unavailable.');
  return `<div class="energy-profile-schedules">${valid.map(item => `<div>${metric('Time', `${item.start}–${item.end}`)}${metric('Repeat', item.weekdays.map(day => days[day]).join(', '))}</div>`).join('')}</div>`;
}
function duration(value) {
  const seconds = bounded(value); if (seconds === null || !Number.isInteger(seconds)) return '—';
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), remainder = seconds % 60;
  return [hours ? `${hours}h` : '', minutes ? `${minutes}min` : '', remainder || !seconds ? `${remainder}s` : ''].filter(Boolean).join(' ');
}
function events(source, includeTotals) {
  const raw = Array.isArray(source.events) ? source.events : [], entries = raw.filter(item => item && awareTime(item.started_at) && bounded(item.duration_seconds) !== null && Number.isInteger(Number(item.duration_seconds)));
  const totalCount = bounded(source.total_events), totalDuration = duration(source.total_duration_seconds);
  const totals = includeTotals ? metrics(metric('Total: Duration', totalDuration) + metric('Total: events', totalCount !== null && Number.isInteger(totalCount) ? fmt(totalCount) : '—')) : '';
  if (!entries.length) return totals + note(source.available === true && Array.isArray(source.events) && source.events.length === 0 ? 'No events.' : 'History unavailable.');
  return totals + `<div class="energy-profile-events">${entries.map(item => `<article><time datetime="${esc(item.started_at)}">${esc(item.started_at)}</time><strong>${esc(duration(item.duration_seconds))}</strong><small>Duration</small></article>`).join('')}</div>`;
}

export function renderEnergyProfile(route, ctx = {}) {
  if (!ENERGY_ROUTES.includes(route)) return null;
  const source = profile(ctx), current = section(source, route);
  let title, body;
  switch (route) {
    case 'grid_connection': {
      const status = gridConnectionStatus(ctx.state?.('grid_status'));
      title = status === 'off_grid' ? 'Off Grid Mode' : status === 'on_grid' ? 'Grid Mode' : 'Grid connection';
      body = metrics(metric('Current grid connection', status === 'on_grid' ? 'On Grid' : status === 'off_grid' ? 'Off Grid' : 'Unavailable'))
        + (status ? ctx.controlPermission===true&&ctx.capabilities?.grid_switch?.available===true ? `<button type="button" class="settings-save" data-owner-setting="grid_connection" data-value="${status==='off_grid'}">${status==='on_grid'?'Go off Grid':'Go on Grid'}</button>` : disabled(status === 'on_grid' ? 'Go off Grid' : 'Go on Grid') : note('Grid connection status is unavailable.'));
      break;
    }
    case 'energy_profile': title = 'My Energy Profile'; body = hub(ctx, source); break;
    case 'manual_control': title = 'Instant Manual Control'; body = group([['charge','Charge'],['discharge','Discharge'],['hold','Hold battery'],['self_consumption','Self-consumption']].map(([mode,label])=>`<button type="button" class="energy-profile-row" data-manual="${mode}"><span>${label}</span><b aria-hidden="true">›</b></button>`).join('')); break;
    case 'grid_export_limit': title = 'Grid Export Power Limit'; body = limits(title, current, 'kW', 'limit_kw', 'Limits power exported to the grid when enabled.'); break;
    case 'grid_import_limit': title = 'Grid Import Power Limit'; body = limits(title, current, 'kW', 'limit_kw', 'Limits imported power at the grid connection point when enabled.'); break;
    case 'grid_connection_current': title = 'Max Grid Connection Current'; body = limits(title, current, 'A', 'limit_a', 'The per-phase limit must not exceed the main fuse or circuit-breaker rating.'); break;
    case 'block_battery_export': title = 'Block Battery Grid Export'; body = group(toggle('Block Battery Export to Grid', bool(current.enabled))) + note('When enabled, battery export to the grid is prevented.'); break;
    case 'peak_shaving': title = 'Peak Shaving'; body = group(readField('Peak Shaving Control Mode', text(current.mode) ?? '—')); break;
    case 'charging_source_priority': title = 'Charging Source Priority'; body = group(order(current)); break;
    case 'battery_levels': title = 'Battery Level Settings'; body = metrics(metric('Charging Cut-off SOC', fmt(bounded(current.charge_cutoff_soc, 0, 100), '%')) + metric('Backup SOC', fmt(bounded(current.backup_soc, 0, 100), '%')) + metric('Discharging Cut-off SOC', fmt(bounded(current.discharge_cutoff_soc, 0, 100), '%'))); break;
    case 'battery_preheating': title = 'Battery Preheating Scheduling'; body = group(toggle(title, bool(current.enabled))) + schedules(current); break;
    case 'battery_power_limit': title = 'Battery Power Limit'; body = group(readField('Battery Max Charging Power', current.charge_system_max === true ? 'Depends on system' : fmt(power(current.charge_kw), 'kW')) + readField('Battery Max Discharging Power', current.discharge_system_max === true ? 'Depends on system' : fmt(power(current.discharge_kw), 'kW'))) + note('An unset app limit uses the system maximum.'); break;
    case 'solar_source_priority': title = 'Solar Producing Source Priority'; body = group(order(current)); break;
    case 'solar_power_limit': title = 'Solar Producing Power Limit'; body = group(readField(title, current.system_max === true ? 'Depends on system' : fmt(power(current.limit_kw), 'kW'))) + note('Maximum solar PV output.'); break;
    case 'backup_reserve': title = 'Backup Reserve'; body = metrics(metric('Reserve Energy For Grid Outage', fmt(bounded(current.soc, 0, 100), '%'))) + group(readField('Current Mode', currentMode(ctx, source))); break;
    case 'backup_history': title = 'Backup History'; body = events(current, true); break;
    case 'backup_events': title = 'Backup Event Center'; body = events(current, false); break;
    case 'energy_saving': {
      title = 'Energy Saving Mode'; const labels = { performance: 'Performance Mode', enhanced_saving: 'Enhanced Saving Mode' };
      body = group(readField('Energy Saving Mode (On-Grid)', own(labels, current.mode) ? labels[current.mode] : '—') + toggle('Battery dormancy during potential off-grid operation', bool(current.dormancy_enabled))) + note('Dormancy reduces energy loss. Backup power may briefly stop and restart.') + disabled('Yes, enter dormancy mode.') + disabled('No, keep the battery active.'); break;
    }
    case 'aggregator_allocation': title = 'Virtual Battery Allocation for Aggregator'; body = group(readField('Status', text(current.status) ?? '—')) + note('Allocation details unavailable.'); break;
    case 'grid_automation': title = 'Grid Automation'; body = group(readField('Status', text(current.status) ?? '—')) + link('strategies', 'Personal Strategies'); break;
    case 'battery_automation': title = 'Battery Automation'; body = group(readField('Status', text(current.status) ?? '—')) + link('strategies', 'Personal Strategies'); break;
  }
  return { title, subtitle: 'Plant settings', body: `<div class="energy-profile-page">${body}${route === 'energy_profile' ? '' : settingUnavailable(current)}</div>` };
}

export const ENERGY_STYLE = `
.energy-profile-page{container-type:inline-size}.energy-profile-group{margin:12px 0 20px;border:1px solid var(--line,#dce6ee);border-radius:22px;background:var(--surface,#fff);overflow:hidden}.energy-profile-heading{font-size:14px;font-weight:600;margin:24px 8px 10px}.energy-profile-row{display:flex;align-items:center;justify-content:space-between;gap:18px;width:100%;padding:17px 20px;border:0;border-bottom:1px solid var(--line,#dce6ee);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.energy-profile-row:last-child{border-bottom:0}.energy-profile-row:hover{background:#20bfc510}.energy-profile-row-end{display:flex;gap:12px;align-items:center}.energy-profile-row b{font-size:23px;font-weight:400;color:var(--muted,#657a99)}.energy-profile-row small,.energy-profile-note,.energy-profile-provenance{color:var(--muted,#657a99)}.energy-profile-unavailable{cursor:default}.energy-profile-note{font-size:13px;line-height:1.55;margin:12px 8px}.energy-profile-provenance{font-size:11px;overflow-wrap:anywhere;margin:16px 8px}.energy-profile-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:14px 0}.energy-profile-metric{padding:19px 20px;border-radius:18px;background:var(--surface,#fff);border:1px solid var(--line,#dce6ee)}.energy-profile-metric small,.energy-profile-metric strong{display:block}.energy-profile-metric small{color:var(--muted,#657a99);font-size:12px;margin-bottom:10px}.energy-profile-metric strong{font-size:23px;font-weight:500;overflow-wrap:anywhere}.energy-profile-field{display:block;padding:17px 20px}.energy-profile-field>span{display:block;font-size:12px;color:var(--muted,#657a99);margin-bottom:9px}.energy-profile-field input{box-sizing:border-box;width:100%;color:inherit;-webkit-text-fill-color:currentColor;opacity:1;border:0;background:transparent;font:inherit;padding:0;cursor:default}.energy-profile-toggle{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:20px}.energy-profile-toggle-value{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--muted,#657a99)}.energy-profile-toggle input{accent-color:#20bfc5}.energy-profile-priority{padding:0 20px 0 45px;margin:8px 0}.energy-profile-priority li{padding:15px 5px;border-bottom:1px solid var(--line,#dce6ee)}.energy-profile-priority li:last-child{border:0}.energy-profile-action{display:block;width:100%;padding:16px 20px;border:1px solid var(--line,#dce6ee);border-radius:18px;background:var(--surface,#fff);color:var(--muted,#657a99);font:inherit;margin:12px 0;cursor:default}.energy-profile-events article{display:grid;grid-template-columns:1fr auto;gap:8px 18px;padding:19px 20px;border:1px solid var(--line,#dce6ee);border-radius:18px;margin:12px 0;background:var(--surface,#fff)}.energy-profile-events time{font-size:14px;overflow-wrap:anywhere}.energy-profile-events strong{font-weight:500}.energy-profile-events small{grid-column:2;color:var(--muted,#657a99)}.energy-profile-schedules>div{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}@container(max-width:460px){.energy-profile-row{padding:16px}.energy-profile-row-end{max-width:48%;text-align:right}.energy-profile-metrics,.energy-profile-schedules>div{grid-template-columns:1fr}.energy-profile-events article{grid-template-columns:1fr}.energy-profile-events small{grid-column:auto}}
`;
