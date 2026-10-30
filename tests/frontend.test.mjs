import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.HTMLElement = class { attachShadow() { this.shadowRoot = { innerHTML: '', querySelectorAll: () => [] }; } };
globalThis.window = {};
const elements = new Map();
globalThis.customElements = { get: k => elements.get(k), define: (k, v) => elements.set(k, v) };
const { measurement, priceMeasurement, manualPowerOptions, manualDurationOptions, flowActivity, energySankey, safeImageURL, dashboardBackgroundStyle, escapeHTML, discoverEntities, SigenHybridCard } = await import('../custom_components/sigen_hybrid/frontend/sigen-hybrid-card.js');

test('standalone chart views reach their installed renderer instead of invoking an absent base renderer',()=>{
  const card=new SigenHybridCard();card.setConfig({view:'charts'});
  card._chartsPage=()=>'<section>Charts rendered</section>';
  assert.match(card._content(),/Charts rendered/);
});
const state = (value, unit) => ({ state: value, attributes: { unit_of_measurement: unit } });

test('connection metadata preserves the approved navigation and manual-control sections',()=>{
  const card=new SigenHybridCard();card.setConfig({config_entry:'synthetic',entities:{control_status:'sensor.control',cloud_mode:'sensor.mode'}});
  const features={native_mode:{supported:false},grid_switch:{supported:false},manual_control:{supported:false,online:false},charger_control:{supported:false}};
  card.hass={states:{'sensor.control':{state:'live_writes_locked',attributes:{live_writes_locked:true,capabilities:features}},'sensor.mode':state('AI Mode','')}};
  assert.match(card._header(),/data-detail="mode"/);
  assert.match(card._header(),/data-detail="grid_connection"/);
  assert.match(card._overviewModeControl(),/<select/);
  for(const action of ['charge','discharge','battery_export','hold','self_consumption'])assert.match(card._controls(),new RegExp('data-preview="'+action+'"'));
  assert.equal(card._readOnly(),true);
  assert.doesNotMatch(card._detailModel('mode').body,/class="detail-empty">Unavailable/);
});

test('mapped sensor fallback never treats an expired Modbus mirror as live',()=>{
  const card=new SigenHybridCard();card.setConfig({snapshot_at:'2026-10-28T12:00:00Z',entities:{solar_power:'sensor.local'},fallback_entities:{solar_power:['sensor.remote']}});
  const remote={state:'2',attributes:{data_source:'sigenergy_cloud',unit_of_measurement:'kW',observed_at:'2026-10-28T11:55:00Z'}};
  card.hass={states:{'sensor.local':{state:'8',attributes:{data_source:'production_modbus_bridge',unit_of_measurement:'kW',observed_at:'2026-10-28T11:00:00Z'}},'sensor.remote':remote}};
  assert.equal(card._value('solar_power'),2);
  assert.equal(remote.attributes.observed_at,'2026-10-28T11:55:00Z');
});
test('a sole expired energy mirror is not shown as a current daily total',()=>{
  const card=new SigenHybridCard();card.setConfig({snapshot_at:'2026-10-29T14:00:00Z',entities:{solar_today:'sensor.old'}});
  card.hass={states:{'sensor.old':{state:'0.01',attributes:{data_source:'production_modbus_bridge',unit_of_measurement:'kWh',observed_at:'2026-10-29T07:35:00Z'}}}};
  assert.equal(card._value('solar_today','energy'),null);
});
test('forecast badges identify the actual contributing sources rather than a configured placeholder',()=>{
  const card=new SigenHybridCard();card.setConfig({entities:{forecast_status:'sensor.status'},forecast_provider:'Volcast'});
  card.hass={states:{'sensor.status':{state:'Average · 2 sources',attributes:{sources:[{name:'Forecast.Solar',available:true},{name:'Open-Meteo Solar Forecast',available:true},{name:'Volcast',available:false}]}}}};
  const html=card._forecast();assert.match(html,/Forecast\.Solar/);assert.match(html,/Open-Meteo/);assert.doesNotMatch(html,/Volcast/);
});

test('a selected forecast stays visible during an outage without claiming two-source averaging',()=>{
  const card=new SigenHybridCard();card.setConfig({entities:{forecast_status:'sensor.status'}});
  card.hass={states:{'sensor.status':{state:'Open-Meteo Solar Forecast',attributes:{sources:[
    {id:'forecast_solar:one',name:'Forecast.Solar',available:false},
    {id:'open_meteo_solar_forecast:two',name:'Open-Meteo Solar Forecast',available:true},
  ]}}}};
  const html=card._forecast();
  assert.match(html,/data-available="false"[^>]*title="Forecast\.Solar: temporarily unavailable"/);
  assert.match(html,/data-available="true"[^>]*title="Open-Meteo"/);
  assert.doesNotMatch(html,/Average · 2 sources/);
});
const dialogFixture = () => {
  const output = { textContent: '' }, handlers = {};
  const button = { disabled: false, addEventListener: (type, handler) => { handlers[type] = handler; } };
  const cancel = { addEventListener: (_type, handler) => { handlers.cancelClick = handler; } }, close = { addEventListener: (_type, handler) => { handlers.closeClick = handler; } };
  const release = { disabled:false,hidden:false,addEventListener:(_type,handler)=>{handlers.releaseClick=handler;} };
  const customPower = { hidden: false }, choice = { value: 'custom', addEventListener: (_type, handler) => { handlers.selectionChange = handler; } };
  const customDuration = { hidden: true }, durationChoice = { value: '30', addEventListener: (_type, handler) => { handlers.durationChange = handler; } };
  const form = { reportValidity: () => true, addEventListener: (type, handler) => { handlers[`form_${type}`] = handler; }, elements: { duration: { value: '' }, duration_choice: durationChoice, power: { value: '1' }, power_choice: choice } };
  const dialog = { attributes:{}, setAttribute(key,value){this.attributes[key]=value;}, innerHTML: '', showModal: () => {}, close: value => { dialog.closed = value; handlers.dialog_close?.(); }, getBoundingClientRect: () => ({ left: 100, right: 500, top: 100, bottom: 400 }), addEventListener: (type, handler) => { handlers[`dialog_${type}`] = handler; }, remove: () => {}, querySelector: selector => selector==='#control-release'?(dialog.innerHTML.includes('id="control-release"')?release:null):({ '#preview-confirm': button, '#control-cancel': cancel, '#control-close': close, '#custom-power': customPower, '#custom-duration': customDuration, output, form })[selector] };
  return { dialog, output, button, release, form, choice, customPower, durationChoice, customDuration, handlers };
};

test('units and unknown readings remain explicit', () => {
  assert.equal(measurement(state('1200', 'W')), 1.2);
  assert.equal(measurement(state('2', 'kW')), 2);
  assert.equal(measurement(state('1200', 'Wh'), 'energy'), 1.2);
  assert.equal(measurement(state('unknown', 'W')), null);
  assert.equal(measurement(state('unavailable', 'kW')), null);
  assert.equal(measurement(state('', 'W')), null);
  assert.equal(measurement(state('0', 'W')), 0);
  assert.equal(measurement(state('2', 'V')), null);
  assert.equal(measurement({ state: '9.99', attributes: { unit_of_measurement: 'kW', sample_data: true } }), 9.99);
});
test('price scale supports cents and negative prices without guessing', () => {
  assert.equal(priceMeasurement(state('9', 'cent/kWh')), .09);
  assert.equal(priceMeasurement(state('-.05', 'EUR/kWh')), -.05);
  assert.equal(priceMeasurement(state('9', 'unknown')), null);
});
test('manual power choices use verified values and respect the strictest app, owner or device bounds', () => {
  assert.deepEqual(manualPowerOptions({ charge: { app_default_kw: 5, device_max_kw: 10, user_max_kw: 8, min_kw: .5 } }, 'charge'), {
    choices: [{ id: 'app_default', label: 'Sigen app limit', power_kw: 5, disabled: false }, { id: 'device_max', label: 'Device maximum', power_kw: 10, disabled: true }, { id: 'user_max', label: 'Owner maximum', power_kw: 8, disabled: true }], min_kw: .5, max_kw: 5, valid_bounds: true,
  });
  assert.deepEqual(manualPowerOptions({ discharge: { app_default_kw: 4, device_max_kw: 8 } }, 'discharge').choices.map(choice => choice.power_kw), [4, 8]);
  assert.deepEqual(manualPowerOptions(undefined, 'charge'), { choices: [], min_kw: null, max_kw: null, valid_bounds: true });
  for (const invalid of [0, -1, NaN, Infinity, true, '', ' ', 'bad', '4294967.295', 5000000]) assert.equal(manualPowerOptions({ charge: { app_default_kw: invalid, device_max_kw: invalid, user_max_kw: invalid } }, 'charge').choices.length, 0);
  assert.equal(manualPowerOptions({ charge: { app_default_kw: '5.5' } }, 'charge').choices[0].power_kw, 5.5);
  assert.deepEqual(manualPowerOptions({ charge: { app_unlimited: true } }, 'charge').choices, [{ id: 'system_limits', label: 'System limits', power_kw: null, disabled: false }]);
  const conflict = manualPowerOptions({ charge: { min_kw: 10, device_max_kw: 5 } }, 'charge');
  assert.equal(conflict.valid_bounds, false);
  assert.ok(conflict.choices.every(choice => choice.disabled));
});
test('manual duration presets follow verified bounds and Custom defaults to at most 1440 minutes', () => {
  assert.deepEqual(manualDurationOptions(180).choices, [30, 60, 90, 120, 180].map(minutes => ({ minutes, disabled: false })));
  assert.deepEqual(manualDurationOptions(60).choices.filter(choice => !choice.disabled).map(choice => choice.minutes), [30, 60]);
  assert.ok(manualDurationOptions(1).choices.every(choice => choice.disabled));
  assert.equal(manualDurationOptions(1440).max_minutes, 1440);
  for (const invalid of [undefined, null, '120', 0, -1, 1441, 60.5, NaN, Infinity, true]) assert.equal(manualDurationOptions(invalid).max_minutes, 1440);
});
test('artwork URLs reject active content and markup injection', () => {
  assert.equal(safeImageURL('javascript:alert(1)'), '');
  assert.equal(safeImageURL('//tracking.example/house.png'), '');
  assert.equal(safeImageURL('/local/house.png" onerror="bad'), '');
  assert.equal(safeImageURL('/local/house.png'), '/local/house.png');
  assert.equal(escapeHTML('<img src=x onerror="bad">'), '&lt;img src=x onerror=&quot;bad&quot;&gt;');
});
test('dashboard backgrounds render only validated colors and image URLs with day and night contrast layers', () => {
  const settings={type:'color',color:'#A1B2C3'},before=structuredClone(settings);
  const day=dashboardBackgroundStyle(settings,false),night=dashboardBackgroundStyle(settings,true);
  assert.ok(day.startsWith('background:linear-gradient('));assert.ok(day.endsWith(',#a1b2c3;'));
  assert.notEqual(day,night);assert.deepEqual(settings,before);
  for(const image of ['/local/dashboard.jpg','/api/image/serve/owned-image/original','https://images.example/dashboard.webp?size=large&v=2']){
    const css=dashboardBackgroundStyle({type:'image',image},false);
    assert.ok(css.startsWith('background:linear-gradient('));assert.ok(css.includes(`url("${image}")`));assert.ok(css.includes('center/cover no-repeat'));
  }
  for(const settings of [undefined,null,[],{}, {type:'theme',color:'#112233',image:'/local/photo.jpg'},{type:'unknown',color:'#112233'}])assert.equal(dashboardBackgroundStyle(settings),'');
});
test('dashboard backgrounds reject active markup, CSS injection, credential URLs and malformed values', () => {
  for(const color of ['',null,true,'#fff','#12345678','red','var(--background)','#112233;background:red','<style>'])assert.equal(dashboardBackgroundStyle({type:'color',color}),'');
  for(const image of ['',null,true,'http://images.example/background.jpg','//images.example/background.jpg','data:image/svg+xml,bad','javascript:alert(1)','https://','https://user:password@images.example/a.jpg','/local/a b.jpg','/local/a\nb.jpg','/local/a\u0000b.jpg','/local/a\\b.jpg','/local/a" onerror="bad','https://images.example/a);color:red','/local/a{background:red}','/local/a`b.jpg','/local/'+ 'a'.repeat(2048)])assert.equal(dashboardBackgroundStyle({type:'image',image}),'',String(image));
});
test('all overview scenes share the chosen outer background without changing or automatically saving preferences', t => {
  const previous=globalThis.localStorage;let writes=0;
  globalThis.localStorage={getItem:()=>null,setItem:()=>writes++};
  t.after(()=>{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;});
  const card=new SigenHybridCard(),settings={type:'image',image:'https://images.example/outer.jpg?v=2&width=1600'},before=structuredClone(settings);
  card._homepageBackground=()=>settings;
  for(const main_display of ['house','flow','photo']){
    card.setConfig({main_display,appearance:'day'});
    assert.match(card.shadowRoot.innerHTML,/<ha-card class="day" style="background:/);
    assert.ok(card.shadowRoot.innerHTML.includes('url(&quot;https://images.example/outer.jpg?v=2&amp;width=1600&quot;)'));
    assert.ok(card.shadowRoot.innerHTML.includes(`data-display="${main_display}"`));
  }
  card._homepageBackground=()=>({type:'theme'});card._render();
  assert.match(card.shadowRoot.innerHTML,/<ha-card class="day">/);
  assert.equal(writes,0);assert.deepEqual(settings,before);
});
test('fixed display cards may ignore a saved scene while temporary comparison previews still work', () => {
  const card=new SigenHybridCard(),saved={route:'display_settings',local_only:true,main_display:'photo'};
  card._detailContext=()=>({interfaceOptions:{display_settings:saved}});
  for(const follow_saved_display of [undefined,true]){card.setConfig({main_display:'house',...(follow_saved_display===undefined?{}:{follow_saved_display})});assert.equal(card._mainDisplay,'photo');}
  card.setConfig({main_display:'house',follow_saved_display:false});assert.equal(card._mainDisplay,'house');
  card._previewMainDisplay='flow';assert.equal(card._mainDisplay,'flow');
  assert.equal(saved.main_display,'photo');
  for(const follow_saved_display of ['false',0,null,{}])assert.throws(()=>card.setConfig({follow_saved_display}),/Follow saved display/);
});
test('discovery is limited to chosen config entry and enabled own-platform sensors', () => {
  const row = { platform: 'sigen_hybrid', config_entry_id: 'chosen', unique_id: 'synthetic_pv_kw', entity_id: 'sensor.solar' };
  assert.deepEqual(discoverEntities([row, { ...row, entity_id: 'sensor.other', config_entry_id: 'other' }, { ...row, entity_id: 'sensor.disabled', disabled_by: 'user' }], 'chosen'), { solar_power: 'sensor.solar' });
  assert.deepEqual(discoverEntities([row], ''), {});
  assert.deepEqual(discoverEntities([
    { ...row, unique_id: 'synthetic_cloud_mode', entity_id: 'sensor.cloud_mode' },
    { ...row, unique_id: 'synthetic_cloud_status', entity_id: 'sensor.cloud_status' },
    { ...row, unique_id: 'synthetic_forecast_today', entity_id: 'sensor.forecast_today' },
    { ...row, unique_id: 'synthetic_forecast_tomorrow', entity_id: 'sensor.forecast_tomorrow' },
  ], 'chosen'), { cloud_mode: 'sensor.cloud_mode', cloud_status: 'sensor.cloud_status', forecast_today: 'sensor.forecast_today', forecast_tomorrow: 'sensor.forecast_tomorrow' });
});
test('component configuration, sections sizing, and device presence', () => {
  const card = new SigenHybridCard();
  card.setConfig({ view: 'flow', entities: { solar_power: 'sensor.test_solar', battery_soc: 'sensor.test_soc' } });
  assert.deepEqual(card.getGridOptions(), { columns: 12, rows: 'auto', min_columns: 6 });
  assert.deepEqual(card._equipment(), ['solar', 'battery']);
  assert.ok(card.shadowRoot.innerHTML.includes('Solar'));
  assert.ok(!card.shadowRoot.innerHTML.includes('DC charger</text>'));
  assert.throws(() => card.setConfig({ entities: { battery_power: 'switch.anything' } }));
  assert.throws(() => card.setConfig({ view: 'invalid' }));
});
test('device inventory cannot introduce actuator mappings or malformed nested collections', () => {
  for (const devices of [{ id: 'one' }, ['invalid'], [null], [{ entities: [] }], [{ entities: 'sensor.example' }], [{ id: 'one', entities: { battery_soc: 'switch.infrastructure' } }], [{ id: 'one', entities: { temperature: 'sensor.x" onclick="bad' } }]]) {
    const card = new SigenHybridCard();
    assert.throws(() => card.setConfig({ devices }));
  }
  const card = new SigenHybridCard();
  assert.doesNotThrow(() => card.setConfig({ devices: [{ id: 'one', type: 'battery_module', entities: { battery_soc: 'sensor.module_soc', status: 'binary_sensor.module_online', temperature: null } }] }));
});

test('malformed optimizer rows fail configuration clearly and module mappings cannot point at actuators',()=>{
  const card=new SigenHybridCard();
  for(const row of [null,[],123,'sensor.panel'])assert.throws(()=>card.setConfig({optimizers:[row]}),/Invalid optimizer module mapping/);
  for(const row of [{power:'switch.panel'},{power:'sensor.panel',energy:'button.reset'},{power:12}])assert.throws(()=>card.setConfig({optimizers:[row]}),/Map optimizer sensor entities only/);
  assert.doesNotThrow(()=>card.setConfig({optimizers:[{name:'Uninstalled panel',power:null},{power:'sensor.panel',energy:'sensor.panel_energy'}]}));
});

test('per-device-only state and unit changes refresh device details while plant readings stay unchanged', () => {
  const card = new SigenHybridCard();
  card.setConfig({ entities: { battery_soc: 'sensor.plant_soc' }, devices: [{ id: 'one', type: 'battery_module', entities: { battery_soc: 'sensor.module_soc' } }] });
  let renders = 0; card._render = () => { renders++; };
  const base = { 'sensor.plant_soc': state('75', '%'), 'sensor.module_soc': state('20', '%') };
  card.hass = { states: base };
  assert.equal(renders, 1);
  assert.ok(card._detailModel('battery_module', 'one').body.includes('20 %'));
  card.hass = { states: { ...base, 'sensor.module_soc': state('30', '%') } };
  assert.equal(renders, 2);
  assert.ok(card._detailModel('battery_module', 'one').body.includes('30 %'));
  card.hass = { states: { ...base, 'sensor.module_soc': state('30', 'kWh') } };
  assert.equal(renders, 3);
  assert.ok(!card._detailModel('battery_module', 'one').body.includes('30 %'));
  assert.equal(card._value('battery_soc', 'soc'), 75);
});

test('invalid battery SOC is unavailable instead of a plausible clamped full or empty battery', () => {
  for (const invalid of ['-.1', '100.1', '-1', '101']) assert.equal(measurement(state(invalid, '%'), 'soc'), null);
  assert.equal(measurement(state('0', '%'), 'soc'), 0);
  assert.equal(measurement(state('100', '%'), 'soc'), 100);
  const card = new SigenHybridCard(); card.setConfig({ entities: { battery_soc: 'sensor.soc' } });
  card._hass = { states: { 'sensor.soc': state('101', '%') } };
  assert.ok(/class="soc-ring"[^>]*><strong>—<\/strong>/.test(card._battery()));
});
test('appearance follows sun with manual and theme fallbacks', () => {
  const card = new SigenHybridCard(); card.setConfig({ appearance: 'auto' });
  card.hass = { states: { 'sun.sun': state('below_horizon', '') }, themes: { darkMode: false } };
  assert.equal(card._night(), true);
  card.setConfig({ appearance: 'day' }); assert.equal(card._night(), false);
  card.setConfig({ appearance: 'theme' }); assert.equal(card._night(), false);
});
test('unknown power units do not become chart zero after sign conversion', () => {
  const card = new SigenHybridCard(); card.setConfig({ entities: { home_power: 'sensor.home' } });
  card._hass = { states: { 'sensor.home': state('1', 'V') }, config: { time_zone: 'UTC' } };
  card._history = { 'sensor.home': [{ start: Date.now() - 1000, mean: 1 }] };
  assert.ok(card._chart([['home_power', 'Home', '#a45bf0', -1]]).includes('No recorded history'));
});
test('live control requires the explicit backend API contract and never calls generic household switches', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../custom_components/sigen_hybrid/frontend/sigen-hybrid-card.js', import.meta.url), 'utf8');
  assert.ok(source.includes('control.control_api_version === 1'));
  assert.ok(source.includes('dry_run: !nativeApi'));
  assert.ok(source.includes('data.request_id = requestId'));
  assert.ok(!source.includes("service: 'turn_off'"));
});
test('house animation follows measured direction and stops for idle, unknown and stale data', () => {
  const now=Date.now(), live=(v)=>({...state(v,'kW'),attributes:{unit_of_measurement:'kW',observed_at:new Date(now).toISOString()}});
  assert.deepEqual(flowActivity(live('2'), 'battery', now), {value:2,fresh:true,active:true,reverse:true});
  assert.deepEqual(flowActivity(live('-2'), 'battery', now), {value:-2,fresh:true,active:true,reverse:false});
  assert.equal(flowActivity(live('0'), 'battery', now).fresh,true);
  assert.equal(flowActivity(live('0'), 'battery', now+121000).fresh,false);
  assert.equal(flowActivity(live('-2'),'grid',now).reverse,true);
  assert.equal(flowActivity(live('0'),'solar',now).active,false);
  assert.equal(flowActivity(live('unavailable'),'solar',now).active,false);
  assert.equal(flowActivity(live('2'),'solar',now+121000).active,false);
  const card=new SigenHybridCard();card.setConfig({animations:false,entities:{solar_power:'sensor.solar'}});card._hass={states:{'sensor.solar':live('2')}};
  assert.ok(!card._houseWires().includes('portal-pulse moving'));
});
test('cloud flow animation follows the verified cache lifetime without relaxing local freshness', () => {
  const now = Date.now();
  const cloud = (age, attributes = {}, value = '1.5') => ({ state: value, attributes: { unit_of_measurement: 'kW', data_source: 'sigenergy_cloud', poll_interval_seconds: 900, observed_at: new Date(now - age * 1000).toISOString(), ...attributes } });
  assert.equal(flowActivity(cloud(900), 'grid', now).active, true);
  assert.equal(flowActivity(cloud(1800), 'grid', now).active, true);
  assert.equal(flowActivity(cloud(1801), 'grid', now).active, false);
  assert.equal(flowActivity(cloud(900), 'grid', now, 120000).active, false);
  assert.equal(flowActivity(cloud(900, { data_source: 'modbus' }), 'grid', now).active, false);
  for (const interval of [undefined, null, 0, -900, '900', NaN, Infinity, 901]) {
    assert.equal(flowActivity(cloud(900, { poll_interval_seconds: interval }), 'grid', now).active, false, String(interval));
  }
  for (const value of ['unknown', 'unavailable', 'failed', '0']) assert.equal(flowActivity(cloud(30, {}, value), 'grid', now).active, false, value);
  assert.equal(flowActivity(cloud(30, { available: false }), 'grid', now).active, false);
  assert.equal(flowActivity(cloud(-6), 'grid', now).active, false);
  assert.equal(flowActivity(cloud(900, { observed_at: 'invalid' }), 'grid', now).active, false);
  assert.equal(flowActivity(cloud(121, { data_source: 'modbus' }), 'grid', now).active, false);
  assert.equal(flowActivity(cloud(121, { data_source: 'modbus' }), 'grid', now, 180000).active, true);
});
test('Sankey preserves independent measured totals and contains proportional complete ribbons', () => {
  const source=[{key:'solar',value:18.6},{key:'battery',value:10.4},{key:'grid',value:8}];
  const sink=[{key:'battery',value:12.2},{key:'home',value:24.8},{key:'ac',value:0},{key:'grid',value:0}];
  const model=energySankey(source,sink);
  assert.equal(model.totalLeft,37);assert.equal(model.totalRight,37);
  for(const n of model.left){const sum=model.links.filter(l=>l.source.key===n.key).reduce((s,l)=>s+l.value,0);assert.ok(Math.abs(sum-n.value)<.001);}
  assert.ok(model.links.every(l=>l.source.key!==l.target.key));
  assert.equal(model.links.filter(l=>l.target.key==='ac'||l.target.key==='grid').length,0);
  assert.equal(model.right.at(-1).y+model.right.at(-1).height,480);
});
test('Sankey omits estimated allocation for incomplete, conflicting or impossible totals', () => {
  assert.equal(energySankey([{key:'solar',value:null}],[{key:'home',value:1}]).links.length,0);
  assert.equal(energySankey([{key:'solar',value:10}],[{key:'home',value:1}]).links.length,0);
  assert.equal(energySankey([{key:'battery',value:10}],[{key:'battery',value:10}]).links.length,0);
});
test('concurrent inline and popup Sankeys have independent gradient scopes and valid local references', () => {
  const totals = { solar_today: 18.6, home_today: 24.8, battery_charge_today: 12.2, battery_discharge_today: 10.4, grid_import_today: 8, grid_export_today: 0 };
  const card = new SigenHybridCard();
  card.setConfig({ view: 'statistics', entities: Object.fromEntries(Object.keys(totals).map(key => [key, `sensor.${key}`])) });
  card.hass = { states: Object.fromEntries(Object.entries(totals).map(([key, value]) => [`sensor.${key}`, state(String(value), 'kWh')])), config: { time_zone: 'UTC' } };
  const inline = card._statistics(), popup = card._detailModel('statistics').body;
  const ids = html => [...html.matchAll(/<linearGradient id="([^"]+)"/g)].map(match => match[1]);
  const inlineIds = ids(inline), popupIds = ids(popup);
  assert.ok(inlineIds.length > 0 && popupIds.length > 0, 'balanced measured totals must produce ribbons in both views');
  assert.equal(new Set([...inlineIds, ...popupIds]).size, inlineIds.length + popupIds.length);
  for (const [html, localIds] of [[inline, inlineIds], [popup, popupIds]]) {
    const references = [...html.matchAll(/fill="url\(#([^)]*)\)"/g)].map(match => match[1]);
    assert.equal(references.length, localIds.length);
    assert.ok(references.every(id => localIds.includes(id)), 'each ribbon must reference a gradient in its own SVG');
  }
});
test('house and optimizer styles are bundled with geometry and cables cannot default to filled polygons', () => {
  const card=new SigenHybridCard();card.setConfig({view:'house',entities:{solar_power:'sensor.solar'}});
  assert.ok(card.shadowRoot.innerHTML.includes('.portal-cable{fill:none'));
  assert.ok(card.shadowRoot.innerHTML.includes('.panel-module{'));
  assert.ok(card._houseWires().includes('fill="none"'));
  assert.ok(card._houseWires().includes('stroke="#bac6cd"'));
});

test('partial artwork keeps the gateway target stable even with battery and charger entity mappings', () => {
  const card = new SigenHybridCard();
  card.setConfig({ appearance: 'day', entities: { battery_soc: 'sensor.soc', battery_power: 'sensor.battery', ac_power: 'sensor.ac', dc_power: 'sensor.dc' }, images: { day: { gateway: '/local/gateway.png' } } });
  const sprites = [...card._house().matchAll(/<svg\b[^>]*class="portal-equipment"[^>]*>[\s\S]*?<\/svg>/g)].map(match => match[0]);
  assert.equal(sprites.length, 1);
  const frame = sprites[0].match(/^<svg\b[^>]*>/)[0], hit = sprites[0].match(/<rect\b[^>]*class="portal-equipment-hit"[^>]*\/>/)[0];
  assert.ok(frame.includes('data-equipment="gateway"'));
  assert.ok(!/\b(?:data-detail|role|tabindex|aria-label)=/.test(frame));
  assert.ok(hit.includes('data-detail="gateway" role="button" tabindex="0" aria-label="Energy Gateway details"'));
  assert.ok(sprites[0].match(/<image\b[^>]*>/)[0].includes('pointer-events="none"'));
});

test('all four equipment sprites expose keyboard targets and transparent hit areas covering their visible crop', () => {
  const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
  const expected = { battery: ['476 553 127 268', 'SigenStor'], gateway: ['659 619 79 119', 'Energy Gateway'], ac: ['50 489 42 84', 'AC charger'], dc: ['254 599 61 144', 'DC charger'] };
  for (const appearance of ['day', 'night']) {
    const card = new SigenHybridCard();
    card.setConfig({ appearance, entities: { battery_soc: 'sensor.soc', battery_power: 'sensor.battery', ac_power: 'sensor.ac', dc_power: 'sensor.dc' }, images: { [appearance]: { battery: '/local/battery.png', gateway: '/local/gateway.png', ac: '/local/ac.png', dc: '/local/dc.png' } } });
    const sprites = [...card._house().matchAll(/<svg\b[^>]*class="portal-equipment"[^>]*>[\s\S]*?<\/svg>/g)].map(match => match[0]);
    assert.equal(sprites.length, 4);
    const seen = new Set();
    for (const sprite of sprites) {
      const frame = attributes(sprite.match(/^<svg\b[^>]*>/)[0]), equipment = frame['data-equipment']; seen.add(equipment);
      const crop = appearance === 'night' && equipment === 'ac' ? '55 482 53 88' : appearance === 'night' && equipment === 'dc' ? '251 594 44 129' : expected[equipment][0];
      assert.equal(frame.viewBox, crop, `${appearance} ${equipment} preserves its original crop`);
      for (const name of ['data-detail', 'role', 'tabindex', 'aria-label']) assert.equal(frame[name], undefined, `inert ${equipment} SVG ${name}`);
      const hit = attributes(sprite.match(/<rect\b[^>]*class="portal-equipment-hit"[^>]*\/>/)[0]);
      const [x, y, width, height] = crop.split(' ');
      assert.deepEqual([hit.x, hit.y, hit.width, hit.height], [x, y, width, height]);
      assert.equal(hit.fill, 'transparent'); assert.equal(hit['data-detail'], equipment);
      assert.equal(hit.role, 'button'); assert.equal(hit.tabindex, '0'); assert.equal(hit['aria-label'], `${expected[equipment][1]} details`);
      assert.equal(attributes(sprite.match(/<image\b[^>]*>/)[0])['pointer-events'], 'none');
    }
    assert.deepEqual([...seen].sort(), ['ac', 'battery', 'dc', 'gateway']);
  }
});

test('header badges route operating mode and explicit grid status without export permission copy', () => {
  const card = new SigenHybridCard();
  card.setConfig({});
  for (const [state, label] of [['On Grid','On Grid'],['Off Grid','Off Grid'],['Importing','Grid unavailable'],['unknown','Grid unavailable']]) {
    card._state = key => key === 'grid_status' ? {state} : key === 'cloud_mode' ? {state:'Time of Use'} : key === 'export_permitted' ? {state:'off'} : null;
    const html = card._header();
    assert.match(html, /data-detail="mode"/);
    assert.ok(html.includes(`aria-label="${label}. Grid connection options"`));
    assert.ok(html.includes('>Time of Use</button>'));
    assert.doesNotMatch(html, /Export off|Export allowed/);
  }
});

test('live cloud cards show real mode and forecast totals without development copy', () => {
  const card = new SigenHybridCard();
  card.setConfig({ config_entry: 'chosen', entities: {
    cloud_mode: 'sensor.mode', control_status: 'sensor.control', forecast_status: 'sensor.provider',
    forecast_today: 'sensor.today', forecast_tomorrow: 'sensor.tomorrow', export_permitted: 'binary_sensor.export',
  } });
  card.hass = { states: {
    'sensor.mode': state('Sigen AI Mode', ''),
    'sensor.control': { state: 'live_writes_locked', attributes: { live_writes_locked: true } },
    'sensor.provider': state('forecast_solar', ''),
    'sensor.today': state('10.788', 'kWh'),
    'sensor.tomorrow': state('8.857', 'kWh'),
    'binary_sensor.export': state('off', ''),
  } };
  const body = card.shadowRoot.innerHTML;
  assert.ok(body.includes('Sigen AI Mode'));
  assert.ok(body.includes('Forecast.Solar'));
  assert.ok(body.includes('10.79 kWh') && body.includes('8.86 kWh'));
  assert.ok(!body.includes('Export off'));
  assert.match(body, /data-detail="mode"[^>]*aria-label="Sigen AI Mode\. Change operating mode"/);
  assert.match(body, /data-detail="grid_connection"/);
  assert.ok(!/development preview|preview only|Local first|Cached provider|Sample data|Map recorded|<footer>/i.test(body));
  assert.equal((body.match(/data-preview=/g) ?? []).length, 5);
  assert.ok(card._today().includes('Energy today'));
  assert.equal(card._optimizers(), '');
});

test('mapped simulated equipment stays visible without sample markers', () => {
  const card = new SigenHybridCard();
  const optimizers = Array.from({ length: 22 }, (_, i) => ({ power: `sensor.panel_${i + 1}`, string: `String ${i < 11 ? 1 : 2}` }));
  card.setConfig({ entities: { solar_power: 'sensor.solar', dc_power: 'sensor.dc', forecast_today: 'sensor.forecast' }, optimizers });
  card.hass = { states: {
    'sensor.solar': state('1.4', 'kW'),
    'sensor.dc': { state: '0', attributes: { unit_of_measurement: 'kW', sample_data: true } },
    'sensor.forecast': state('8.8', 'kWh'),
    ...Object.fromEntries(optimizers.map(m => [m.power, { state: '362', attributes: { unit_of_measurement: 'W', sample_data: true, observed_at: new Date().toISOString() } }])),
  } };
  assert.deepEqual(card._equipment(), ['solar', 'dc']);
  assert.equal(card._value('solar_power'), 1.4);
  assert.equal(card._value('dc_power'), 0);
  assert.ok(card._forecast().includes('8.8 kWh'));
  const modules = card._optimizers();
  assert.equal((modules.match(/class="panel-module"/g) ?? []).length, 22);
  assert.ok(modules.includes('362 W'));
  assert.ok(modules.includes('String 1') && modules.includes('String 2'));
  assert.ok(!/Sample data|sample_data|simulated|preview/i.test(modules));
});

test('only explicit simulated optimizers bypass age checks and still require valid readings', () => {
  const now = Date.now(), old = new Date(now - 3600000).toISOString();
  const panel = (value, sample, observed = old) => ({ state: value, attributes: { unit_of_measurement: 'W', sample_data: sample, ...(observed ? { observed_at: observed } : {}) } });
  const readings = {
    simulated_old: panel('362', true),
    simulated_undated: panel('363', true, null),
    simulated_invalid: panel('invalid', true),
    simulated_unavailable: panel('unavailable', true),
    real_old: panel('364', false),
    real_fresh: panel('365', false, new Date(now - 1200000).toISOString()),
    real_undated: panel('366', false, null),
    real_future: panel('367', false, new Date(now + 6000).toISOString()),
    string_flag: panel('368', 'true'),
  };
  const card = new SigenHybridCard();
  card.setConfig({ view: 'optimizers', optimizers: [...Object.keys(readings), 'missing'].map(name => ({ power: `sensor.${name}` })) });
  card._now = () => now;
  card._hass = { states: Object.fromEntries(Object.entries(readings).map(([name, value]) => [`sensor.${name}`, value])) };
  const modules = card._optimizers();
  for (const [name, expected] of Object.entries({ simulated_old: '362 W', simulated_undated: '363 W', real_fresh: '365 W', simulated_invalid: '—', simulated_unavailable: '—', real_old: '—', real_undated: '—', real_future: '—', string_flag: '—', missing: '—' })) {
    const button = modules.split(`data-entity="sensor.${name}"`)[1].split('</button>')[0];
    assert.ok(button.includes(`<strong>${expected}</strong>`), name);
  }
});

test('read-only cards retain all controls and open a local form without sending requests', async () => {
  const card = new SigenHybridCard(); card.setConfig({ config_entry: 'chosen', entities: { control_status: 'sensor.control' } });
  let calls = 0;
  card.hass = { states: { 'sensor.control': { state: 'live_writes_locked', attributes: { live_writes_locked: true } } }, callWS: () => { calls++; } };
  const original = globalThis.document, fixture = dialogFixture();
  globalThis.document = { createElement: () => fixture.dialog };
  card.shadowRoot.appendChild = () => {};
  try {
    card._openPreview('charge');
    assert.ok(card._dialogOpen);
    assert.ok(fixture.dialog.innerHTML.includes('id="preview-confirm" disabled>Apply'));
    assert.ok(fixture.dialog.innerHTML.includes('name="duration_choice"'));
    assert.ok(fixture.dialog.innerHTML.includes('min="1" max="1440" step="1"'));
    assert.ok(fixture.dialog.innerHTML.includes('<option value="custom" selected>Custom</option>'));
    assert.ok(!fixture.dialog.innerHTML.includes('max="100"'));
    assert.ok(!fixture.dialog.innerHTML.includes('name="power" type="number" value="1"'));
    assert.ok(!fixture.dialog.innerHTML.includes('No device command'));
    await fixture.handlers.click();
    assert.ok(fixture.button.disabled);
    assert.equal(fixture.output.textContent, '');
  } finally { globalThis.document = original; }
  assert.equal(calls, 0);
  assert.ok(!card._controls().includes('Read-only'));
  assert.equal((card._controls().match(/data-preview=/g) ?? []).length, 5);
});

test('battery-to-grid has its own locked popup and never dispatches ordinary discharge',async()=>{
  const original=globalThis.document;
  try{
    for(const permission of ['off','on','unknown']){
      const card=new SigenHybridCard();card.setConfig({config_entry:'chosen',entities:{control_status:'sensor.control',export_permitted:'binary_sensor.export'}});
      let calls=0;
      card._hass={states:{'sensor.control':{state:'ready',attributes:{live_writes_locked:false,manual_control_power:{discharge:{device_max_kw:6}}}},'binary_sensor.export':state(permission,'')},callWS:async()=>{calls++;}};
      const fixture=dialogFixture();globalThis.document={createElement:()=>fixture.dialog};card.shadowRoot.appendChild=()=>{};
      assert.match(card._controls(),/data-preview="battery_export">Discharge to Grid/);
      card._openPreview('battery_export');
      assert.match(fixture.dialog.innerHTML,/<h2 id="sigen-manual-heading">Discharge Battery to Grid<\/h2>/);
      assert.match(fixture.dialog.innerHTML,/Device maximum \(6 kW\)/);
      assert.match(fixture.dialog.innerHTML,/id="preview-confirm" disabled>Apply/);
      assert.doesNotMatch(fixture.dialog.innerHTML,/not connected yet/);
      if(permission==='off')assert.match(fixture.dialog.innerHTML,/Export permission is off/);
      if(permission==='unknown')assert.match(fixture.dialog.innerHTML,/Export permission is not confirmed/);
      await fixture.handlers.click();assert.equal(calls,0);assert.equal(fixture.button.disabled,true);
      fixture.handlers.cancelClick();assert.equal(fixture.dialog.closed,'cancel');
    }
  }finally{globalThis.document=original;}
});

test('paused cloud overrides a stale unlocked state and retains cached System limits without requests', async () => {
  const card = new SigenHybridCard();
  card.setConfig({ config_entry: 'chosen', cloud_paused: true, manual_control_power: { charge: { app_unlimited: true } }, entities: { control_status: 'sensor.control' } });
  let requests = 0;
  card._hass = { states: { 'sensor.control': { state: 'ready', attributes: { live_writes_locked: false, max_duration_minutes: 1440 } } }, callWS: async () => { requests++; } };
  assert.equal(card._readOnly(), true);
  const original = globalThis.document, fixture = dialogFixture();
  globalThis.document = { createElement: () => fixture.dialog }; card.shadowRoot.appendChild = () => {};
  try {
    card._openPreview('charge');
    assert.ok(card._dialogOpen);
    assert.ok(fixture.dialog.innerHTML.includes('value="system_limits" selected>System limits'));
    assert.ok(fixture.dialog.innerHTML.includes('id="preview-confirm" disabled>Apply'));
    fixture.choice.value = 'system_limits'; await fixture.handlers.click();
    fixture.choice.value = 'custom'; fixture.handlers.selectionChange(); fixture.form.elements.power.value = '2'; await fixture.handlers.click();
    assert.equal(requests, 0);
    assert.equal(fixture.output.textContent, '');
    assert.equal(fixture.button.disabled, true);
    fixture.handlers.cancelClick(); assert.equal(card._dialogOpen, false);
  } finally { globalThis.document = original; }
});

test('unlocked command forms still request only dry-run previews and lock changes block requests', async () => {
  const card = new SigenHybridCard(); card.setConfig({ config_entry: 'chosen', entities: { control_status: 'sensor.control' } });
  const requests = [];
  card._hass = { states: { 'sensor.control': { state: 'ready', attributes: { live_writes_locked: false } } }, callWS: async request => { requests.push(request); return { response: { message: 'Preview ready' } }; } };
  const original = globalThis.document, fixture = dialogFixture();
  globalThis.document = { createElement: () => fixture.dialog };
  card.shadowRoot.appendChild = () => {};
  try {
    card._openPreview('charge');
    assert.ok(!fixture.dialog.innerHTML.includes('id="preview-confirm" disabled'));
    await fixture.handlers.click();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].service_data.dry_run, true);
    card._hass.states['sensor.control'].attributes.live_writes_locked = true;
    await fixture.handlers.click();
    assert.equal(requests.length, 1);
    assert.ok(fixture.button.disabled);
  } finally { globalThis.document = original; }
});

test('native command jobs require the matching entry and keep a stable request ID after response loss', async () => {
  const card=new SigenHybridCard();card.setConfig({config_entry:'chosen',entities:{control_status:'sensor.control'}});
  const attributes={control_api_version:1,config_entry_id:'chosen',live_writes_locked:false,export_permitted:true,capabilities:{manual_control:{available:true}},manual_control_power:{discharge:{device_max_kw:6}}};
  const requests=[];
  card._hass={states:{'sensor.control':{state:'idle',attributes}},callWS:async request=>{requests.push(request);if(requests.length===1)throw new Error('Synthetic lost response');return {response:{request_id:request.service_data.request_id,phase:'queued',message:'Checking plant state'}};}};
  const original=globalThis.document,fixture=dialogFixture();globalThis.document={createElement:()=>fixture.dialog};card.shadowRoot.appendChild=()=>{};
  try{
    card._openPreview('battery_export');assert.equal(fixture.button.textContent,'Apply');
    await fixture.handlers.click();await fixture.handlers.click();
    assert.equal(requests.length,2);
    const [first,second]=requests.map(request=>request.service_data);
    assert.equal(first.request_id,second.request_id);
    assert.equal(second.mode,'discharge');assert.equal(second.export_requested,true);assert.equal(second.dry_run,false);
    assert.equal(fixture.button.disabled,true);
    attributes.operation={request_id:second.request_id,phase:'confirmed',message:'Mode and expiry confirmed'};
    card._syncManualOperation();assert.equal(fixture.output.textContent,'Mode and expiry confirmed');assert.equal(fixture.button.disabled,false);
  }finally{globalThis.document=original;}
});

test('a stale unlocked sensor from a different configuration never authorizes execution', async () => {
  const card=new SigenHybridCard();card.setConfig({config_entry:'chosen',entities:{control_status:'sensor.control'}});
  const requests=[];
  card._hass={states:{'sensor.control':{state:'idle',attributes:{control_api_version:1,config_entry_id:'another',live_writes_locked:false,capabilities:{manual_control:{available:true}}}}},callWS:async request=>{requests.push(request);return {};}};
  const original=globalThis.document,fixture=dialogFixture();globalThis.document={createElement:()=>fixture.dialog};card.shadowRoot.appendChild=()=>{};
  try{card._openPreview('hold');await fixture.handlers.click();assert.equal(requests.length,1);assert.equal(requests[0].service_data.dry_run,true);}finally{globalThis.document=original;}
});

test('active manual-control popup can release its owned command and shows confirmed completion', async()=>{
  const card=new SigenHybridCard();card.setConfig({config_entry:'chosen',entities:{control_status:'sensor.control'}});
  const attributes={control_api_version:1,config_entry_id:'chosen',live_writes_locked:false,manual_until:new Date(Date.now()+60000).toISOString(),capabilities:{manual_control:{available:true}}};
  const requests=[];card._hass={states:{'sensor.control':{state:'confirmed',attributes}},callWS:async request=>{requests.push(request);return {response:{request_id:'release',phase:'cancelling',message:'Releasing control'}};}};
  const original=globalThis.document,fixture=dialogFixture();globalThis.document={createElement:()=>fixture.dialog};card.shadowRoot.appendChild=()=>{};
  try{
    card._openPreview('hold');assert.match(fixture.dialog.innerHTML,/id="control-release">Stop control/);
    await fixture.handlers.releaseClick();assert.equal(requests[0].service,'cancel_manual_control');assert.equal(fixture.output.textContent,'Releasing control');
    attributes.manual_until=null;attributes.operation={request_id:'release',phase:'restored',message:'Control released'};card._syncManualOperation();
    assert.equal(fixture.output.textContent,'Control released');assert.equal(fixture.release.hidden,true);
  }finally{globalThis.document=original;}
});

test('manual power selection and custom values enforce current verified limits without invented defaults', async () => {
  const card = new SigenHybridCard(); card.setConfig({ config_entry: 'chosen', entities: { control_status: 'sensor.control' } });
  const requests = [], power = { charge: { app_default_kw: 5, device_max_kw: 10, user_max_kw: 8, min_kw: .5 } };
  card._hass = { states: { 'sensor.control': { state: 'ready', attributes: { live_writes_locked: false, manual_control_power: power } } }, callWS: async request => { requests.push(request); return {}; } };
  const original = globalThis.document, fixture = dialogFixture();
  globalThis.document = { createElement: () => fixture.dialog }; card.shadowRoot.appendChild = () => {};
  try {
    card._openPreview('charge');
    assert.ok(fixture.dialog.innerHTML.includes('Sigen app limit (5 kW)'));
    assert.ok(fixture.dialog.innerHTML.includes('Owner maximum (8 kW)'));
    assert.ok(fixture.dialog.innerHTML.includes('value="device_max" disabled>Device maximum (10 kW) — outside configured bounds'));
    assert.ok(fixture.dialog.innerHTML.includes('min="0.5" max="5"'));
    const input = fixture.dialog.innerHTML.match(/<input name="power"[^>]*>/)[0];
    assert.ok(!input.includes('value='));
    fixture.choice.value = 'custom'; fixture.handlers.selectionChange();
    assert.equal(fixture.customPower.hidden, false); assert.equal(fixture.form.elements.power.required, true);
    for (const invalid of ['', '0', '-1', '.4', '5.01', '8.01', 'Infinity', 'bad']) { fixture.form.elements.power.value = invalid; await fixture.handlers.click(); }
    assert.equal(requests.length, 0);
    fixture.form.elements.power.value = '4.5'; await fixture.handlers.click();
    assert.equal(requests.length, 1); assert.equal(requests[0].service_data.power_kw, 4.5); assert.equal(requests[0].service_data.dry_run, true);
    power.charge.user_max_kw = 2; await fixture.handlers.click(); assert.equal(requests.length, 1);
    power.charge.user_max_kw = 8;
    fixture.choice.value = 'app_default'; fixture.handlers.selectionChange();
    assert.equal(fixture.customPower.hidden, true); assert.equal(fixture.form.elements.power.disabled, true);
    await fixture.handlers.click(); assert.equal(requests.length, 2); assert.equal(requests[1].service_data.power_kw, 5);
  } finally { globalThis.document = original; }
});

test('manual dialogs dismiss independently of invalid or empty form inputs', () => {
  const card = new SigenHybridCard(); card.setConfig({ config_entry: 'chosen' });
  const original = globalThis.document, fixture = dialogFixture();
  fixture.form.reportValidity = () => false; fixture.form.elements.power.value = '';
  globalThis.document = { createElement: () => fixture.dialog }; card.shadowRoot.appendChild = () => {};
  try {
    card._openPreview('charge');
    fixture.durationChoice.value = 'custom'; fixture.handlers.durationChange(); fixture.form.elements.duration.value = '';
    assert.ok(fixture.dialog.innerHTML.includes('type="button" id="control-cancel"'));
    assert.ok(fixture.dialog.innerHTML.includes('type="button" id="control-close"'));
    fixture.handlers.cancelClick(); assert.equal(fixture.dialog.closed, 'cancel'); assert.equal(card._dialogOpen, false);
    card._openPreview('charge'); fixture.handlers.closeClick(); assert.equal(card._dialogOpen, false);
    let prevented = false;
    card._openPreview('charge'); fixture.handlers.dialog_cancel({ preventDefault: () => { prevented = true; } }); assert.ok(prevented); assert.equal(card._dialogOpen, false);
    card._openPreview('charge'); fixture.handlers.dialog_click({ target: fixture.dialog, clientX: 200, clientY: 200 }); assert.equal(card._dialogOpen, true);
    fixture.handlers.dialog_click({ target: fixture.dialog, clientX: 50, clientY: 200 }); assert.equal(card._dialogOpen, false);
  } finally { globalThis.document = original; }
});

test('duration presets and Custom send only bounded whole minutes and recheck changed limits', async () => {
  const card = new SigenHybridCard(); card.setConfig({ config_entry: 'chosen', entities: { control_status: 'sensor.control' } });
  const requests = [], attributes = { live_writes_locked: false, max_duration_minutes: 1440 };
  card._hass = { states: { 'sensor.control': { state: 'ready', attributes } }, callWS: async request => { requests.push(request); return {}; } };
  const original = globalThis.document, fixture = dialogFixture();
  globalThis.document = { createElement: () => fixture.dialog }; card.shadowRoot.appendChild = () => {};
  try {
    card._openPreview('hold');
    assert.ok(fixture.dialog.innerHTML.includes('value="30" selected>30 minutes'));
    for (const minutes of [30, 60, 90, 120, 180]) assert.ok(fixture.dialog.innerHTML.includes(`>${minutes} minutes</option>`));
    fixture.durationChoice.value = '180'; await fixture.handlers.click();
    assert.equal(requests.length, 1); assert.equal(requests[0].service_data.duration_minutes, 180); assert.equal(requests[0].service_data.dry_run, true);
    assert.ok(!('power_kw' in requests[0].service_data));
    fixture.durationChoice.value = 'custom'; fixture.handlers.durationChange();
    assert.equal(fixture.customDuration.hidden, false); assert.equal(fixture.form.elements.duration.required, true); assert.equal(fixture.form.elements.duration.disabled, false);
    for (const invalid of ['', '0', '-1', '1441', '45.5', 'Infinity', 'bad', true, false]) { fixture.form.elements.duration.value = invalid; await fixture.handlers.click(); }
    assert.equal(requests.length, 1);
    fixture.form.elements.duration.value = '1440'; await fixture.handlers.click();
    assert.equal(requests.length, 2); assert.equal(requests[1].service_data.duration_minutes, 1440); assert.equal(requests[1].service_data.dry_run, true);
    fixture.form.elements.duration.value = '45'; await fixture.handlers.click();
    assert.equal(requests.length, 3); assert.equal(requests[2].service_data.duration_minutes, 45);
    attributes.max_duration_minutes = 30; await fixture.handlers.click(); assert.equal(requests.length, 3);
    fixture.durationChoice.value = '180'; fixture.handlers.durationChange();
    assert.equal(fixture.customDuration.hidden, true); assert.equal(fixture.form.elements.duration.required, false); assert.equal(fixture.form.elements.duration.disabled, true);
    await fixture.handlers.click(); assert.equal(requests.length, 3);
    card._openPreview('hold');
    assert.ok(fixture.dialog.innerHTML.includes('value="180" disabled>180 minutes'));
    attributes.max_duration_minutes = 15; card._openPreview('hold');
    assert.ok(fixture.dialog.innerHTML.includes('value="custom" selected>Custom'));
    assert.ok(fixture.dialog.innerHTML.includes('min="1" max="15" step="1" required'));
  } finally { globalThis.document = original; }
});

test('unlimited app settings and missing metadata never invent numeric preview power', async () => {
  const card = new SigenHybridCard(); card.setConfig({ config_entry: 'chosen', entities: { control_status: 'sensor.control' } });
  let calls = 0;
  const attributes = { live_writes_locked: false, manual_control_power: { charge: { app_unlimited: true } } };
  card._hass = { states: { 'sensor.control': { state: 'ready', attributes } }, callWS: async () => { calls++; } };
  const original = globalThis.document, fixture = dialogFixture();
  globalThis.document = { createElement: () => fixture.dialog }; card.shadowRoot.appendChild = () => {};
  try {
    card._openPreview('charge');
    assert.ok(fixture.dialog.innerHTML.includes('value="system_limits" selected>System limits'));
    fixture.choice.value = 'system_limits'; await fixture.handlers.click();
    assert.equal(calls, 0); assert.equal(fixture.output.textContent, 'Choose a numeric power limit or Custom');
    attributes.manual_control_power = undefined;
    card._openPreview('charge');
    assert.ok(fixture.dialog.innerHTML.includes('value="custom" selected>Custom'));
    assert.ok(!fixture.dialog.innerHTML.includes('App limit ('));
    fixture.choice.value = 'custom'; fixture.form.elements.power.value = ''; await fixture.handlers.click();
    assert.equal(calls, 0); assert.equal(fixture.output.textContent, 'Enter a positive power in kW');
  } finally { globalThis.document = original; }
});

test('Energy today and tariff layouts retain all tiles with actual and mapped placeholder values', () => {
  const keys = ['solar_today', 'home_today', 'battery_discharge_today', 'battery_charge_today', 'grid_import_today', 'grid_export_today'];
  const card = new SigenHybridCard(); card.setConfig({ entities: { ...Object.fromEntries(keys.map(key => [key, `sensor.${key}`])), buy_price: 'sensor.buy', sell_price: 'sensor.sell' } });
  card._hass = { states: {
    ...Object.fromEntries(keys.map((key, index) => [`sensor.${key}`, { state: String(index + 1), attributes: { unit_of_measurement: 'kWh', ...(index ? { sample_data: true } : {}) } }])),
    'sensor.buy': state('0.09', 'EUR/kWh'), 'sensor.sell': state('0.18', 'EUR/kWh'),
  } };
  assert.equal((card._today().match(/class="entity tile"/g) ?? []).length, 6);
  for (const label of ['Solar', 'Home', 'Discharged', 'Charged', 'Imported', 'Exported']) assert.ok(card._today().includes(label));
  assert.ok(card._tariff().includes('Tariffs & strategy'));
  assert.ok(card._tariff().includes('0.09 EUR/kWh'));
  assert.ok(!/sample|preview|development/i.test(card._today()));
});

test('SOC-only history does not invent tariff axes or currency', () => {
  const card = new SigenHybridCard(); card.setConfig({ entities: { battery_soc: 'sensor.soc' } });
  card._hass = { states: { 'sensor.soc': state('75', '%') } };
  card._history = { 'sensor.soc': [{ start: Date.now() - 1000, mean: 75 }] };
  const chart = card._priceChart();
  assert.ok(chart.includes('SOC %'));
  assert.ok(!chart.includes('/kWh'));
  assert.ok(!chart.includes('>0.10</text>'));
  assert.ok(card._tariff().includes('Tariffs & strategy'));
});

test('forward forecast uses only real intervals and breaks missing hours', () => {
  const now = Date.now(), hour = 3600000, interval = (start, end, power) => ({ start: new Date(now + start * hour).toISOString(), end: new Date(now + end * hour).toISOString(), power_kw: power });
  const card = new SigenHybridCard(); card.setConfig({ view: 'forecast', entities: { forecast_today: 'sensor.today', forecast_tomorrow: 'sensor.tomorrow' } });
  card._hass = { states: {
    'sensor.today': { state: '3', attributes: { unit_of_measurement: 'kWh', series: [interval(1, 2, 1), interval(2, 3, 2)] } },
    'sensor.tomorrow': { state: '4', attributes: { unit_of_measurement: 'kWh', series: [interval(2, 3, 2), interval(5, 6, 4), interval(6, 7, null), interval(-3, -2, 99)] } },
  }, config: { time_zone: 'Europe/Dublin' } };
  const chart = card._forecastChart(), path = chart.match(/class="forecast-line" d="([^"]+)"/)[1];
  assert.equal((path.match(/M/g) ?? []).length, 2);
  assert.equal((path.match(/L/g) ?? []).length, 4);
  assert.ok(chart.includes('Production forecast'));
  assert.ok(chart.includes('kW'));
  assert.ok(!/NaN|Infinity|99\.0/.test(chart));
  assert.ok(card._content().includes('forecast-chart'));
  assert.ok(!card._forecast().includes('forecast-chart'));
});

test('unavailable and invalid forecasts never become a fabricated curve', () => {
  const card = new SigenHybridCard(); card.setConfig({ view: 'forecast', entities: { forecast_today: 'sensor.today' } });
  card._hass = { states: { 'sensor.today': { state: 'unavailable', attributes: { series: [{ start: '2027-01-01T12:00:00Z', end: '2027-01-01T13:00:00Z', power_kw: 2 }] } } } };
  assert.ok(!card._forecastChart().includes('forecast-line'));
  card._hass.states['sensor.today'].state = '10';
  card._hass.states['sensor.today'].attributes.series = [{ start: 'invalid', end: 'invalid', power_kw: 2 }];
  assert.ok(!card._forecastChart().includes('forecast-line'));
});

test('a fallback-only update refreshes the card while the failed primary stays unchanged',()=>{
  const card=new SigenHybridCard();
  card.setConfig({snapshot_at:'2026-10-28T12:00:00Z',entities:{solar_power:'sensor.local'},fallback_entities:{solar_power:['sensor.remote']}});
  card._discover=()=>{};
  let renders=0;card._render=()=>{renders++;};
  const local={state:'unavailable',attributes:{}},remote={state:'2',attributes:{data_source:'cloud',unit_of_measurement:'kW',observed_at:'2026-10-28T11:55:00Z'}};
  card.hass={states:{'sensor.local':local,'sensor.remote':remote}};
  const before=renders;
  card.hass={states:{'sensor.local':local,'sensor.remote':{...remote,state:'3'}}};
  assert.equal(renders,before+1);assert.equal(card._value('solar_power'),3);
});


test('interface theme follows Home Assistant independently of day and night house lighting',()=>{
 const card=new SigenHybridCard();card.setConfig({appearance:'day'});card._hass={states:{},themes:{darkMode:true}};
 assert.equal(card._night(),false);assert.equal(card._uiNight(),true);
 card.setConfig({appearance:'night'});card._hass={states:{},themes:{darkMode:false}};
 assert.equal(card._night(),true);assert.equal(card._uiNight(),false);
 card.setConfig({appearance:'auto'});card._hass={states:{'sun.sun':state('above_horizon','')},themes:{darkMode:true}};
 assert.equal(card._night(),false);assert.equal(card._uiNight(),true);
 let renders=0;card._render=()=>renders++;card.hass={states:card._hass.states,themes:{darkMode:true}};
 const previous=renders;card.hass={states:card._hass.states,themes:{darkMode:false}};assert.equal(renders,previous+1);
});
