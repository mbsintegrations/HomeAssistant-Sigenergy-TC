import test from 'node:test';
import { modeChoices, selectedMode } from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-settings.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SETTINGS_ROUTES, CHARGER_MORE_ROUTES, SETTINGS_STYLE, renderSettingsDetail, collectSettings, validateSettings, DISPLAY_MODULES, DISPLAY_PRESETS, displayDefaults, encodeChargerScheduleId, decodeChargerScheduleId, TARIFF_MAX_PERIODS, tariffTimetableModel, renderTariffTimetable, renderTariffPeriod, validateTariffPeriods, convertTariffPrice, strategyExportEligibility, bindStrategyEditor, OPERATING_MODES, observedOperatingMode, renderOverviewModeControl, HOMEPAGE_APPEARANCES, HOMEPAGE_BACKGROUNDS, homepageBackground, validatedBackgroundURL } from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-settings.js';

const states = {
  cloud_mode: { state: 'Sigen_AI_Mode' }, native_mode: { state: 'self_consumption' },
  cloud_status: { state: 'disabled' }, forecast_status: { state: 'Forecast.Solar' },
};
const CHARGERS = [{ id: 'ac', type: 'ac', name: 'AC charger' }, { id: 'dc', type: 'dc', name: 'DC charger' }];
const ctx = { inventory: CHARGERS, now: new Date('2026-10-27T00:48:00Z'), timezone: 'Europe/Dublin', state: key => states[key], value: (key, quantity) => ({ battery_soc: quantity === 'soc' ? 8.8 : null, forecast_today: 11.5, forecast_tomorrow: 8.2, solar_today: 5.05 })[key] ?? null, interfaceOptions: {} };
const tariff = extra => ({ name: 'My tariff', currency: 'EUR', unit: 'cent', timezone: 'Europe/Dublin', base_price: '30', ...extra });
const strategy = extra => ({ name: 'Owner plan', weekdays: 'mon,tue,wed,thu,fri,sat,sun', start: '08:00', end: '01:00', condition: 'above', soc: '75', action: 'export', export_kw:'3', priority: '50', ...extra });
const OTHER_ROUTES = new Set(['energy_profile', 'system_about', 'software_update', 'warranty', 'system_share', 'data_download', 'modbus_server', 'sigen_care', 'diagnosis', 'alerts', 'support_history','devices','service','search']);

test('overview mode displays the observed plant mode rather than a saved preference', () => {
  const context = {...ctx, interfaceOptions:{mode:{mode:'tou',local_only:true}}};
  const before = JSON.stringify(context.interfaceOptions), html = renderOverviewModeControl(context);
  assert.equal(observedOperatingMode(context),'sigen_ai');
  assert.match(html,/data-overview-mode aria-label="Current mode"/);
  assert.match(html,/value="sigen_ai" selected>Sigen AI Mode/);
  assert.doesNotMatch(html,/value="tou" selected/);
  assert.equal((html.match(/<option /g)??[]).length,OPERATING_MODES.length);
  assert.equal(JSON.stringify(context.interfaceOptions),before);
  const unknown={...context,state:()=>({state:'An unknown mode <unsafe>'})};
  assert.equal(observedOperatingMode(unknown),'');
  assert.match(renderOverviewModeControl(unknown),/value="" selected disabled>Unavailable/);
  assert.doesNotMatch(renderOverviewModeControl(unknown),/<unsafe>/);
  assert.equal(observedOperatingMode({...context,state:key=>key==='cloud_mode'?{state:'Sigen AI Mode',attributes:{available:false}}:{state:'time_of_use'}}),'tou');
});

test('all settings routes render a meaningful view and local navigation has no unknown target', () => {
  assert.equal(SETTINGS_ROUTES.length, 57);
  for (const route of SETTINGS_ROUTES) {
    const page = renderSettingsDetail(route, ctx);
    assert.equal(typeof page.title, 'string', route);
    assert.ok(page.body.length > 140, route);
    assert.ok(page.body.includes(`data-settings-route="${route}"`), route);
    for (const [, target] of page.body.matchAll(/data-detail="([^"]+)"/g)) assert.ok(SETTINGS_ROUTES.includes(target) || OTHER_ROUTES.has(target), `${route} → ${target}`);
    for (const [, form] of page.body.matchAll(/data-settings-form="([^"]+)"/g)) {
      assert.ok(page.body.includes(`data-save-settings="${form}"`), form);
      assert.ok(page.body.includes('data-detail-back'), form);
    }
  }
  assert.equal(renderSettingsDetail('some-other-module', ctx), null);
});

test('chart customization saves individual choices locally and rejects unknown or duplicate kinds',()=>{
  const draft=collectSettings('chart_settings',{selected:['load','strings','dc_voltage']},ctx);
  assert.deepEqual(draft.selected,['load','strings','dc_voltage']);assert.equal(draft.local_only,true);
  assert.deepEqual(collectSettings('chart_settings',{},ctx).selected,[]);
  assert.throws(()=>collectSettings('chart_settings',{selected:['unknown']},ctx));
  assert.throws(()=>collectSettings('chart_settings',{selected:['solar','solar']},ctx));
  const page=renderSettingsDetail('chart_settings',ctx);
  for(const kind of ['load','strings','pv_metrics','dc_metrics','dc_voltage'])assert.ok(page.body.includes(`value="${kind}"`));
});

test('visible settings branding is Sigenergy TC and names Total Control',()=>{
  const about=renderSettingsDetail('about',ctx);
  assert.equal(about.subtitle,'Sigenergy TC');
  assert.equal(about.title,'About Sigenergy TC');assert.match(about.body,/Sigenergy TC \(Total Control\)/);
  assert.doesNotMatch(about.body,/Sigenergy Hybrid/);
});

test('My Car charging-mode link follows the actual DC device identity instead of a hardcoded type',()=>{
  const inventory=[{id:'opaque-ac-device',type:'ac'},{serial_number:'opaque-dc-device',type:'dc'}],page=renderSettingsDetail('vehicles',{...ctx,inventory});
  assert.ok(page.body.includes('data-detail="charging_mode" data-id="opaque-dc-device"'));
  const mode=renderSettingsDetail('charging_mode',{...ctx,inventory,id:'opaque-dc-device'});
  assert.match(mode.title,/DC Charging Mode/);assert.ok(mode.body.includes('value="v2x"'));
  const missing=renderSettingsDetail('vehicles',{...ctx,inventory:[]}).body;
  assert.ok(missing.includes('disabled aria-disabled="true">DC charging mode</button>'));
  const multiple=renderSettingsDetail('vehicles',{...ctx,inventory:[...inventory,{id:'second-dc',type:'dc'}]}).body;
  assert.ok(multiple.includes('data-detail="devices"')&&multiple.includes('Choose a DC charger'));
});

test('current values retain explicit unavailable state and never invent capacity, revenue or savings', () => {
  assert.match(renderSettingsDetail('mode', ctx).body, /Sigen AI Mode/);
  assert.match(renderSettingsDetail('mode', ctx).body, /self consumption/);
  assert.match(renderSettingsDetail('forecast_settings', ctx).body, /11\.5 kWh/);
  assert.match(renderSettingsDetail('safety', ctx).body, /8\.8%/);
  for (const route of ['energy_value', 'environment', 'charger_records']) assert.match(renderSettingsDetail(route, {}).body, /—/);
  assert.doesNotMatch(renderSettingsDetail('energy_value', ctx).body, /8\.15|47\.04|revenue.*\d/i);
  assert.match(renderSettingsDetail('connections', ctx).body, /Disabled/);
});

test('all dynamic text and attributes are escaped, including draft IDs and telemetry', () => {
  const attack = '"><img src=x onerror=alert(1)>';
  const hostile = { ...ctx, id: attack, config: { title: attack }, state: () => ({ state: attack }), interfaceOptions: { vehicle: { [attack]: { brand: attack, model: attack } }, strategy: { [attack]: { name: attack } }, pv_brand: { brand: attack }, ai: { request: '</textarea><script>bad()</script>' } } };
  for (const route of SETTINGS_ROUTES) {
    const html = renderSettingsDetail(route, hostile).body;
    assert.doesNotMatch(html, /<img|<script|onerror=alert\(1\)>/i, route);
  }
  assert.match(renderSettingsDetail('ai', hostile).body, /&lt;\/textarea&gt;/);
  assert.match(renderSettingsDetail('pv_brand', hostile).body, /&quot;&gt;&lt;img/);
});

test('plant command controls stay disabled even if a caller claims control permission', () => {
  for (const route of ['mode', 'priority', 'charging_mode', 'charger_schedule']) {
    const html = renderSettingsDetail(route, { ...ctx, controlPermission: true }).body;
    assert.match(html, /class="settings-apply" disabled aria-disabled="true"/);
    assert.doesNotMatch(html, /data-(?:apply|start|stop|execute)-/);
    assert.doesNotMatch(html, /Plant controls are locked/);
  }
});

test('module has no cloud, HA service, credential or network execution path', async () => {
  const source = await readFile(new URL('../custom_components/sigen_hybrid/frontend/sigen-hybrid-settings.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|callService|callWS|access_token|type="password"/);
  assert.match(SETTINGS_STYLE, /max-width:600px/);
  assert.match(SETTINGS_STYLE, /min-width:1600px/);
});

test('tariff accepts negative prices, cents and an overnight weekday window', () => {
  const draft = collectSettings('tariff_edit', tariff({ window_0_weekdays: 'mon,tue', window_0_start: '23:00', window_0_end: '05:00', window_0_price: '-2.5' }), { id: 'export' });
  assert.deepEqual(draft, { route: 'tariff_edit', local_only: true, id: 'export', name: 'My tariff', currency: 'EUR', unit: 'cent', timezone: 'Europe/Dublin', base_price: 30, base_price_per_kwh: .3, windows: [{ start: '23:00', end: '05:00', overnight: true, weekdays: ['mon', 'tue'], price: -2.5, price_per_kwh: -.025 }] });
  assert.equal(collectSettings('tariff_edit', tariff({ unit: 'major', base_price: '-0.01' }), {}).base_price_per_kwh, -.01);
});

test('flat tariffs start simple and keep one compact period editor outside the main draft form',()=>{
  const page=renderSettingsDetail('tariff_edit',{...ctx,currency:'GBP',id:'import'}).body;
  assert.match(page,/name="tariff_type"[^>]*data-tariff-type/);
  assert.match(page,/value="flat" selected/);
  assert.match(page,/value="GBP" selected/);
  assert.match(page,/value="cent" selected/);
  assert.match(page,/<fieldset class="tariff-periods" data-tariff-periods hidden disabled>/);
  assert.equal((page.match(/data-tariff-period="/g)??[]).length,0);
  assert.equal((page.match(/data-tariff-editor aria-label="Time period"/g)??[]).length,1);
  assert.match(page,/<\/form><dialog class="tariff-period-dialog"/);
  assert.match(page,/<details class="tariff-advanced"><summary>Advanced<\/summary>/);
  assert.doesNotMatch(page,/class="settings-window"|optional<\/summary>|Leave unused windows blank/);
});

test('seven existing rates render seven concise rows and clickable weekly blocks without blank optional editors',()=>{
  const windows=['mon','tue','wed','thu','fri','sat','sun'].map((day,index)=>({weekdays:[day],start:'02:00',end:'05:00',price:9+index}));
  const page=renderSettingsDetail('tariff_edit',{...ctx,id:'import',interfaceOptions:{tariff_edit:{import:{name:'Owner plan',currency:'EUR',unit:'cent',timezone:'Europe/Dublin',base_price:30,windows}}}}).body;
  assert.match(page,/value="tou" selected/);
  assert.equal((page.match(/class="tariff-period-row"/g)??[]).length,7);
  assert.equal((page.match(/class="tariff-time-block"/g)??[]).length,7);
  assert.equal((page.match(/data-tariff-editor aria-label="Time period"/g)??[]).length,1);
  assert.match(page,/24:00/);
  assert.match(page,/name="window_6_price" value="15"/);
  assert.match(page,/name="name" value="Owner plan"/);
  assert.match(page,/name="timezone" value="Europe\/Dublin"/);
});

test('time-of-use editing supports twenty-four periods while the stored model and legacy validation remain unchanged',()=>{
  const input=tariff({tariff_type:'tou'}),windows=[];
  for(let i=0;i<24;i++){const start=String(i).padStart(2,'0')+':00',end=i===23?'23:59':String(i+1).padStart(2,'0')+':00';Object.assign(input,{[`window_${i}_start`]:start,[`window_${i}_end`]:end,[`window_${i}_price`]:i,[`window_${i}_weekdays`]:['mon']});windows.push({start,end,price:i,weekdays:['mon']});}
  const saved=collectSettings('tariff_edit',input,{id:'import'});
  assert.equal(TARIFF_MAX_PERIODS,24);assert.equal(saved.windows.length,24);assert.equal(saved.windows[23].price_per_kwh,.23);
  assert.ok(!Object.hasOwn(saved,'tariff_type'));
  assert.throws(()=>validateTariffPeriods([...windows,windows[0]],'cent'),/no more than 24/);
  const page=renderSettingsDetail('tariff_edit',{...ctx,id:'import',interfaceOptions:{tariff_edit:{import:saved}}}).body;
  assert.equal((page.match(/class="tariff-period-row"/g)??[]).length,24);
  assert.match(page,/data-tariff-add disabled/);
  assert.throws(()=>renderTariffPeriod(24,{}),/index/);
});

test('flat-rate selection intentionally clears periods and TOU needs an explicit valid period',()=>{
  const flat=collectSettings('tariff_edit',tariff({tariff_type:'flat',window_0_start:'bad',window_0_end:'bad',window_0_price:'bad'}));
  assert.deepEqual(flat.windows,[]);
  assert.throws(()=>collectSettings('tariff_edit',tariff({tariff_type:'tou'})),/Add at least one time period/);
  assert.throws(()=>collectSettings('tariff_edit',tariff({tariff_type:'guessed'})),/Rate type/);
  const defaults=collectSettings('tariff_edit',{base_price:9.96},{currency:'GBP',timezone:'Europe/London'});
  assert.equal(defaults.currency,'GBP');assert.equal(defaults.timezone,'Europe/London');assert.equal(defaults.unit,'cent');assert.ok(Math.abs(defaults.base_price_per_kwh-.0996)<1e-12);
});

test('weekly timetable segments overnight periods onto the next day including Sunday to Monday',()=>{
  const periods=[{start:'23:00',end:'05:00',weekdays:['sun'],price:-2}];
  assert.deepEqual(tariffTimetableModel(periods),[{index:0,day:6,start:1380,end:1440,price:-2},{index:0,day:0,start:0,end:300,price:-2}]);
  const sparse=tariffTimetableModel(periods,[8]);assert.equal(sparse[0].index,8);assert.equal(sparse[1].index,8);
  const graph=renderTariffTimetable(periods,{unit:'cent',currency:'EUR',indices:[8]});
  assert.equal((graph.match(/data-tariff-edit="8"/g)??[]).length,2);
  assert.match(graph,/-2/);assert.match(graph,/cent\/kWh/);
  assert.deepEqual(tariffTimetableModel([{start:'bad',end:'05:00',weekdays:['sun'],price:9}]),[]);
});

test('switching between cents and major currency keeps each monetary rate unchanged',()=>{
  assert.equal(convertTariffPrice(9.96,'cent','major'),.0996);
  assert.equal(convertTariffPrice(.0996,'major','cent'),9.96);
  assert.equal(convertTariffPrice(-.02,'major','cent'),-2);
  assert.equal(convertTariffPrice(0,'cent','major'),0);
  assert.equal(convertTariffPrice('','cent','major'),null);
  assert.equal(convertTariffPrice(false,'cent','major'),null);
  assert.throws(()=>convertTariffPrice(9,'unknown','major'),/Price unit/);
});

test('period summaries and timeline labels escape supplied prices, times and currency without new commands',()=>{
  const row=renderTariffPeriod(2,{start:'<img>',end:'05:00',price:'bad',weekdays:['mon']},{unit:'major',currency:'"><script>'});
  assert.doesNotMatch(row,/<img>|<script>/);assert.match(row,/name="window_2_start" value="&lt;img&gt;"/);
  const plot=renderTariffTimetable([{start:'02:00',end:'05:00',price:9,weekdays:['mon']}],{unit:'major',currency:'"><script>'});
  assert.doesNotMatch(plot,/<script>/);assert.match(plot,/&quot;&gt;&lt;script&gt;/);
  assert.doesNotMatch(row+plot,/data-service=|data-action=|data-execute=/);
});

test('tariff windows reject overlap across midnight and the Sunday/Monday boundary', () => {
  const first = { window_0_weekdays: 'sun', window_0_start: '23:00', window_0_end: '05:00', window_0_price: '9' };
  assert.throws(() => collectSettings('tariff_edit', tariff({ ...first, window_1_weekdays: 'mon', window_1_start: '04:00', window_1_end: '06:00', window_1_price: '12' })), /overlap/);
  const adjacent = collectSettings('tariff_edit', tariff({ ...first, window_1_weekdays: 'mon', window_1_start: '05:00', window_1_end: '06:00', window_1_price: '12' }));
  assert.equal(adjacent.windows.length, 2);
  assert.throws(() => collectSettings('tariff_edit', tariff({ ...first, window_1_weekdays: 'sun', window_1_start: '23:00', window_1_end: '00:00', window_1_price: '12' })), /overlap/);
});

test('tariff validation rejects malformed time, missing price, invalid day and timezone', () => {
  for (const extra of [
    { timezone: 'Mars/Olympus' }, { currency: '<x>' }, { unit: 'guessed' }, { base_price: Infinity },
    { window_0_start: '25:00', window_0_end: '02:00', window_0_price: '3', window_0_weekdays: 'mon' },
    { window_0_start: '02:00', window_0_end: '05:00', window_0_price: '', window_0_weekdays: 'mon' },
    { window_0_start: '02:00', window_0_end: '05:00', window_0_price: '3', window_0_weekdays: 'holiday' },
    { window_0_start: '02:00', window_0_end: '02:00', window_0_price: '3', window_0_weekdays: 'mon' },
    { window_0_start: '02:00', window_0_end: '05:00', window_0_price: '3', window_0_weekdays: 'mon,mon' },
  ]) assert.throws(() => collectSettings('tariff_edit', tariff(extra)));
});

test('strategy stores overnight SOC rule as an inert draft and preserves explicit owner selection', () => {
  const draft = collectSettings('strategy', strategy({ enabled: 'on' }), { id: 'day-solar' });
  assert.equal(draft.local_only, true); assert.equal(draft.id, 'day-solar');
  assert.equal(draft.overnight, true); assert.equal(draft.soc, 75); assert.equal(draft.action, 'export'); assert.equal(draft.enabled, true);
  assert.equal(draft.end, '01:00'); assert.equal(draft.start, '08:00');
  assert.equal(collectSettings('strategy', strategy({ condition: 'none', soc: '' })).soc, null);
});

test('strategy rejects invalid thresholds, fractional priority, invented commands and object IDs', () => {
  for (const extra of [{ soc: 101 }, { soc: true }, { priority: '1.5' }, { action: 'off_grid' }, { condition: 'approximately' }, { name: '' }, { weekdays: 'mon,,tue' }, { start: '24:00' }]) assert.throws(() => collectSettings('strategy', strategy(extra)));
  assert.throws(() => collectSettings('strategy', strategy(), { id: '__proto__/bad' }));
});

test('battery-to-grid export is distinct from solar export and discharge to home in persisted strategy intent',()=>{
  const allowed={state:key=>key==='export_permitted'?{state:'on'}:undefined};
  const battery=collectSettings('strategy',strategy({action:'battery_export',enabled:true,export_requested:false}),allowed);
  assert.equal(battery.action,'battery_export');assert.equal(battery.export_requested,true);assert.equal(battery.export_source,'battery');assert.equal(battery.enabled,true);assert.equal(battery.local_only,true);
  const solar=collectSettings('strategy',strategy({action:'export',enabled:true}));
  assert.equal(solar.export_requested,true);assert.equal(solar.export_source,'solar');
  const home=collectSettings('strategy',strategy({action:'discharge',export_requested:true}));
  assert.equal(home.export_requested,false);assert.ok(!Object.hasOwn(home,'export_source'));
  const page=renderSettingsDetail('strategy',allowed).body;
  assert.match(page,/<option value="battery_export">Battery discharge to export<\/option>/);
  assert.match(page,/<option value="export">Allow solar export<\/option>/);
  assert.match(page,/class="settings-apply" disabled/);
});

test('battery export can be saved as a future inactive draft but cannot join the plan with permission off or unknown',()=>{
  for(const permission of ['off','unknown',undefined]){
    const context={state:key=>key==='export_permitted'&&permission!==undefined?{state:permission}:undefined};
    const draft=collectSettings('strategy',strategy({action:'battery_export',enabled:false}),context);
    assert.equal(draft.action,'battery_export');assert.equal(draft.enabled,false);assert.equal(draft.export_requested,true);
    assert.throws(()=>collectSettings('strategy',strategy({action:'battery_export',enabled:true}),context),/inactive draft/);
    const body=renderSettingsDetail('strategy',{...context,interfaceOptions:{strategy:{action:'battery_export',enabled:true}}}).body;
    assert.match(body,/name="enabled" disabled/);assert.doesNotMatch(body,/name="enabled" checked/);
  }
});

test('most restrictive export approval and the native battery-export block take precedence over allowed labels',()=>{
  const allowed={state:key=>key==='export_permitted'?{state:'on'}:undefined};
  assert.equal(strategyExportEligibility(allowed).allowed,true);
  assert.equal(strategyExportEligibility({...allowed,config:{export_permitted:false}}).allowed,false);
  const backendOff={state:key=>key==='export_permitted'?{state:'on'}:key==='control_status'?{attributes:{export_permitted:false}}:undefined};
  assert.equal(strategyExportEligibility(backendOff).permitted,false);
  const blocked={...allowed,config:{energy_profile:{block_battery_export:{enabled:true}}}};
  assert.equal(strategyExportEligibility(blocked).battery_blocked,true);
  assert.throws(()=>collectSettings('strategy',strategy({action:'battery_export',enabled:true}),blocked),/Block Battery Grid Export/);
  assert.equal(strategyExportEligibility({...allowed,config:{capabilities:{battery_export:false}}}).allowed,false);
  assert.equal(strategyExportEligibility({interfaceOptions:{safety:{export_requested:true}}}).allowed,false);
});

test('strategy action switching disables restricted export inclusion without losing the previous ordinary-plan choice',()=>{
  const listeners={},action={value:'charge',addEventListener:(type,fn)=>{listeners[type]=fn;}},enabled={checked:true,disabled:false},notice={hidden:true,textContent:''};
  const form={querySelector:selector=>selector==='[data-strategy-action]'?action:selector==='[name="enabled"]'?enabled:selector==='[data-strategy-export-note]'?notice:null};
  bindStrategyEditor(form,{state:key=>key==='export_permitted'?{state:'off'}:undefined});
  assert.equal(enabled.disabled,false);assert.equal(enabled.checked,true);assert.equal(notice.hidden,true);
  action.value='battery_export';listeners.change();assert.equal(enabled.disabled,true);assert.equal(enabled.checked,false);assert.equal(notice.hidden,false);assert.match(notice.textContent,/Export permission is off/);
  action.value='hold';listeners.change();assert.equal(enabled.disabled,false);assert.equal(enabled.checked,true);assert.equal(notice.hidden,true);
});

test('AC and DC modes use verified choices and V2X cannot be selected for AC', () => {
  const common = { mode: 'v2x', cutoff_soc: '', stop_discharging_soc: 20, discharge_power_kw: 25 };
  assert.throws(() => collectSettings('charging_mode', common, { id: 'ac', inventory: CHARGERS }));
  const dc = collectSettings('charging_mode', common, { id: 'dc', inventory: CHARGERS });
  assert.equal(dc.id, 'dc'); assert.equal(dc.discharge_power_kw, 25); assert.equal(dc.stop_discharging_soc, 20);
  assert.match(renderSettingsDetail('charging_mode', { ...ctx, id: 'dc' }).body, /Bi-directional V2X/);
  assert.doesNotMatch(renderSettingsDetail('charging_mode', { ...ctx, id: 'ac' }).body, /Bi-directional V2X/);
  assert.doesNotMatch(renderSettingsDetail('charging_mode', ctx).body, /data-detail="priority"/);
  for (const bad of [19, 100, 20.5, NaN, true]) assert.throws(() => collectSettings('charging_mode', { ...common, stop_discharging_soc: bad }, { id: 'dc', inventory: CHARGERS }));
});

test('charging schedule validates weekdays, mode and an overnight time span', () => {
  const schedule = collectSettings('charger_schedule', { name: 'Night', weekdays: 'sat,sun', start: '23:00', end: '05:00', mode: 'fast' }, { id: 'ac', inventory: CHARGERS });
  assert.equal(schedule.overnight, true); assert.deepEqual(schedule.weekdays, ['sat', 'sun']);
  assert.throws(() => collectSettings('charger_schedule', { name: 'Night', weekdays: 'sat', start: '23:00', end: '23:00', mode: 'fast' }));
});

test('charging schedules list and Add keep several drafts scoped to opaque charger identities', () => {
  const charger = 'opaque:wall/charger Ω', first = encodeChargerScheduleId(charger, 'draft-one'), second = encodeChargerScheduleId(charger, 'draft-two');
  const context = { ...ctx, id: charger, inventory: [{ id: charger, type: 'ac' }, { id: 'other', type: 'dc' }], interfaceOptions: { charger_schedule: {
    [first]: { name: 'Weekday', weekdays: ['mon'], start: '23:00', end: '05:00', mode: 'fast' },
    [second]: { name: 'Weekend', weekdays: ['sat'], start: '22:00', end: '06:00', mode: 'pv_surplus' },
    [encodeChargerScheduleId('other', 'draft-one')]: { name: 'Must stay on other charger', start: '01:00', end: '02:00', mode: 'v2x' },
  } } };
  const page = renderSettingsDetail('charger_schedules', context).body;
  assert.ok(page.includes('Weekday') && page.includes('Weekend'));
  assert.ok(page.includes(`data-id="${first}"`) && page.includes(`data-id="${second}"`));
  assert.ok(page.includes(`data-id="${encodeChargerScheduleId(charger, 'new')}"`));
  assert.doesNotMatch(page, /Must stay on other charger|data-save-settings/);
  const restored = renderSettingsDetail('charger_schedule', { ...context, id: second }).body;
  assert.match(restored, /name="name" value="Weekend"/); assert.match(restored, /value="pv_surplus" selected/);
  const input = { name: 'Third plan', weekdays: ['sun'], start: '21:00', end: '03:00', mode: 'fast', enabled: 'on' };
  const saved = collectSettings('charger_schedule', input, { ...context, id: encodeChargerScheduleId(charger, 'draft-three') });
  assert.equal(saved.charger_id, charger); assert.equal(saved.schedule_id, 'draft-three'); assert.equal(saved.id, encodeChargerScheduleId(charger, 'draft-three')); assert.equal(saved.overnight, true); assert.equal(saved.local_only, true);
  assert.throws(() => collectSettings('charger_schedule', input, { ...context, id: encodeChargerScheduleId(charger, 'new') }), /unique schedule/);
});

test('canonical schedule helpers reject malformed or unsafe IDs and preserve opaque device names', () => {
  const id = encodeChargerScheduleId('charger:actual/id', 'draft:1/Ω');
  assert.deepEqual(decodeChargerScheduleId(id), { chargerId: 'charger:actual/id', scheduleId: 'draft:1/Ω' });
  for (const bad of ['charger:%ZZ:one', 'charger:x:__proto__', 'charger:x:', 'charger:x:one:two', 'constructor']) assert.equal(decodeChargerScheduleId(bad), null);
  for (const bad of ['', 'constructor', 'a\n']) assert.throws(() => encodeChargerScheduleId(bad, 'draft'));
  const inventory = [{ id: 'charger:actual:id', type: 'dc' }];
  assert.match(renderSettingsDetail('charger_schedule', { ...ctx, inventory, id: 'charger:actual:id' }).body, /Bi-directional V2X/);
  assert.doesNotMatch(renderSettingsDetail('charger_schedule', { ...ctx, inventory, id: 'charger:%ZZ:new' }).body, /data-settings-form/);
});

test('legacy per-charger schedules remain editable and supplied schedules do not flatten sibling drafts', () => {
  const context = { ...ctx, id: 'ac', interfaceOptions: { charger_schedule: { ac: { name: 'Original plan', start: '20:00', end: '04:00', weekdays: ['fri'], mode: 'fast' } } } };
  const list = renderSettingsDetail('charger_schedules', context).body;
  assert.match(list, /data-detail="charger_schedule" data-id="ac"/);
  assert.match(renderSettingsDetail('charger_schedule', context).body, /value="Original plan"/);
  const source = { ...ctx, id: encodeChargerScheduleId('dc', 'native-one'), config: { charger_schedules: { dc: { available: true, schedules: [{ id: 'native-one', name: 'Supplied plan', start: '10:00', end: '11:00', weekdays: ['tue'], mode: 'v2x' }] } } } };
  const page = renderSettingsDetail('charger_schedule', source).body;
  assert.match(page, /value="Supplied plan"/); assert.match(page, /value="v2x" selected/);
  assert.match(renderSettingsDetail('charger_schedules', { ...ctx, id: 'ac', config: { charger_schedules: { ac: [] } } }).body, /No Schedule/);
  assert.doesNotMatch(renderSettingsDetail('charger_schedules', { ...ctx, id: 'ac' }).body, /No Schedule/);
  assert.match(renderSettingsDetail('charger_schedules', { ...ctx, id: 'ac' }).body, /Plant schedules are unavailable/);
});

test('a fresh scoped schedule has no guessed time or charging mode and cannot use another charger type', () => {
  const id = encodeChargerScheduleId('ac', 'draft-new'), html = renderSettingsDetail('charger_schedule', { ...ctx, id }).body;
  assert.match(html, /name="start" value=""/); assert.match(html, /name="end" value=""/); assert.match(html, /value="" selected>Choose a charging mode/);
  assert.doesNotMatch(html, /02:00|05:00|Bi-directional V2X/);
  assert.throws(() => collectSettings('charger_schedule', { name: 'Wrong mode', start: '12:00', end: '13:00', weekdays: ['mon'], mode: 'v2x' }, { ...ctx, id }));
  assert.doesNotMatch(renderSettingsDetail('charger_schedule', { ...ctx, id: encodeChargerScheduleId('missing', 'draft-new') }).body, /data-settings-form/);
  const data = new FormData(); for (const [key, val] of Object.entries({ name: 'Disabled draft', start: '12:00', end: '13:00', weekdays: 'mon', mode: 'fast' })) data.set(key, val);
  assert.equal(collectSettings('charger_schedule', data, { ...ctx, id }).enabled, false);
});

test('charging records distinguish missing data from an explicitly empty captured period', () => {
  const missing = renderSettingsDetail('charger_records', { ...ctx, id: 'dc' }).body;
  assert.match(missing, /Charging history is unavailable/); assert.doesNotMatch(missing, /No charging record found|0 kWh/);
  const known = renderSettingsDetail('charger_records', { ...ctx, id: 'dc', config: { charging_records: { dc: { available: true, records: [], from: '2026-09-27', to: '2026-10-27', total_charged_kwh: 0, total_discharged_kwh: 0 } } } }).body;
  assert.match(known, /No charging record found/); assert.equal((known.match(/0 kWh/g) ?? []).length, 2);
  assert.match(known, /type="date" value="2026-09-27" data-charger-record-filter="from" data-charger-record-device="dc"/);
  assert.match(known, /value="2026-10-27" data-charger-record-filter="to"/);
  const failed = renderSettingsDetail('charger_records', { ...ctx, id: 'dc', config: { charging_records: { dc: { available: false, records: [], total_charged_kwh: 0 } } } }).body;
  assert.match(failed, /Charging history is unavailable/); assert.doesNotMatch(failed, /No charging record found|0 kWh/);
});

test('record date filters use plant-local dates and only recompute totals from a complete supplied list', () => {
  const records = [
    { id: 'one', started_at: '2026-10-20T23:30:00Z', ended_at: '2026-10-21T01:30:00Z', vehicle: 'Owner car', charged_kwh: 4, discharged_kwh: 1 },
    { id: 'two', started_at: '2026-10-22T10:00:00Z', charged_kwh: 6, discharged_kwh: 2 },
  ];
  const source = { available: true, complete: true, records, total_charged_kwh: 10, total_discharged_kwh: 3 }, context = { ...ctx, id: 'dc', config: { charging_records: { dc: source } } };
  const all = renderSettingsDetail('charger_records', context).body;
  assert.match(all, /10 kWh/); assert.match(all, /3 kWh/); assert.match(all, /value="2026-10-21" data-charger-record-filter="from"/);
  const filtered = renderSettingsDetail('charger_records', { ...context, chargerRecordFilters: { dc: { from: '2026-10-22', to: '2026-10-22' } } }).body;
  assert.doesNotMatch(filtered, /Owner car|10 kWh/); assert.equal((filtered.match(/6 kWh/g) ?? []).length, 2); assert.equal((filtered.match(/2 kWh/g) ?? []).length, 2);
  const partial = renderSettingsDetail('charger_records', { ...context, config: { charging_records: { dc: { ...source, complete: false } } }, chargerRecordFilters: { dc: { from: '2026-10-22', to: '2026-10-22' } } }).body;
  assert.match(partial, /<small>Total charge<\/small><strong>—<\/strong>/);
  assert.match(renderSettingsDetail('charger_records', { ...context, chargerRecordFilters: { dc: { from: '2026-10-23', to: '2026-10-22' } } }).body, /Choose a valid date range/);
});

test('records never borrow a different charger or fabricate invalid energy and ambiguous timestamps', () => {
  const inventory = [{ id: 'other', type: 'ac', charging_records: { records: [{ started_at: '2026-10-21T00:00:00Z', charged_kwh: 99, discharged_kwh: 0 }] } }, { id: 'opaque-dc', type: 'dc' }];
  assert.doesNotMatch(renderSettingsDetail('charger_records', { ...ctx, inventory, id: 'opaque-dc' }).body, /99 kWh/);
  const records = [{ started_at: '2026-10-21T00:00:00', charged_kwh: 9 }, { started_at: '2026-10-21T00:00:00Z', charged_kwh: true, discharged_kwh: -1 }, { charger_id: 'other', started_at: '2026-10-21T00:00:00Z', charged_kwh: 99 }];
  const result = renderSettingsDetail('charger_records', { ...ctx, inventory, id: 'opaque-dc', config: { charging_records: { 'opaque-dc': { complete: true, records, total_charged_kwh: NaN } } } }).body;
  assert.doesNotMatch(result, /99 kWh|9 kWh|1 kWh|NaN|Infinity/);
  assert.match(result, /<small>Total charge<\/small><strong>—<\/strong>/);
  assert.doesNotMatch(renderSettingsDetail('charger_records', { ...ctx, inventory, id: 'missing' }).body, /99 kWh|data-charger-record-device/);
});

test('priority order must be a complete permutation', () => {
  assert.deepEqual(collectSettings('priority', { priority_1: 'grid', priority_2: 'solar', priority_3: 'evdc' }).order, ['grid', 'solar', 'evdc']);
  assert.throws(() => collectSettings('priority', { priority_1: 'grid', priority_2: 'grid', priority_3: 'evdc' }));
});

test('vehicle metadata validates capacity, year and explicit checkbox values', () => {
  const input = { brand: 'Kia', model: 'EV9', year: '2024', capacity_kwh: '96', primary: 'on' };
  assert.deepEqual(collectSettings('vehicle', input, { id: 'car1' }), { route: 'vehicle', local_only: true, id: 'car1', brand: 'Kia', model: 'EV9', year: 2024, capacity_kwh: 96, primary: true });
  for (const change of [{ year: '2024.5' }, { capacity_kwh: -1 }, { primary: 'false' }, { brand: '<'.repeat(41) }]) assert.throws(() => collectSettings('vehicle', { ...input, ...change }));
});

test('panel metadata and safety drafts have bounded values without invented default power', () => {
  assert.equal(collectSettings('pv_capacity', { capacity_wp: '10340' }).capacity_wp, 10340);
  assert.throws(() => collectSettings('pv_capacity', { capacity_wp: '10.3' }));
  assert.throws(() => collectSettings('pv_brand', { brand: 'x'.repeat(21) }));
  assert.deepEqual(collectSettings('string_names', { pv1: 'South 1', pv2: 'South 2' }), { route: 'string_names', local_only: true, pv1: 'South 1', pv2: 'South 2' });
  const safety = collectSettings('safety', {}); assert.equal(safety.max_charge_kw, null); assert.equal(safety.max_discharge_kw, null); assert.equal(safety.export_requested, false);
  assert.throws(() => collectSettings('safety', { max_charge_kw: true }));
  assert.doesNotMatch(renderSettingsDetail('safety', ctx).body, /value="3"/);
});

test('forecast and AI preferences use provider allowlists and existing entity identifiers', () => {
  assert.deepEqual(collectSettings('forecast_settings', { provider: 'forecast_solar', entity_id: 'sensor.forecast_today' }), { route: 'forecast_settings', local_only: true, provider: 'forecast_solar', entity_id: 'sensor.forecast_today' });
  assert.throws(() => collectSettings('forecast_settings', { provider: 'forecast_solar', entity_id: 'switch.rack' }));
  assert.throws(() => collectSettings('forecast_settings', { provider: 'anything', entity_id: '' }));
  const ai = collectSettings('ai_settings', { provider: 'openai', agent_entity: 'conversation.energy', share_energy_data: 'on', api_key: 'must-never-persist' });
  assert.equal(ai.agent_entity, 'conversation.energy'); assert.ok(!('api_key' in ai));
  assert.throws(() => collectSettings('ai_settings', { provider: 'openai', agent_entity: 'javascript:bad' }));
});
test('native forecast preferences list actual sources, average at most two, and reject stale choices',()=>{
  const configuration={selected_sources:['forecast:a','meteo:b'],primary_source:'forecast:a',average:true,sources:[{id:'forecast:a',name:'Forecast.Solar',title:'Main panels',loaded:true},{id:'meteo:b',name:'Open-Meteo Solar Forecast',title:'Main panels',loaded:true},{id:'volcast:c',name:'Volcast',title:'Main panels',loaded:true}],providers:[]};
  const context={...ctx,forecastConfiguration:configuration};
  const html=renderSettingsDetail('forecast_settings',context).body;
  assert.match(html,/Open-Meteo Solar Forecast/);assert.match(html,/Average connected forecasts/);assert.doesNotMatch(html,/Volcast.*unavailable/);
  assert.deepEqual(collectSettings('forecast_settings',{sources:['forecast:a','meteo:b'],average:true,primary_source:'forecast:a'},context),{route:'forecast_settings',local_only:false,sources:['forecast:a','meteo:b'],average:true,primary_source:'forecast:a'});
  assert.throws(()=>collectSettings('forecast_settings',{sources:['forecast:a','meteo:b','volcast:c'],average:true,primary_source:'forecast:a'},context),/at most two/);
  assert.throws(()=>collectSettings('forecast_settings',{sources:['removed'],average:false},context));
});

test('collect accepts FormData and discards unknown fields, tokens and polluted prototype properties', () => {
  const data = new FormData(); data.set('mode', 'tou'); data.set('token', 'secret'); data.set('execute', 'true'); data.set('local_only', 'false');
  assert.deepEqual(validateSettings('mode', data), { route: 'mode', local_only: true, mode: 'tou' });
  const inherited = Object.create({ name: 'Inherited' }); inherited.brand = 'Brand';
  assert.deepEqual(collectSettings('pv_brand', inherited), { route: 'pv_brand', local_only: true, brand: 'Brand' });
  assert.throws(() => collectSettings('mode', Object.create({ mode: 'tou' })));
  assert.throws(() => collectSettings('unrecognized', {})); assert.throws(() => collectSettings('revenue_calendar', {}));
});

test('draft collections restore selected names and IDs without flattening sibling drafts', () => {
  const interfaceOptions = { strategy: { first: { name: 'Night charge', start: '02:00', end: '05:00' }, second: { name: 'Solar export' } }, tariff_edit: { import: { base_price: 9, currency: 'EUR', unit: 'cent', timezone: 'Europe/Dublin' } } };
  assert.match(renderSettingsDetail('strategies', { ...ctx, interfaceOptions }).body, /data-id="first"/);
  assert.match(renderSettingsDetail('strategy', { ...ctx, interfaceOptions, id: 'first' }).body, /value="Night charge"/);
  assert.match(renderSettingsDetail('tariff_edit', { ...ctx, interfaceOptions, id: 'import' }).body, /name="base_price" value="9"/);
});

test('calendar is timezone-aware, blank for unverified income and robust to bad preference timezone', () => {
  const page = renderSettingsDetail('revenue_calendar', { ...ctx, now: new Date('2026-02-01T00:30:00Z'), timezone: 'America/Los_Angeles' });
  assert.match(page.body, /January 2026/); assert.equal((page.body.match(/<strong>—<\/strong>/g) || []).length, 31);
  assert.doesNotThrow(() => renderSettingsDetail('revenue_calendar', { ...ctx, timezone: 'malicious/no-such-zone' }));
});

test('freeform AI requests preserve multiline wording only as a local draft', () => {
  const request = 'Charge at night.\nOnly sell above 75% SOC.';
  assert.deepEqual(collectSettings('ai', { request }), { route: 'ai', local_only: true, request });
  assert.throws(() => collectSettings('ai', { request: '\u0000' }));
});

test('weekday editors provide native accessible checkbox chips and restore the chosen days', () => {
  const page = renderSettingsDetail('strategy', { ...ctx, interfaceOptions: { strategy: { weekdays: ['mon', 'sun'] } } }).body;
  const inputs = [...page.matchAll(/<input type="checkbox" name="weekdays" value="([a-z]+)"[^>]*>/g)];
  assert.equal(inputs.length, 7);
  assert.deepEqual(inputs.filter(([html]) => / checked/.test(html)).map(([, day]) => day), ['mon', 'sun']);
  assert.match(page, /<fieldset class="settings-day-picker"><legend>Repeat on/);
  assert.match(page, /aria-label="Monday"/); assert.match(page, /aria-label="Sunday"/);
  assert.match(SETTINGS_STYLE, /input:focus-visible\+span/);
  for (const route of ['strategy', 'charger_schedule', 'tariff_edit']) {
    const html = renderSettingsDetail(route, ctx).body;
    assert.match(html, /settings-weekdays/);
    assert.doesNotMatch(html, /value="mon,tue,wed|Weekdays: mon,tue/);
  }
});

test('FormData getAll preserves multiple weekday selections for strategy, schedule and tariff windows', () => {
  const data = new FormData();
  for (const [key, val] of Object.entries(strategy())) if (key !== 'weekdays') data.set(key, val);
  data.append('weekdays', 'sun'); data.append('weekdays', 'mon');
  assert.deepEqual(collectSettings('strategy', data).weekdays, ['mon', 'sun']);
  data.set('mode', 'fast');
  assert.deepEqual(collectSettings('charger_schedule', data, { id: 'dc', inventory: CHARGERS }).weekdays, ['mon', 'sun']);
  const prices = new FormData();
  for (const [key, val] of Object.entries(tariff())) prices.set(key, val);
  prices.set('window_0_start', '23:00'); prices.set('window_0_end', '05:00'); prices.set('window_0_price', '-2');
  prices.append('window_0_weekdays', 'fri'); prices.append('window_0_weekdays', 'sat');
  const draft = collectSettings('tariff_edit', prices);
  assert.deepEqual(draft.windows[0].weekdays, ['fri', 'sat']); assert.equal(draft.windows[0].overnight, true);
  prices.append('window_0_weekdays', 'fri');
  assert.throws(() => collectSettings('tariff_edit', prices), /unique weekdays/);
  data.delete('weekdays'); assert.throws(() => collectSettings('strategy', data), /Weekdays/);
});

test('HTML forms use FormData weekday arrays without losing all but the last checkbox', () => {
  const NativeFormData = globalThis.FormData, previousForm = globalThis.HTMLFormElement;
  class FormDouble { constructor(entries) { this.entries = entries; } }
  class FormDataDouble extends NativeFormData {
    constructor(form) { super(); for (const [key, val] of form.entries) this.append(key, val); }
  }
  try {
    globalThis.HTMLFormElement = FormDouble; globalThis.FormData = FormDataDouble;
    const entries = Object.entries(strategy()).filter(([key]) => key !== 'weekdays');
    entries.push(['weekdays', 'tue'], ['weekdays', 'thu']);
    assert.deepEqual(collectSettings('strategy', new FormDouble(entries)).weekdays, ['tue', 'thu']);
  } finally {
    globalThis.FormData = NativeFormData;
    if (previousForm === undefined) delete globalThis.HTMLFormElement; else globalThis.HTMLFormElement = previousForm;
  }
});

test('currency picker offers common choices and retains custom three-letter currency support', () => {
  const common = renderSettingsDetail('tariff_edit', ctx).body;
  assert.match(common, /name="currency_choice"/);
  for (const code of ['EUR', 'GBP', 'USD', 'custom']) assert.match(common, new RegExp(`option value="${code}"`));
  assert.equal(collectSettings('tariff_edit', tariff({ currency_choice: 'GBP', currency: '' })).currency, 'GBP');
  assert.equal(collectSettings('tariff_edit', tariff({ currency_choice: 'custom', currency: 'CAD' })).currency, 'CAD');
  assert.equal(collectSettings('tariff_edit', tariff({ currency: 'JPY' })).currency, 'JPY');
  assert.throws(() => collectSettings('tariff_edit', tariff({ currency_choice: 'custom', currency: '' })), /Currency is required/);
  assert.throws(() => collectSettings('tariff_edit', tariff({ currency_choice: 'DOGE' })), /Currency is invalid/);
  const custom = renderSettingsDetail('tariff_edit', { ...ctx, interfaceOptions: { tariff_edit: { currency: 'CAD' } } }).body;
  assert.match(custom, /value="custom" selected/); assert.match(custom, /name="currency" value="CAD"/);
});

test('editors show one concise lock notice while retaining useful overnight help', () => {
  for (const route of SETTINGS_ROUTES) {
    const html = renderSettingsDetail(route, ctx).body;
    assert.doesNotMatch(html, /class="settings-lock"/, route);
    assert.doesNotMatch(html, /this build|app recording labels|No records have been fabricated|reviewed strategy compiler/);
  }
  assert.match(renderSettingsDetail('strategy', ctx).body, /An end before the start continues next morning/);
  assert.match(renderSettingsDetail('tariff_edit', ctx).body, /using the selected start day/);
});

test('operating mode prefills a recognized observed label and an explicit draft always wins', () => {
  for (const label of ['AI Mode', 'Sigen AI Mode', 'sigen_ai']) {
    const page = renderSettingsDetail('mode', { ...ctx, state: () => ({ state: label }) }).body;
    assert.match(page, /value="sigen_ai" selected/);
    assert.doesNotMatch(page, /value="self_consumption" selected/);
  }
  const native = renderSettingsDetail('mode', { ...ctx, state: key => ({ state: key === 'cloud_mode' ? 'unavailable' : 'Time of Use' }) }).body;
  assert.match(native, /value="tou" selected/);
  const draft = renderSettingsDetail('mode', { ...ctx, interfaceOptions: { mode: { mode: 'self_consumption' } } }).body;
  assert.match(draft, /value="self_consumption" selected/);
  const blankDraft = renderSettingsDetail('mode', { ...ctx, interfaceOptions: { mode: { mode: '' } } }).body;
  assert.match(blankDraft, /value="" selected/);
});

test('unknown or numeric operating modes require an explicit selection', () => {
  for (const state of ['unavailable', 'unknown', 'constructor', '3', 3, undefined]) {
    const html = renderSettingsDetail('mode', { ...ctx, state: () => ({ state }) }).body;
    assert.match(html, /<select name="mode" required>/);
    assert.match(html, /value="" selected>Choose an operating mode/);
    assert.doesNotMatch(html, /value="(?:self_consumption|tou|sigen_ai)" selected/);
  }
  assert.throws(() => collectSettings('mode', { mode: '' }));
});

test('PV capacity prefills supplied solar metadata and converts 10.34 kWp to 10340 Wp', () => {
  for (const capacity of [{ capacity_wp: 10340 }, { capacity_kwp: 10.34 }, { capacity_kwp: '10.34' }]) {
    const html = renderSettingsDetail('pv_capacity', { ...ctx, inventory: [{ type: 'solar', id: 'pv', ...capacity }] }).body;
    assert.match(html, /name="capacity_wp" value="10340"/);
  }
  const edited = renderSettingsDetail('pv_capacity', { ...ctx, inventory: [{ type: 'solar', capacity_wp: 10340 }], interfaceOptions: { pv_capacity: { capacity_wp: 9000 } } }).body;
  assert.match(edited, /name="capacity_wp" value="9000"/);
  for (const inventory of [[], [{ type: 'battery', capacity_wp: 10340 }], [{ type: 'solar', capacity_kwp: true }], [{ type: 'solar', capacity_wp: -1 }], [{ type: 'solar', capacity_wp: Infinity }], [{ type: 'solar', id: 'one', capacity_wp: 5000 }, { type: 'solar', id: 'two', capacity_wp: 4000 }]]) {
    assert.match(renderSettingsDetail('pv_capacity', { ...ctx, inventory }).body, /name="capacity_wp" value=""/);
  }
});

test('new strategy and charger schedule have no magic example hours', () => {
  for (const route of ['strategy', 'charger_schedule']) {
    const html = renderSettingsDetail(route, { ...ctx, id: route === 'charger_schedule' ? 'ac' : 'new' }).body;
    assert.match(html, /name="start" value="" type="time" required/);
    assert.match(html, /name="end" value="" type="time" required/);
    assert.doesNotMatch(html, /02:00|05:00/);
    const supplied = renderSettingsDetail(route, { ...ctx, id: 'existing', inventory: [{ id: 'existing', type: 'ac' }], schedule: { start: '13:15', end: '16:45' } }).body;
    assert.match(supplied, /name="start" value="13:15"/);
    assert.match(supplied, /name="end" value="16:45"/);
  }
  const saved = renderSettingsDetail('strategy', { ...ctx, id: 'owner-plan', config: { strategies: [{ id: 'owner-plan', start: '10:00', end: '11:00' }] }, interfaceOptions: { strategy: { 'owner-plan': { start: '12:00', end: '14:00' } } } }).body;
  assert.match(saved, /name="start" value="12:00"/); assert.match(saved, /name="end" value="14:00"/);
});

test('connections show only Modbus and Cloud with no developer-key setup',()=>{
  const page=renderSettingsDetail('connections',{...ctx,state:()=>undefined}).body;
  assert.match(page,/<small>Modbus<\/small>/);assert.match(page,/<small>Cloud<\/small>/);
  assert.doesNotMatch(page,/Official API|NBI|<small>API<\/small>|AppSecret/);
});

test('revenue calendar navigates month/year boundaries and preserves unknown revenue', () => {
  const january = renderSettingsDetail('revenue_calendar', { ...ctx, id: 'month:2026-01' }).body;
  assert.match(january, /January 2026/); assert.match(january, /data-id="month:2025-12"/); assert.match(january, /data-id="month:2026-02"/);
  assert.match(january, /aria-label="Previous month"/);
  const year = renderSettingsDetail('revenue_calendar', { ...ctx, id: 'year:2025' }).body;
  assert.match(year, /data-id="year:2024"/); assert.match(year, /data-id="year:2026"/); assert.match(year, /aria-label="Next year"/);
  const leap = renderSettingsDetail('revenue_calendar', { ...ctx, id: 'month:2028-02' }).body;
  assert.match(leap, /February 2028/); assert.equal((leap.match(/<strong>—<\/strong>/g) || []).length, 29);
});

test('tariff seasons list their actual draft month ranges and use direction-scoped IDs', () => {
  const interfaceOptions = { tariff_season: { 'import:one': { direction: 'import', name: 'Winter', start_month: 10, end_month: 3 }, 'export:two': { direction: 'export', name: 'Selling season', start_month: 1, end_month: 12 } } };
  const list = renderSettingsDetail('tariff_seasons', { ...ctx, id: 'import', interfaceOptions }).body;
  assert.match(list, /Winter/); assert.match(list, /Oct–Mar/); assert.match(list, /data-id="import:new"/); assert.doesNotMatch(list, /Selling season/);
  const editor = renderSettingsDetail('tariff_season', { ...ctx, id: 'export:new' }).body;
  assert.match(editor, /name="start_month"[\s\S]*?value="1" selected/);
  assert.match(editor, /name="end_month"[\s\S]*?value="12" selected/);
  assert.match(editor, /name="direction" value="export"/);
});

test('season prices and overnight TOU windows remain scoped to an inert month-range draft', () => {
  const input = tariff({ name: 'Winter', direction: 'import', start_month: '10', end_month: '3', window_0_weekdays: ['mon', 'fri'], window_0_start: '23:00', window_0_end: '05:00', window_0_price: '-2' });
  const interfaceOptions = { tariff_edit: { import: { name: 'Year round' } }, tariff_season: { 'import:summer': { direction: 'import', start_month: 4, end_month: 9 } } }, before = structuredClone(interfaceOptions);
  const result = collectSettings('tariff_season', input, { id: 'import:winter', interfaceOptions });
  assert.equal(result.route, 'tariff_season'); assert.equal(result.local_only, true); assert.equal(result.id, 'import:winter'); assert.equal(result.direction, 'import');
  assert.equal(result.start_month, 10); assert.equal(result.end_month, 3); assert.equal(result.windows[0].overnight, true); assert.equal(result.windows[0].price_per_kwh, -.02);
  assert.deepEqual(interfaceOptions, before);
  assert.throws(() => collectSettings('tariff_season', { ...input, start_month: '3', end_month: '4' }, { id: 'import:another', interfaceOptions }), /overlap/);
  assert.throws(() => collectSettings('tariff_season', { ...input, end_month: '13' }, { id: 'import:winter' }));
  assert.throws(() => collectSettings('tariff_season', { ...input, direction: 'export' }, { id: 'import:winter' }), /direction/);
});

test('surplus PV preferences are separate AC/DC drafts using only mapped destinations', () => {
  const entities = { battery_soc: 'sensor.soc', ac_power: 'sensor.ac', dc_power: 'sensor.dc', grid_power: 'sensor.grid' };
  for (const id of ['ac', 'dc']) {
    const context = { ...ctx, id, entities }, html = renderSettingsDetail('surplus_pv_priority', context).body;
    assert.match(html, /Choose a destination/); assert.doesNotMatch(html, /Plant controls are locked/);
    const draft = collectSettings('surplus_pv_priority', { priority_1: 'battery', priority_2: 'ev', priority_3: 'grid' }, context);
    assert.equal(draft.id, id); assert.deepEqual(draft.order, ['battery', 'ev', 'grid']); assert.equal(draft.local_only, true);
    assert.throws(() => collectSettings('surplus_pv_priority', { priority_1: 'battery', priority_2: 'battery', priority_3: 'grid' }, context));
  }
  const onlyGrid = renderSettingsDetail('surplus_pv_priority', { ...ctx, id: 'ac', entities: { grid_power: 'sensor.grid' } }).body;
  assert.doesNotMatch(onlyGrid, /option value="battery"/);
  assert.match(onlyGrid, /option value="ev"/);
  assert.throws(() => collectSettings('surplus_pv_priority', {}, { ...ctx, inventory: [] }), /No energy destinations/);
  assert.match(renderSettingsDetail('charging_mode', { ...ctx, id: 'dc' }).body, /data-detail="surplus_pv_priority" data-id="dc"/);
});

test('network, maintenance and add-device pages show mapped facts without invented vendor controls', () => {
  const context = { ...ctx, id: 'unit1', config: { cloud_paused: true }, inventory: [{ id: 'unit1', type: 'inverter', name: 'Inverter', model: 'Owner model', firmware: '1.2.3', ip_address: '192.0.2.10', password: 'never-render-this' }] };
  assert.match(renderSettingsDetail('network', context).body, /192\.0\.2\.10/);
  assert.match(renderSettingsDetail('maintenance', context).body, /1\.2\.3/);
  for (const route of ['network', 'maintenance', 'add_device']) {
    const html = renderSettingsDetail(route, context).body;
    assert.doesNotMatch(html, /never-render-this|Restart|Reboot|Pair now|Update firmware|data-manual/);
    assert.match(html, /data-detail="connections"/);
  }
});

test('Network shows actual transport status and read trace instead of unmapped device placeholders',()=>{
  const context={...ctx,connections:[{key:'modbus',description:'Connected'},{key:'cloud',description:'Connected'}],state:key=>key==='modbus_status'?{attributes:{host:'192.0.2.10',port:502,poll_interval_seconds:60,read_only:true,trace:{read_requests:24,errors:0,snapshots:2,last_cycle_seconds:11.2}}}:undefined};
  const html=renderSettingsDetail('network',context).body;
  assert.match(html,/192.0.2.10:502/);assert.match(html,/60 seconds/);assert.match(html,/24 \/ 0/);assert.match(html,/Additional read-only/);
  assert.doesNotMatch(html,/Signal strength|Network type/);
});

test('charger mode requires observation or an explicit draft, and a new schedule never invents a mode', () => {
  for (const id of ['ac', 'dc']) {
    const html = renderSettingsDetail('charging_mode', { ...ctx, id }).body;
    assert.match(html, /<select name="mode" required>/); assert.match(html, /value="" selected>Choose a charging mode/);
  }
  const observed = { ...ctx, id: 'ac', state: key => key === 'ac_charging_mode' ? { state: 'PV Surplus Charging' } : undefined };
  assert.match(renderSettingsDetail('charging_mode', observed).body, /value="pv_surplus" selected/);
  assert.match(renderSettingsDetail('charger_schedule', observed).body, /value="" selected>Choose a charging mode/);
  const draft = renderSettingsDetail('charging_mode', { ...observed, interfaceOptions: { charging_mode: { ac: { mode: 'sigen_ai' } } } }).body;
  assert.match(draft, /value="sigen_ai" selected/);
  const numericMode = renderSettingsDetail('charging_mode', { ...ctx, id: 'dc', state: () => ({ state: '3' }) }).body;
  assert.match(numericMode, /value="" selected>Choose a charging mode/);
});

test('charger classification follows selected inventory type rather than opaque IDs', () => {
  const inventory = [{ id: 'contains-dc-token', type: 'ac', name: 'Wall charger' }, { id: '120A43AH002', type: 'dc', name: 'DC unit' }];
  const ac = { ...ctx, id: inventory[0].id, inventory }, dc = { ...ctx, id: inventory[1].id, inventory };
  assert.equal(renderSettingsDetail('charging_mode', ac).title, 'AC Charging Mode');
  assert.doesNotMatch(renderSettingsDetail('charging_mode', ac).body, /Bi-directional V2X/);
  assert.equal(renderSettingsDetail('charging_mode', dc).title, 'DC Charging Mode');
  assert.match(renderSettingsDetail('charging_mode', dc).body, /Bi-directional V2X/);
  assert.match(renderSettingsDetail('charging_mode', dc).body, /data-detail="charger_schedules" data-id="120A43AH002"/);
  assert.equal(collectSettings('charging_mode', { mode: 'v2x' }, dc).id, inventory[1].id);
  assert.throws(() => collectSettings('charging_mode', { mode: 'v2x' }, ac));
  for (const route of ['charging_mode', 'charger_schedule', 'surplus_pv_priority']) {
    const unknown = { ...ctx, id: 'missing-dc-id', inventory };
    assert.doesNotMatch(renderSettingsDetail(route, unknown).body, /data-settings-form/);
    assert.throws(() => collectSettings(route, { mode: 'fast' }, unknown));
  }
});

test('charger observation stays selected-device scoped when multiple chargers exist', () => {
  const inventory = [{ id: 'one', type: 'ac', entities: { charging_mode: 'sensor.one_mode' } }, { id: 'two', type: 'ac' }];
  const context = { ...ctx, inventory, state: key => key === 'sensor.one_mode' ? { state: 'Fast Charging' } : key === 'ac_mode' ? { state: 'PV Surplus Charging' } : undefined };
  assert.match(renderSettingsDetail('charging_mode', { ...context, id: 'one' }).body, /value="fast" selected/);
  assert.match(renderSettingsDetail('charging_mode', { ...context, id: 'two' }).body, /value="" selected>Choose a charging mode/);
});

test('device settings use selected names and stale IDs never borrow inverter or plant facts', () => {
  const inventory = [{ id: 'inv', type: 'inverter', name: 'Inverter', firmware: 'inverter-only-fw', ip_address: '192.0.2.50' }, { id: 'wall', type: 'ac', name: 'Wall charger' }];
  const context = { ...ctx, inventory, config: { title: 'Wrong plant title' }, state: key => ['firmware', 'model', 'ip_address'].includes(key) ? { state: 'global-inverter-only-reading' } : key === 'grid_status' ? { state: 'On Grid' } : undefined };
  const settings = renderSettingsDetail('device_settings', { ...context, id: 'wall' });
  assert.equal(settings.title, 'Wall charger Settings'); assert.match(settings.body, /name="name" value="Wall charger"/); assert.doesNotMatch(settings.body, /Wrong plant title/);
  for (const id of ['wall', 'stale-id']) for (const route of ['network', 'maintenance']) {
    const body = renderSettingsDetail(route, { ...context, id }).body;
    assert.doesNotMatch(body, /inverter-only-fw|192\.0\.2\.50|global-inverter-only-reading/);
    if (route === 'maintenance') assert.doesNotMatch(body, /On Grid/);
  }
  assert.doesNotMatch(renderSettingsDetail('device_settings', { ...context, id: 'stale-id' }).body, /data-settings-form|Wrong plant title/);
  assert.match(renderSettingsDetail('network', { ...context, state: () => undefined }).body, /192\.0\.2\.50/);
  assert.match(renderSettingsDetail('maintenance', { ...context, state: () => undefined }).body, /inverter-only-fw/);
});

test('display editor mirrors existing modules and leaves layout unchanged until saved', () => {
  const context = { ...ctx, entities: { battery_soc: 'sensor.soc' }, config: { overview_sections: ['statistics', 'power', 'today', 'tariff'] } }, before = structuredClone(context.config);
  const defaults = displayDefaults(context), html = renderSettingsDetail('display_settings', context).body;
  assert.equal(DISPLAY_MODULES.length, 18); assert.ok(DISPLAY_MODULES.some(item => item.key === 'manual_controls'));
  assert.deepEqual(defaults.order.slice(0, 7), ['current_mode_battery', 'forecast', 'manual_controls', 'statistics', 'power', 'today', 'tariff']);
  assert.equal(defaults.immersive_weather, false); assert.deepEqual(context.config, before);
  assert.match(html, /data-display-preset/); assert.match(html, /data-display-restore/); assert.match(html, /data-display-row/); assert.match(html, /data-display-move="-1"/);
  assert.match(html, /name="immersive_weather"(?! checked)/);
  assert.doesNotMatch(html, /Smart Home Devices|Smart Home Usage/);
});

test('display preferences validate all positions and keep hidden/weather choices as inert JSON', () => {
  const keys = DISPLAY_MODULES.map(item => item.key), order = [...keys].reverse(), form = new FormData();
  form.set('preset', 'custom'); order.forEach((key, index) => form.set(`order_${key}`, String(index + 1)));
  form.append('visible', 'manual_controls'); form.append('visible', 'statistics'); form.set('immersive_weather', 'on');
  const draft = collectSettings('display_settings', form, ctx);
  assert.equal(draft.local_only, true); assert.deepEqual(draft.order, order); assert.equal(draft.immersive_weather, true);
  assert.deepEqual(draft.hidden, keys.filter(key => !['manual_controls', 'statistics'].includes(key)));
  const saved = renderSettingsDetail('display_settings', { ...ctx, interfaceOptions: { display_settings: draft } }).body;
  assert.match(saved, /name="immersive_weather" checked/);
  assert.match(saved, /data-display-key="environment"/);
  form.set(`order_${keys[0]}`, form.get(`order_${keys[1]}`));
  assert.throws(() => collectSettings('display_settings', form), /position/);
  assert.throws(() => collectSettings('display_settings', { preset: 'custom', order: [...keys.slice(1), 'not-a-module'] }));
  assert.throws(() => collectSettings('display_settings', { preset: 'custom', order: keys, hidden: ['not-a-module'] }));
});

test('classic and advanced display presets use existing modules and retain independent manual controls', () => {
  const keys = DISPLAY_MODULES.map(item => item.key);
  for (const preset of ['classic', 'advanced']) {
    const draft = collectSettings('display_settings', { preset }, ctx);
    assert.equal(draft.order.length, keys.length); assert.equal(new Set(draft.order).size, keys.length);
    assert.ok(draft.order.every(key => keys.includes(key))); assert.deepEqual(draft.hidden, [...DISPLAY_PRESETS[preset].hidden]);
    assert.ok(!draft.hidden.includes('manual_controls')); assert.equal(draft.immersive_weather, false);
  }
  const first = displayDefaults(ctx); first.order.pop(); assert.equal(displayDefaults(ctx).order.length, keys.length);
  assert.throws(() => collectSettings('display_settings', { preset: 'vendor-control' }));
});

test('main display saves all three choices without changing module layout', () => {
  const baseline = displayDefaults(ctx);
  assert.equal(baseline.main_display, 'photo');
  for (const main_display of ['house', 'flow', 'photo']) {
    const draft = collectSettings('display_settings', { main_display, preset: 'custom' }, ctx);
    assert.equal(draft.main_display, main_display);
    assert.equal(draft.local_only, true);
    assert.deepEqual(draft.order, baseline.order);
    assert.deepEqual(draft.hidden, baseline.hidden);
    const html = renderSettingsDetail('display_settings', { ...ctx, interfaceOptions: { display_settings: draft } }).body;
    assert.match(html, new RegExp(`<option value="${main_display}" selected>`));
    assert.match(html, /name="main_display"/);
    assert.match(html, />Photo house<\/option>/);
  }
  for (const invalid of ['', 'external-card', '<script>', true, 0]) assert.throws(() => collectSettings('display_settings', { main_display: invalid }, ctx), /Main display/);
});

test('Homepage appearance offers all four styles as validated local preferences with clear layout choices', () => {
  const baseline=displayDefaults(ctx);
  for(const appearance of HOMEPAGE_APPEARANCES){
    const form=new FormData();form.set('appearance',appearance);
    const draft=collectSettings('display_settings',form,ctx);
    assert.equal(draft.appearance,appearance);assert.equal(draft.local_only,true);
    assert.deepEqual(draft.order,baseline.order);assert.deepEqual(draft.hidden,baseline.hidden);
    const page=renderSettingsDetail('display_settings',{...ctx,interfaceOptions:{display_settings:draft}});
    assert.equal(page.title,'Homepage appearance');
    assert.match(page.body,new RegExp(`<option value="${appearance}" selected>`));
    assert.match(page.body,/name="appearance"/);assert.match(page.body,/Home Assistant theme/);
    assert.match(page.body,/Auto follows the sun/);assert.match(page.body,/Interface colours always follow Home Assistant/);
    assert.match(page.body,/Classic shows a smaller selection of modules/);
    assert.match(page.body,/Default balances key information with a compact layout/);
    assert.match(page.body,/Advanced shows all modules/);
  }
  for(const appearance of ['',null,false,0,'dark','constructor','<script>'])assert.throws(()=>collectSettings('display_settings',{appearance},ctx),/Appearance/);
});

test('missing legacy homepage appearance inherits configuration and integration defaults without forcing Auto', () => {
  const integration={...ctx,state:key=>key==='control_status'?{attributes:{dashboard:{appearance:'night'}}}:ctx.state(key)};
  assert.equal(displayDefaults(ctx).appearance,'auto');assert.equal(displayDefaults(integration).appearance,'night');
  assert.equal(collectSettings('display_settings',{preset:'classic'},integration).appearance,'night');
  const card={...integration,config:{appearance:'day'}};
  assert.equal(displayDefaults(card).appearance,'day');
  const legacy=renderSettingsDetail('display_settings',{...card,interfaceOptions:{display_settings:{preset:'classic'}}}).body;
  assert.match(legacy,/<option value="day" selected>/);
  const saved=renderSettingsDetail('display_settings',{...card,interfaceOptions:{display_settings:{appearance:'theme'}}}).body;
  assert.match(saved,/<option value="theme" selected>/);
  const invalid=renderSettingsDetail('display_settings',{...card,interfaceOptions:{display_settings:{appearance:'invalid'}}}).body;
  assert.match(invalid,/<option value="day" selected>/);
  assert.equal(displayDefaults({...integration,config:{appearance:'invalid'}}).appearance,'night');
});

test('Homepage appearance offers an optional native background color or local/HTTPS image without changing legacy defaults',()=>{
  const defaults=displayDefaults(ctx),legacy=collectSettings('display_settings',{preset:'classic'},ctx);
  assert.deepEqual(HOMEPAGE_BACKGROUNDS,['theme','color','image']);assert.equal(defaults.background_type,'theme');assert.equal(defaults.background_image,'');
  assert.equal(legacy.background_type,'theme');assert.deepEqual(homepageBackground(legacy),{type:'theme',color:'#17444e',image:''});
  for(const background_type of HOMEPAGE_BACKGROUNDS){
    const draft=collectSettings('display_settings',{background_type,background_color:'#A1B2C3',background_image:'/local/my-background.jpg'},ctx),body=renderSettingsDetail('display_settings',{...ctx,interfaceOptions:{display_settings:draft}}).body;
    assert.equal(draft.background_type,background_type);assert.equal(draft.background_color,'#a1b2c3');assert.equal(draft.background_image,'/local/my-background.jpg');assert.equal(draft.local_only,true);
    assert.match(body,new RegExp(`<option value="${background_type}" selected>`));
    assert.match(body,/name="background_color" value="#a1b2c3" type="color"/);assert.match(body,/name="background_image"/);assert.match(body,/\/local\/my-background\.jpg/);assert.match(body,/HTTPS image URL/);
    assert.deepEqual(draft.order,defaults.order);assert.deepEqual(draft.hidden,defaults.hidden);
  }
  const remote='https://images.example.invalid/home.jpg?size=large&v=2',draft=collectSettings('display_settings',{background_type:'image',background_image:remote},ctx);
  assert.equal(homepageBackground(draft).image,remote);assert.match(renderSettingsDetail('display_settings',{...ctx,interfaceOptions:{display_settings:draft}}).body,/size=large&amp;v=2/);
  assert.doesNotMatch(renderSettingsDetail('display_settings',ctx).body,/type="file"/);
});

test('background image validation rejects active CSS, unsupported schemes, credentials and malformed paths',()=>{
  for(const value of ['/local/a.jpg','/api/image/serve/owner/original','/media/local/landscape.webp','https://images.example.invalid/roof.webp?size=3&v=2'])assert.equal(validatedBackgroundURL(value),value);
  const invalid=['javascript:alert(1)','data:image/svg+xml,<svg/>','file:///tmp/home.jpg','http://images.example.invalid/home.jpg','https:images.example.invalid/home.jpg','//images.example.invalid/home.jpg','/\\evil.test/a.jpg','https://name:password@images.example.invalid/a.jpg',' /local/a.jpg','/local/a b.jpg','/local/a\n.jpg','/local/a\u0000.jpg','/local/a\".jpg',"/local/a'.jpg",'/local/a);color:red','.jpg','/local/{image}.jpg','https://',false,null,7,'/local/'+ 'x'.repeat(2048)];
  for(const image of invalid){
    assert.equal(validatedBackgroundURL(image),'',String(image));
    assert.throws(()=>collectSettings('display_settings',{background_type:'image',background_image:image},ctx),/image URL/,String(image));
    assert.equal(homepageBackground({background_type:'image',background_image:image}).type,'theme');
  }
  assert.throws(()=>collectSettings('display_settings',{background_type:'image',background_image:''},ctx),/image URL/);
  assert.equal(homepageBackground(null).type,'theme');
});

test('background choices and hex colors are strictly validated and malformed saved values cannot enter editor attributes',()=>{
  for(const background_type of ['',null,false,0,'gradient','constructor','<script>'])assert.throws(()=>collectSettings('display_settings',{background_type},ctx),/Background/);
  for(const background_color of ['',null,false,0,'red','#abc','#11223344','#112233;background:red','url(https://bad.invalid/a)']){
    assert.throws(()=>collectSettings('display_settings',{background_type:'color',background_color},ctx),/Background color/);
    assert.equal(homepageBackground({background_type:'color',background_color}).type,'theme');
  }
  const body=renderSettingsDetail('display_settings',{...ctx,interfaceOptions:{display_settings:{background_type:'image',background_color:'\" onfocus=bad',background_image:'/local/a\" onload=bad'}}}).body;
  assert.match(body,/<option value="theme" selected>Default background/);assert.doesNotMatch(body,/onfocus=bad|onload=bad/);
});

test('legacy homepage preferences inherit the card or integration display default', () => {
  const state = key => key === 'control_status' ? { attributes: { dashboard: { main_display: 'photo' } } } : ctx.state(key);
  const integration = { ...ctx, state };
  assert.equal(displayDefaults(integration).main_display, 'photo');
  assert.equal(collectSettings('display_settings', { preset: 'classic' }, integration).main_display, 'photo');
  const card = { ...integration, config: { main_display: 'flow' } };
  assert.equal(displayDefaults(card).main_display, 'flow');
  const html = renderSettingsDetail('display_settings', { ...card, interfaceOptions: { display_settings: { preset: 'classic' } } }).body;
  assert.match(html, /<option value="flow" selected>/);
  assert.equal(displayDefaults({ ...ctx, config: { main_display: 'invalid' } }).main_display, 'photo');
});

test('system settings exposes exactly the observed destinations and locked maintenance actions', () => {
  const html = renderSettingsDetail('system_settings', ctx).body;
  for (const route of ['system_about', 'system_details', 'safety', 'indicator_settings', 'system_maintenance']) assert.match(html, new RegExp(`data-detail="${route}"`));
  const maintenance = renderSettingsDetail('system_maintenance', { ...ctx, state: key => ({ state: key === 'grid_status' ? 'On Grid' : 'Normal' }) }).body;
  for (const label of ['Power-On', 'Power-Off', 'Go Off-Grid']) assert.ok(maintenance.includes(`disabled aria-disabled="true">${label}</button>`));
  assert.match(maintenance, /On Grid/); assert.match(maintenance, /Normal/);
  assert.doesNotMatch(maintenance, /data-manual|data-execute|data-apply/);
});

test('system metadata drafts preserve actual values and enforce the observed name and type constraints', () => {
  const context = { ...ctx, config: { plant: { system_type: 'ResidentialClassicHome', name: 'Owner system', location: 'Owner address' } } };
  const html = renderSettingsDetail('system_details', context).body;
  assert.match(html, /value="residential_classic_home" selected/); assert.match(html, /name="system_name" value="Owner system"/); assert.match(html, /Owner address/);
  for (const type of ['residential_classic_home', 'residential_modern_loft', 'factory', 'office', 'supermarket', 'school', 'hospital', 'ship', 'gas_station', 'farm']) assert.match(html, new RegExp(`value="${type}"`));
  const draft = collectSettings('system_details', { system_type: 'farm', system_name: 'x'.repeat(255), system_address: 'First line\nSecond line', execute: true });
  assert.equal(draft.local_only, true); assert.equal(draft.system_name.length, 255); assert.equal(draft.system_address, 'First line\nSecond line'); assert.ok(!('execute' in draft));
  for (const system_name of ['', ' ', 'x'.repeat(256)]) assert.throws(() => collectSettings('system_details', { system_type: 'farm', system_name }));
  assert.throws(() => collectSettings('system_details', { system_type: 'unobserved_type', system_name: 'Name' }));
});

test('indicator modes stay channel-specific and unknown state or brightness is never invented', () => {
  const strips = renderSettingsDetail('indicator_settings', { ...ctx, id: 'led_strips' }).body, front = renderSettingsDetail('indicator_settings', { ...ctx, id: 'front' }).body;
  assert.match(strips, /value="battery_soc"/); assert.match(strips, /value="personalized"/); assert.doesNotMatch(strips, /value="ambient"|value="charging_discharging"/);
  assert.match(front, /value="ambient"/); assert.match(front, /value="charging_discharging"/); assert.doesNotMatch(front, /value="battery_soc"|value="power_flow"/);
  assert.match(strips, /value="" selected>Choose LED state/); assert.match(strips, /value="" selected>Choose a mode/); assert.match(strips, /name="brightness" value="" type="number" step="any"/);
  const observed = renderSettingsDetail('indicator_settings', { ...ctx, id: 'led_strips', config: { indicator_settings: { led_strips: { enabled: true, mode: 'BatterySOC', brightness: 50 } } } }).body;
  assert.match(observed, /value="enabled" selected/); assert.match(observed, /value="battery_soc" selected/); assert.match(observed, /name="brightness" value="50" type="number" step="any"/);
  const knownRange = renderSettingsDetail('indicator_settings', { ...ctx, id: 'front', config: { indicator_settings: { front: { brightness: 50, brightness_min: 10, brightness_max: 80 } } } }).body;
  assert.match(knownRange, /name="brightness" value="50" type="range" min="10" max="80"/);
});

test('indicator drafts validate actual channel options and supplied brightness bounds only', () => {
  const input = { enabled: 'enabled', mode: 'constant', brightness: '400' };
  const unknownBounds = collectSettings('indicator_settings', input, { id: 'led_strips' });
  assert.equal(unknownBounds.brightness, 400); assert.equal(unknownBounds.enabled, true); assert.equal(unknownBounds.local_only, true);
  const context = { id: 'front', config: { indicator_settings: { front: { brightness_min: 10, brightness_max: 80 } } } };
  assert.throws(() => collectSettings('indicator_settings', input, context), /supplied range/);
  assert.equal(collectSettings('indicator_settings', { ...input, enabled: false, brightness: '50' }, context).enabled, false);
  for (const brightness of [true, NaN, Infinity, 'not-a-number']) assert.throws(() => collectSettings('indicator_settings', { ...input, brightness }, { id: 'led_strips' }));
  assert.throws(() => collectSettings('indicator_settings', { ...input, mode: 'battery_soc' }, { id: 'front' }));
  assert.throws(() => collectSettings('indicator_settings', { ...input, mode: 'ambient' }, { id: 'led_strips' }));
});

test('account preferences use native HA values and keep security in the HA account page',()=>{
  const page=renderSettingsDetail('app_settings',{...ctx,haLocale:{language:'en',date_format:'DMY',time_format:'24'}}).body;
  assert.match(page,/value="DMY" selected/);assert.match(page,/value="24" selected/);
  for(const name of ['time_format','date_format','number_format','first_weekday'])assert.match(page,new RegExp('name="'+name+'"'));
  assert.equal((page.match(/href="\/profile"/g)??[]).length,1);
  const draft=collectSettings('app_settings',{time_format:'24',date_format:'DMY',number_format:'comma_decimal',first_weekday:'monday'},ctx);
  assert.equal(draft.first_weekday,'monday');assert.throws(()=>collectSettings('app_settings',{time_format:'bogus'},ctx));
});

const MORE_AC={id:'ac-own',type:'ac',name:'Owner AC',serial:'AC-EXAMPLE',model:'AC example',ac_settings:{
  ocpp:{status:'AC supplied status',enabled:true,username:'private-name',password:'private-value',server_url:'https://private.example.invalid'},
  cards:{records:[{name:'Owner card',masked_number:'••••1234',number:'raw-card-number'}],authorisation_status:'Required'},
  dynamic_load_management:{enabled:false},output_mode:{mode:'Single Phase',p1_connected_to:'L2'},off_grid_charging:{enabled:false},indicator_lighting:{enabled:true},
  rated_power_kw:7.4,software_version:'AC version',communication_status:'Online',
  connectivity:{connected:true,ethernet:{status:'Router unavailable',mac_address:'00-00-00-00-00-01'},wlan:{status:'Connected',network_name:'Example WiFi'},cellular:{status:'Connecting',signal:{value:-75,unit:'dBm'}}},
}};
const MORE_DC={id:'dc-own',type:'dc',name:'Owner DC',serial:'DC-EXAMPLE',dc_settings:{status:'Normal',ocpp:{status:'DC supplied status',enabled:false},cards:{records:[{name:'DC card',masked_number:'••••5678'}]},charging_setting:{allowed_power_kw:18.5,vehicle_cutoff_soc:87}}};
const moreContext=(id='ac-own',extra={})=>({...ctx,id,inventory:[structuredClone(MORE_AC),structuredClone(MORE_DC)],...extra});

test('AC and DC More hubs expose every observed submenu with the selected opaque identity',()=>{
  const visited=new Set(),pending=[['ac_more','ac-own'],['dc_more','dc-own']];
  while(pending.length){const [route,id]=pending.shift(),key=`${route}:${id}`;if(visited.has(key))continue;visited.add(key);
    const page=renderSettingsDetail(route,moreContext(id));
    assert.ok(page.body.includes(`data-settings-route="${route}"`),route);
    for(const match of page.body.matchAll(/data-detail="([^"]+)"(?: data-id="([^"]+)")?/g)){
      const [,target,selected]=match;
      assert.ok(SETTINGS_ROUTES.includes(target)||OTHER_ROUTES.has(target),`${route} → ${target}`);
      if(CHARGER_MORE_ROUTES.includes(target)){assert.equal(selected,id,`${route} keeps its own charger`);pending.push([target,selected]);}
    }
  }
  assert.equal(new Set([...visited].map(key=>key.split(':')[0])).size,CHARGER_MORE_ROUTES.length);
  const ac=renderSettingsDetail('ac_more',moreContext()).body,dc=renderSettingsDetail('dc_more',moreContext('dc-own')).body;
  for(const label of ['Charging Record','Charging Mode','OCPP Management','Card Management','Dynamic load management','Output Mode','Off-grid Charging','Indicator Lighting Settings','Connectivity'])assert.ok(ac.includes(label),label);
  for(const label of ['Charging Preference','Charging Setting','OCPP Management','Card Management','Bi-directional V2X operation','My Vehicle'])assert.ok(dc.includes(label),label);
  assert.match(ac,/<h3>Authorisation<\/h3>/);assert.match(dc,/<h3>Authorisation<\/h3>/);
  assert.doesNotMatch(ac,/data-detail="(?:authorization|authorisation)"/);
  assert.doesNotMatch(dc,/data-detail="ac_more"/);
});

test('new charger pages preserve missing and wrong-device identity rather than borrowing another charger',()=>{
  for(const route of CHARGER_MORE_ROUTES){
    const missing=renderSettingsDetail(route,moreContext('removed-device')).body;
    assert.match(missing,/unavailable/);assert.doesNotMatch(missing,/AC supplied status|DC supplied status|Example WiFi/);
  }
  assert.match(renderSettingsDetail('ac_more',moreContext('dc-own')).body,/unavailable/);
  assert.match(renderSettingsDetail('dc_more',moreContext('ac-own')).body,/unavailable/);
  const multiple={...moreContext(undefined),id:undefined,inventory:[structuredClone(MORE_AC),{...structuredClone(MORE_AC),id:'ac-second'}]};
  assert.match(renderSettingsDetail('ac_more',multiple).body,/unavailable/);
  const unrelated={...ctx,id:'ac',state:()=>({state:'GLOBAL-CONNECTED'}),config:{cloud_paused:false,ocpp:{status:'GLOBAL-CONNECTED'},connectivity:{connected:true}}};
  const unknown=renderSettingsDetail('charger_ocpp',unrelated).body;
  assert.doesNotMatch(unknown,/GLOBAL-CONNECTED|Not configured| checked/);assert.match(unknown,/OCPP Status<\/small><strong>—/);
});

test('OCPP displays only selected supplied status and a disabled toggle, never credentials or configuration editors',()=>{
  const ac=renderSettingsDetail('charger_ocpp',moreContext()).body,dc=renderSettingsDetail('charger_ocpp',moreContext('dc-own')).body;
  assert.match(ac,/AC supplied status/);assert.doesNotMatch(ac,/DC supplied status|private-name|private-value|private\.example/);
  assert.match(ac,/type="checkbox"[^>]* checked disabled aria-disabled="true"/);
  assert.match(dc,/DC supplied status/);assert.doesNotMatch(dc,/AC supplied status| checked/);
  for(const html of [ac,dc])assert.doesNotMatch(html,/data-settings-form|name="(?:username|password|url|server_url)"|<textarea/);
  assert.throws(()=>collectSettings('charger_ocpp',{enabled:true},moreContext()),/no editable draft/);
  const unavailable=moreContext();unavailable.inventory[0].entities={ocpp_enabled:'binary_sensor.own_ocpp'};unavailable.state=()=>({state:'unavailable'});
  assert.match(renderSettingsDetail('charger_ocpp',unavailable).body,/OCPP Settings<\/span><strong>—/);
});

test('card management distinguishes unknown from empty, exposes no delete/add mutation and retains only supplied display fields',()=>{
  const before=structuredClone(MORE_AC),html=renderSettingsDetail('charger_cards',moreContext()).body;
  assert.match(html,/Owner card/);assert.match(html,/••••1234/);assert.match(html,/Required/);
  assert.doesNotMatch(html,/raw-card-number|Delete Now|data-settings-form|data-delete|data-add/);
  assert.match(html,/Up to 5 cards/);assert.match(html,/disabled aria-disabled="true">Add New Card/);
  const empty=moreContext();empty.inventory[0].ac_settings.cards=[];
  assert.match(renderSettingsDetail('charger_cards',empty).body,/No cards/);
  delete empty.inventory[0].ac_settings.cards;assert.match(renderSettingsDetail('charger_cards',empty).body,/Card information is unavailable/);
  const hidden=moreContext();hidden.inventory[0].ac_settings.cards.available=false;
  assert.doesNotMatch(renderSettingsDetail('charger_cards',hidden).body,/Owner card/);
  assert.throws(()=>collectSettings('charger_cards',{delete:true},moreContext()),/no editable draft/);
  assert.deepEqual(MORE_AC,before);
});

test('AC electrical, lighting and network pages use own supplied fields and preserve units and unavailable values',()=>{
  const context=moreContext(),mode=renderSettingsDetail('ac_output_mode',context).body;
  assert.match(mode,/Single Phase/);assert.match(mode,/P1 Connected to<\/small><strong>L2/);
  for(const route of ['ac_load_management','ac_offgrid_charging','ac_indicator_lighting']){
    const html=renderSettingsDetail(route,context).body;assert.match(html,/disabled aria-disabled="true"/);assert.doesNotMatch(html,/data-settings-form/);
  }
  assert.match(renderSettingsDetail('ac_connectivity',context).body,/Network status<\/small><strong>Connected/);
  assert.match(renderSettingsDetail('ac_ethernet',context).body,/00-00-00-00-00-01/);
  assert.match(renderSettingsDetail('ac_wlan',context).body,/Example WiFi/);
  assert.match(renderSettingsDetail('ac_cellular',context).body,/-75 dBm/);
  const invalid=moreContext();invalid.inventory[0].ac_settings.connectivity.cellular.signal={value:3,unit:'unverified'};
  assert.match(renderSettingsDetail('ac_cellular',invalid).body,/Signal<\/small><strong>—/);
  delete invalid.inventory[0].ac_settings;invalid.config={indicator_settings:{front:{enabled:true}},network:{status:'Connected'}};
  assert.match(renderSettingsDetail('ac_indicator_lighting',invalid).body,/LED ON\/OFF<\/span><strong>—/);
  assert.doesNotMatch(renderSettingsDetail('ac_connectivity',invalid).body,/Network status<\/small><strong>Connected/);
});

test('DC charging limits remain typed own data, and V2X guidance neither acknowledges nor enables operation',()=>{
  const page=renderSettingsDetail('dc_charging_settings',moreContext('dc-own')).body;
  assert.match(page,/18\.5 kW/);assert.match(page,/87%/);assert.match(page,/disabled aria-disabled="true">Save/);
  assert.doesNotMatch(page,/data-settings-form/);
  const missing={...ctx,id:'dc'};const unknown=renderSettingsDetail('dc_charging_settings',missing).body;
  assert.doesNotMatch(unknown,/25 kW|100%/);
  const invalid=moreContext('dc-own');invalid.inventory[1].entities={dc_allowed_charge_power:'sensor.own_limit'};invalid.state=()=>({state:'230',attributes:{unit_of_measurement:'V'}});
  assert.match(renderSettingsDetail('dc_charging_settings',invalid).body,/Charging power allowed for EVDC<\/small><strong>—/);
  const guide=renderSettingsDetail('dc_v2x_operation',moreContext('dc-own')).body;
  assert.match(guide,/V2H \(Vehicle-to-Home\)/);assert.match(guide,/Sigen Gateway/);
  assert.doesNotMatch(guide,/data-settings-form|name="(?:ack|acknowledged)"|data-manual|data-execute/);
  for(const route of ['dc_v2x_operation','dc_charging_settings'])assert.throws(()=>collectSettings(route,{enabled:true},moreContext('dc-own')),/no editable draft/);
});

test('all five observed energy modes are local draft choices and observed labels prefill without activation',()=>{
  const modes=[['self_consumption','Self-Consumption'],['sigen_ai','Sigen AI Mode'],['tou','Time-based Control'],['fully_feed_in','Fully Feed-into Grid'],['remote_ems','Remote EMS Mode']];
  for(const [mode,label] of modes){
    const page=renderSettingsDetail('mode',{...ctx,state:key=>key==='cloud_mode'?{state:label}:null}).body;
    assert.match(page,new RegExp(`value="${mode}" selected`));assert.ok(page.includes(label));
    const draft=collectSettings('mode',{mode});assert.equal(draft.mode,mode);assert.equal(draft.local_only,true);
    assert.match(page,/disabled aria-disabled="true">Apply to Sigenergy/);assert.doesNotMatch(page,/data-execute|data-mode-add|data-mode-import/);
  }
  assert.match(renderSettingsDetail('mode',{...ctx,state:key=>key==='native_mode'?{state:'TOU'}:null}).body,/value="tou" selected/);
});


test('owner mode form uses only advertised identities and applies through the backend',()=>{
 const native={controlPermission:true,capabilities:{native_mode:{available:true}},state:key=>key==='control_status'?{attributes:{native_modes:[{mode:1,profile_id:-1,label:'Sigen AI Mode'},{mode:2,profile_id:-1,label:'Time-based Control'},{mode:9,profile_id:7,label:'Weekend'}]}}:key==='cloud_mode'?{state:'Sigen AI Mode'}:null};
 assert.deepEqual(modeChoices(native).map(([id])=>id),['1:-1','2:-1','9:7']);assert.equal(selectedMode(native),'1:-1');
 const page=renderSettingsDetail('mode',native).body;assert.match(page,/>Apply<\/button>/);assert.doesNotMatch(page,/Save draft|disabled aria-disabled/);
 assert.equal(collectSettings('mode',{mode:'2:-1'},native).local_only,false);
 assert.throws(()=>collectSettings('mode',{mode:'0:-1'},native));
 assert.equal(collectSettings('mode',{mode:'sigen_ai'},{...native,controlPermission:false}).local_only,true);
});
