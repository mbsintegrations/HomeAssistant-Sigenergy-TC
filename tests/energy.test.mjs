import test from 'node:test';
import { ownerSettingTarget, renderOwnerSetting, collectOwnerSetting } from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-energy.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ENERGY_ROUTES, renderEnergyProfile, ENERGY_STYLE, gridConnectionStatus, connectionIndicators, selectReadingState } from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-energy.js';

test('native owner forms require actual state and preserve read-only SOC fields',()=>{
  const state={route:'battery_levels',setting:'battery_levels',revision:'a'.repeat(64),value:{charge_soc:90,discharge_soc:20,backup_soc:20,peak_shaving_soc:null,ja12_soc:'12.0'}};
  const ctx={ownerConfiguration:state,controlPermission:true,capabilities:{battery_levels:{available:true}}};
  const model=renderOwnerSetting('battery_levels',ctx);
  assert.match(model.body,/data-native-owner-form="battery_levels"/);
  assert.doesNotMatch(model.body,/name="ja12_soc"/);
  const values={charge_soc:'95',discharge_soc:'25',backup_soc:'30'};
  const form={querySelector:selector=>{const key=selector.match(/name="([^"]+)"/)[1];return Object.hasOwn(values,key)?{value:values[key]}:null;}};
  assert.deepEqual(collectOwnerSetting(form,state),{charge_soc:95,discharge_soc:25,backup_soc:30,peak_shaving_soc:null,ja12_soc:'12.0'});
  assert.match(renderOwnerSetting('battery_levels',{...ctx,controlPermission:false}).body,/type="submit"[^>]*disabled/);
});

test('native charger setting targets remain bound to the selected discovered device',()=>{
  const inventory=[{id:'first',type:'dc',serial:'DC-ONE'},{id:'second',type:'dc',serial:'DC-TWO'}];
  assert.equal(ownerSettingTarget('dc_charging_settings',{inventory,id:'second'}).serial,'DC-TWO');
  assert.equal(ownerSettingTarget('dc_charging_settings',{inventory,id:'missing'}),null);
  assert.equal(ownerSettingTarget('charging_mode',{inventory,id:'first'}).setting,'dc_charge_mode');
});

test('native priority labels are escaped and opaque destination IDs are not displayed as labels',()=>{
  const ctx={ownerConfiguration:{route:'solar_source_priority',setting:'solar_priority',revision:'a'.repeat(64),value:{order:['destination-abc']},metadata:{destinations:[{id:'destination-abc',label:'<Battery>'}]}},controlPermission:true,capabilities:{solar_priority:{available:true}}};
  const model=renderOwnerSetting('solar_source_priority',ctx);
  assert.match(model.body,/&lt;Battery&gt;/);assert.doesNotMatch(model.body,/<Battery>/);
  assert.doesNotMatch(model.body,/>destination-abc<\/option>/);
});

const ctx = (energy_profile = {}, extra = {}) => ({ config: { energy_profile }, inventory: [], state: () => null, ...extra });
const render = (route, data = {}, extra = {}) => renderEnergyProfile(route, ctx(data, extra));
const body = (route, data = {}, extra = {}) => render(route, data, extra).body;

test('grid switching requires the advertised gateway and sends the opposite connection state',()=>{
 const enabled={controlPermission:true,capabilities:{grid_switch:{available:true}},state:()=>({state:'On Grid'})};
 const onGrid=render('grid_connection',{},enabled).body;
 assert.match(onGrid,/data-owner-setting="grid_connection" data-value="false"/);
 const offGrid=render('grid_connection',{}, {...enabled,state:()=>({state:'Off Grid'})}).body;
 assert.match(offGrid,/data-owner-setting="grid_connection" data-value="true"/);
 assert.doesNotMatch(render('grid_connection',{}, {...enabled,controlPermission:false}).body,/data-owner-setting/);
});

test('connection indicators show only Modbus and Cloud even with legacy API metadata',()=>{
  const now=Date.parse('2026-10-28T12:00:00Z'),connections={modbus:{enabled:true,status:'connected'},cloud:{enabled:true,status:'disconnected'},api:{enabled:true,status:'authorisation_required'}};
  const result=connectionIndicators({now,state:key=>key==='control_status'?{attributes:{connections}}:undefined});
  assert.deepEqual(result.map(x=>x.tone),['green','red']);
  connections.cloud={enabled:false,status:'disabled'};
  assert.equal(connectionIndicators({now,state:key=>key==='control_status'?{attributes:{connections}}:undefined})[1].tone,'grey');
  connections.modbus.last_success='2026-10-28T11:00:00Z';
  assert.equal(connectionIndicators({now,state:key=>key==='control_status'?{attributes:{connections}}:undefined})[0].tone,'red');
});

test('shared readings never claim TC owns a disabled Modbus connection or mask a configured outage',()=>{
  const now=Date.parse('2026-10-29T02:00:00Z'),meta={modbus:{enabled:false,configured:false,status:'disabled'}};
  const reading={state:'0',attributes:{data_source:'production_modbus_bridge',observed_at:'2026-10-29T01:59:30Z'}};
  const context={now,state:key=>key==='control_status'?{attributes:{connections:meta}}:undefined,rawState:key=>key==='solar_power'?reading:undefined};
  const shared=connectionIndicators(context)[0];assert.equal(shared.label,'Local feed');assert.equal(shared.description,'Shared readings connected');
  meta.modbus={enabled:true,configured:true,status:'disconnected'};
  const native=connectionIndicators(context)[0];assert.equal(native.label,'Modbus');assert.equal(native.tone,'red');
});

test('reading fallback keeps a fresh local zero and never relabels a stale reading as fresh',()=>{
  const now=Date.parse('2026-10-28T12:00:00Z');
  const local={state:'0',attributes:{data_source:'modbus',observed_at:'2026-10-28T11:59:30Z'}},cloud={state:'2',attributes:{data_source:'sigenergy_cloud',observed_at:'2026-10-28T11:50:00Z'}},api={state:'3',attributes:{data_source:'api',observed_at:'2026-10-28T11:59:00Z'}};
  assert.equal(selectReadingState([api,cloud,local],now),local);
  assert.equal(selectReadingState([local,cloud,api],now+100000),cloud);
  assert.equal(selectReadingState([local,cloud,api],now+3600000),undefined);
  local.attributes.available=false;
  assert.equal(selectReadingState([local,api],now),undefined);
  assert.equal(cloud.attributes.observed_at,'2026-10-28T11:50:00Z');
});

test('all Energy Profile destinations render a heading and locked read-only interface', () => {
  assert.equal(ENERGY_ROUTES.length, 21);
  for (const route of ENERGY_ROUTES) {
    const result = render(route);
    assert.ok(result.title && result.body.includes('energy-profile-page'), route);
    assert.doesNotMatch(result.body,/Plant settings are read-only|read-only connection|Captured/,route);
    assert.ok(!/undefined|null|NaN|Infinity|Sample|02:00|05:00/.test(result.body), route);
    assert.ok(!/data-save-settings|data-settings-form|data-execute|<form\b/.test(result.body), route);
  }
  for (const route of ['constructor', '__proto__', 'toString', 'missing']) assert.equal(renderEnergyProfile(route), null);
  assert.ok(ENERGY_STYLE.includes('@container'));
});

test('grid connection accepts explicit connectivity only and offers the opposite locked action', () => {
  for (const state of ['On Grid', 'on_grid', 'On-Grid', 'Grid Mode']) {
    assert.equal(gridConnectionStatus({state}), 'on_grid');
    const html = body('grid_connection', {}, {state:()=>({state})});
    assert.match(html, /disabled>Go off Grid<\/button>/);
    assert.doesNotMatch(html, /Go on Grid/);
  }
  for (const state of ['Off Grid', 'off_grid', 'Off-Grid Mode']) {
    assert.equal(gridConnectionStatus({state}), 'off_grid');
    assert.match(body('grid_connection', {}, {state:()=>({state})}), /disabled>Go on Grid<\/button>/);
  }
  for (const state of ['unknown', 'unavailable', 'Importing', 'Exporting', 'Normal', '', '0', '1', '<unsafe>']) {
    assert.equal(gridConnectionStatus({state}), null);
    assert.doesNotMatch(body('grid_connection', {}, {state:()=>({state})}), /Go (on|off) Grid|<unsafe>/);
  }
  assert.equal(gridConnectionStatus({state:'On Grid',attributes:{available:false}}),null);
  assert.equal(gridConnectionStatus(null),null);
  assert.doesNotMatch(body('grid_connection', {source_observed_at:'2026-10-01T12:00:00Z'}, {state:()=>({state:'On Grid'})}), /Captured|2026-10-01/);
});

test('hub includes every observed group and existing route without inventing a personal strategy', () => {
  const result = body('energy_profile');
  for (const title of ['My Energy Profile', 'Grid Settings', 'Battery Settings', 'Solar Settings', 'Load Usage Preference', 'Backup Settings', 'Other']) assert.ok((title === 'My Energy Profile' ? render('energy_profile').title : result).includes(title));
  for (const label of ['Current Mode', 'Personal Strategies', 'Add Personal Strategy', 'Instant Manual Control', 'Grid Export Power Limit', 'Grid Import Power Limit', 'Max Grid Connection Current', 'Block Battery Grid Export', 'Peak Shaving', 'Tariff Plan', 'Grid Automation', 'Charging Source Priority', 'Battery Discharging Priority', 'Battery Level Settings', 'Preheating Scheduling', 'Battery Power Limit', 'Battery Automation', 'Solar Producing Source Priority', 'Solar Producing Power Limit', 'EVAC Settings', 'EVDC Settings', 'Backup Reserve', 'Backup History', 'Backup Event Center', 'Energy Saving Mode', 'Virtual Battery Allocation for Aggregator']) assert.ok(result.includes(label), label);
  for (const route of ['mode', 'strategies', 'strategy', 'priority', 'tariffs']) assert.ok(result.includes(`data-detail="${route}"`));
  assert.ok(result.includes('data-detail="manual_control"'));
  assert.ok(!result.includes('Preference 01') && !result.includes('SOC &lt; 40%'));
});

test('Instant Manual Control offers every existing preview action before selecting one', () => {
  const result = body('manual_control', {}, {controlPermission:true});
  for (const mode of ['charge','discharge','hold','self_consumption']) assert.ok(result.includes(`data-manual="${mode}"`));
  assert.ok(!/data-execute|data-service|<form\b/.test(result));
});

test('mode comes from supplied profile or recognized textual cached state, never numeric codes', () => {
  assert.ok(body('energy_profile', { current_mode: 'Sigen AI Mode' }).includes('Sigen AI Mode'));
  assert.ok(body('energy_profile', {}, { state: key => key === 'cloud_mode' ? { state: 'Self Consumption' } : null }).includes('Self Consumption'));
  for (const invalid of ['unavailable', 'unknown', '3', '']) {
    const result = body('energy_profile', {}, { state: () => ({ state: invalid }) });
    assert.ok(result.includes('<small>—</small>'));
    assert.ok(!result.includes('Self Consumption'));
  }
});

test('AC and DC destinations use inventory type with opaque IDs and no guessed charger', () => {
  const inventory = [{ id: 'a-opaque', type: 'dc', name: 'DC charger' }, { id: 'dc-in-name-only', type: 'ac', name: 'AC charger' }];
  const result = body('energy_profile', {}, { inventory });
  assert.ok(result.includes('data-detail="ac_more" data-id="dc-in-name-only"'));
  assert.ok(result.includes('data-detail="dc_more" data-id="a-opaque"'));
  assert.ok(!body('energy_profile').includes('data-detail="ac_more"'));
  const multiple = body('energy_profile', {}, { inventory: [{ id: 'one', type: 'ac', name: 'First' }, { id: 'two', type: 'ac', name: 'Second' }] });
  assert.ok(multiple.includes('EVAC Settings · First') && multiple.includes('EVAC Settings · Second'));
  assert.ok(!body('energy_profile', {}, { inventory, id: 'unmatched-plant' }).includes('data-detail="ac_more"'));
  assert.ok(body('energy_profile', {}, { inventory: [{ id: 'opaque', type: 'ac', plant_id: 'p' }], id: 'p' }).includes('data-detail="ac_more" data-id="opaque"'));
});

test('grid limits keep unknown distinct from explicitly disabled and accept a real zero-export limit', () => {
  const unknown = body('grid_export_limit');
  assert.ok(unknown.includes('energy-profile-toggle-value">—'));
  assert.ok(!unknown.includes('type="checkbox"'));
  const result = body('grid_export_limit', { grid_export_limit: { enabled: false, limit_kw: '0' } });
  assert.ok(result.includes('Disabled') && result.includes('value="0 kW"'));
  assert.ok(result.includes('type="checkbox"') && !result.includes('disabled checked'));
  const current = body('grid_connection_current', { grid_connection_current: { enabled: true, limit_a: 63 } });
  assert.ok(current.includes('disabled checked') && current.includes('63 A'));
  assert.ok(!body('grid_import_limit', { grid_import_limit: { enabled: 'false', limit_kw: true } }).includes('value="1 kW"'));
});

test('all numeric settings reject booleans, nonfinite, negatives and unbounded sentinel values', () => {
  for (const invalid of [true, false, '', 'bad', 'NaN', Infinity, -1, 4294967.295, '4294967.295']) {
    const result = body('battery_power_limit', { battery_power_limit: { charge_kw: invalid, discharge_kw: invalid } });
    assert.equal((result.match(/value="—"/g) ?? []).length, 2, String(invalid));
  }
  const valid = body('battery_power_limit', { battery_power_limit: { charge_kw: '5.5', discharge_kw: 4 } });
  assert.ok(valid.includes('5.5 kW') && valid.includes('4 kW'));
  assert.ok(!valid.includes('Depends on system'));
  const max = body('battery_power_limit', { battery_power_limit: { charge_system_max: true, discharge_system_max: true } });
  assert.equal((max.match(/value="Depends on system"/g) ?? []).length, 2);
  assert.ok(body('solar_power_limit', { solar_power_limit: { system_max: true } }).includes('Depends on system'));
});

test('battery and backup SOCs have no defaults and stay within 0–100 percent', () => {
  const valid = body('battery_levels', { battery_levels: { charge_cutoff_soc: '100', backup_soc: 0, discharge_cutoff_soc: 5 } });
  for (const value of ['100 %', '0 %', '5 %']) assert.ok(valid.includes(value));
  assert.equal((body('battery_levels', { battery_levels: { charge_cutoff_soc: 101, backup_soc: true, discharge_cutoff_soc: -1 } }).match(/<strong>—<\/strong>/g) ?? []).length, 3);
  assert.ok(body('backup_reserve', { backup_reserve: { soc: '75' } }).includes('75 %'));
  assert.ok(!body('backup_reserve').includes('100 %'));
});

test('priorities display only explicit unique known destinations', () => {
  assert.ok(body('charging_source_priority', { charging_source_priority: { order: ['solar', 'evdc', 'grid'] } }).includes('<li>Solar</li><li>EVDC</li><li>GRID</li>'));
  assert.ok(body('solar_source_priority').includes('Priority unavailable.'));
  for (const order of [['solar', 'solar'], ['unknown'], ['constructor']]) assert.ok(body('solar_source_priority', { solar_source_priority: { order } }).includes('Priority unavailable.'));
});

test('preheating schedules render supplied weekday windows, including overnight, without example times', () => {
  const result = body('battery_preheating', { battery_preheating: { enabled: true, schedules: [{ start: '23:15', end: '00:45', weekdays: ['mon', 'fri'] }] } });
  assert.ok(result.includes('23:15–00:45') && result.includes('Mon, Fri'));
  assert.ok(!body('battery_preheating').includes('23:15'));
  for (const schedule of [{ start: '25:00', end: '01:00', weekdays: ['mon'] }, { start: '23:00', end: '01:00', weekdays: ['constructor'] }]) assert.ok(body('battery_preheating', { battery_preheating: { schedules: [schedule] } }).includes('Schedule unavailable.'));
});

test('backup history uses supplied aware event timestamps and explicit totals without fabricating empty history', () => {
  const backup_history = { available: true, total_duration_seconds: 220, total_events: 2, events: [{ started_at: '2024-06-12T08:14:00+01:00', duration_seconds: 40 }, { started_at: '2024-06-11T12:00:00+01:00', duration_seconds: 180 }] };
  const result = body('backup_history', { backup_history });
  for (const value of ['3min 40s', '40s', '3min', '2024-06-12T08:14:00+01:00']) assert.ok(result.includes(value));
  assert.ok(!body('backup_history').includes('No events.'));
  assert.ok(body('backup_history', { backup_history: { available: true, events: [] } }).includes('No events.'));
  const invalid = body('backup_history', { backup_history: { total_events: true, events: [{ started_at: '2024-06-12T08:14:00', duration_seconds: 40 }, { started_at: '2024-06-12T08:14:00Z', duration_seconds: 1.5 }] } });
  assert.ok(!invalid.includes('<article>') && invalid.includes('History unavailable.'));
});

test('energy saving choices are inert even if host supplies control permission', () => {
  const result = body('energy_saving', { energy_saving: { mode: 'performance', dormancy_enabled: false } }, { controlPermission: true });
  assert.ok(result.includes('Performance Mode') && result.includes('Disabled'));
  assert.ok(result.includes('disabled>Yes, enter dormancy mode.'));
  assert.ok(result.includes('disabled>No, keep the battery active.'));
  assert.ok(!/data-manual|data-save|data-execute|data-service/.test(result));
  assert.ok(!body('energy_saving').includes('value="Performance Mode"'));
});

test('unavailable event center and aggregator expose honest missing values without invented allocation fields', () => {
  const result = body('backup_events', { backup_events: { available: false, reason: 'Request failed.' } });
  assert.ok(result.includes('Request failed.') && result.includes('History unavailable.'));
  const allocation = body('aggregator_allocation');
  assert.ok(allocation.includes('value="—"') && allocation.includes('Allocation details unavailable.'));
  assert.ok(!/capacity|kWh|VPP|allocation_percent/.test(allocation));
});

test('explicit plant selection does not borrow a different plant or global mode reading', () => {
  const data = { plant_id: 'plant-one', grid_export_limit: { enabled: true, limit_kw: 6 } };
  const inventory = [{ id: 'plant-one', type: 'plant' }, { id: 'plant-two', type: 'plant' }];
  assert.ok(body('grid_export_limit', data, { id: 'plant-one', inventory }).includes('6 kW'));
  for (const id of ['missing', 'plant-two']) assert.ok(!body('grid_export_limit', data, { id, inventory }).includes('6 kW'));
  assert.ok(!body('energy_profile', data, { id: 'missing', inventory, state: () => ({ state: 'Sigen AI Mode' }) }).includes('Sigen AI Mode'));
  assert.ok(!body('energy_profile', data, { id: 'plant-one', inventory, state: () => ({ state: 'Global mode' }) }).includes('Global mode'));
  const perPlant = { plants: { 'plant-two': { battery_levels: { backup_soc: 30 } } } };
  assert.ok(body('battery_levels', perPlant, { id: 'plant-two', inventory }).includes('30 %'));
  assert.ok(!body('battery_levels', perPlant, { id: 'missing', inventory }).includes('30 %'));
});

test('settings omit capture timestamps while preserving real event history', () => {
  const observed = '2026-10-27T02:30:00Z';
  const result = body('grid_import_limit', { source_observed_at: observed }, { now: Date.parse('2026-10-28T00:00:00Z') });
  assert.ok(!result.includes(observed));
  assert.ok(!result.includes('2026-10-28'));
  assert.ok(!body('grid_import_limit', { source_observed_at: '2026-10-27T02:30:00' }).includes('<time'));
  assert.ok(!body('grid_import_limit').includes('<time'));
});

test('all supplied labels, IDs and reasons are HTML-escaped and module has no data-access path', async () => {
  const attack = '"><img src=x onerror="alert(1)">';
  const result = body('energy_profile', { current_mode: attack }, { inventory: [{ id: attack, name: attack, type: 'ac' }] });
  assert.ok(result.includes('&lt;img') && !result.includes('<img'));
  assert.ok(!body('backup_events', { backup_events: { available: false, reason: attack } }).includes('<img'));
  const source = await readFile(new URL('../custom_components/sigen_hybrid/frontend/sigen-hybrid-energy.js', import.meta.url), 'utf8');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|callService|callWS|localStorage|sessionStorage|import\s*\(/.test(source));
  assert.ok(!/^import\s/m.test(source));
});
