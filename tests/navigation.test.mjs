import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { historySeries, routeForEntity, statisticsValues, installNavigation, refreshedChartData, savedDisplaySettings, moveDisplayModule, searchCatalogue, searchMatches, withServiceNavigation, availableCharts, mergeHistorySeries,fitSankeyWidth, dashboardEmbedTargets, embedDashboardCard, mergeInterfacePreferences, CARD_PRESETS, CARD_CHART_CHOICES, presetCardConfiguration } from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-navigation.js';
import { SETTINGS_ROUTES, DISPLAY_MODULES, DISPLAY_PRESETS, displayDefaults, encodeChargerScheduleId, decodeChargerScheduleId } from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-settings.js';
import { gapPaths, SigenHistoryChart, preserveChartScroll } from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-charts.js';
import { ENERGY_ROUTES } from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-energy.js';

const NOW = Date.parse('2026-10-27T01:00:00Z');
test('Sankey fills width at fixed height without stretching fonts or compounding resize coordinates',()=>{
  const node=(tag,attrs)=>({tagName:tag,getAttribute:key=>attrs[key]??null,setAttribute:(key,value)=>{attrs[key]=value;},attrs});
  const path=node('path',{d:'M120 10 C350 10 350 40 580 40 Z'}),box=node('rect',{x:'580',width:'120'}),pill=node('rect',{x:'586',width:'50'}),text=node('text',{x:'592','font-size':'25'});
  let width=1400;const attrs={},svg={getBoundingClientRect:()=>({width,height:480}),querySelectorAll:()=>[path,box,pill,text],setAttribute:(key,value)=>{attrs[key]=value;}};
  fitSankeyWidth(svg);assert.equal(attrs.viewBox,'0 0 1400 480');assert.equal(box.attrs.width,'240');assert.equal(pill.attrs.width,'50');assert.equal(text.attrs['font-size'],'25');assert.match(path.attrs.d,/M240 10 C700 10/);
  width=2100;fitSankeyWidth(svg);assert.equal(text.attrs.x,'1776');assert.equal(box.attrs.width,'360');
});
const state = (value, unit, attributes = {}) => ({ state: String(value), attributes: { unit_of_measurement: unit, ...attributes } });
function fixture(states = {}, history = {}, config = {}) {
  const entities = Object.fromEntries(Object.keys(states).filter(key => !key.includes('.')).map(key => [key, `sensor.${key}`]));
  const byId = { ...states, ...Object.fromEntries(Object.entries(entities).map(([key, id]) => [id, states[key]])) };
  return {
    _entities: entities, _history: history, _config: config,
    _hass: { states: byId, config: { time_zone: 'Europe/Dublin' } },
    _now: () => NOW, _night: () => false,
    _state: key => byId[entities[key] ?? key],
    _has: key => Boolean(entities[key]),
    _value: (key, quantity = 'power') => {
      const reading = byId[entities[key] ?? key]; if (!reading || ['unknown', 'unavailable'].includes(reading.state)) return null;
      const number = Number(reading.state); if (!Number.isFinite(number)) return null;
      const factor = quantity === 'soc' ? reading.attributes.unit_of_measurement === '%' ? 1 : null : quantity === 'energy' ? ({ Wh: .001, kWh: 1, MWh: 1000 })[reading.attributes.unit_of_measurement] : ({ W: .001, kW: 1, MW: 1000 })[reading.attributes.unit_of_measurement];
      return factor === null || factor === undefined ? null : number * factor;
    },
  };
}
class NavigationCard {
  constructor(data = fixture()) { Object.assign(this, data); this.shadowRoot = { querySelectorAll: () => [], querySelector: () => null }; }
  _render() {}
  _sceneSwitcher() { return '<div class="switcher"><button data-scene="house">House</button><button data-scene="flow">Flow</button><button data-scene="photo">Photo house</button></div>'; }
  _sceneContent() { return this._scene === 'flow' ? this._flow() : this._house(); }
  _overviewFrame(modules=[]) { return '<section class="overview-grid"><h2>Overview frame</h2>'+modules.map(key=>`<div data-display-module="${key}">${key==='manual_controls'?this._controls():key==='today'?this._today():key==='forecast'?this._forecast():this._battery()}</div>`).join('')+'</section>'; }
  _header() { return '<header><h1>My energy</h1></header>'; }
  _battery() { return '<section><div class="battery-summary">Battery</div></section>'; }
  _flow() { return '<div class="flow"><svg><g><rect width="10"/></g></svg></div>'; }
  _house() { return '<div><svg class="portal-scene"><rect class="portal-status-bg"/><text class="portal-temperature">Weather</text>'+['battery','gateway','ac','dc'].map(key=>`<svg x="185" y="495" width="25" height="49" viewBox="50 489 42 84" class="portal-equipment" data-equipment="${key}"><image href="/local/atlas.png" width="1170" height="1011"/><rect x="50" y="489" width="42" height="84" fill="transparent" class="portal-equipment-hit"/></svg>`).join('')+'<g data-entity="sensor.ac_power"><text>AC charger</text></g></svg></div>'; }
  _openPreview(mode) { this.manualMode = mode; }
  _power() { return '<section>Power<svg class="chart"></svg></section>'; }
  _singlePower() { return '<section>Series<svg class="chart"></svg></section>'; }
  _priceChart() { return '<svg class="chart"></svg>'; }
  _statistics() { return '<section><h2>Energy statistics</h2><span>Today · kWh</span><svg class="statistics"></svg></section>'; }
  _content(){return '<nav>Home navigation</nav><div class="overview-grid">Original sidebar</div>'+this._today();}
  _today(){return '<section>Today</section>';}
  _forecast(){return '<section>Forecast</section>';}
  _tariff(){return '<section>Tariff</section>';}
  _controls(){return '<section>Manual controls</section>';}
}
installNavigation(NavigationCard);

test('owner actions require the exact bound backend and preserve IDs across an uncertain retry',async()=>{
 const control={live_writes_locked:false,control_api_version:1,config_entry_id:'owned',capabilities:{native_mode:{available:true}},operation:{phase:'idle'}};
 const card=new NavigationCard(fixture({control_status:state('idle','',control)},{},{config_entry:'owned'}));
 const output={textContent:'',hidden:true},requests=[];card.shadowRoot={querySelector:()=>output};
 card._hass.callWS=async request=>{requests.push(request);throw new Error('Synthetic lost response');};
 await card._sendOwnerSetting('native_mode',{mode:2,profile_id:-1});
 await card._sendOwnerSetting('native_mode',{mode:2,profile_id:-1});
 assert.equal(requests.length,2);assert.equal(requests[0].service,'owner_setting');
 assert.equal(requests[0].service_data.dry_run,false);assert.equal(requests[0].service_data.request_id,requests[1].service_data.request_id);
 assert.deepEqual(requests[0].service_data.value,{mode:2,profile_id:-1});
 card._state('control_status').attributes.config_entry_id='different-plant-entry';
 await card._sendOwnerSetting('native_mode',{mode:0,profile_id:-1});assert.equal(requests.length,2);
 assert.match(output.textContent,/unavailable/);
});

test('owner action feedback follows the matching backend operation without a synthetic success',()=>{
 const control={operation:{request_id:'job',phase:'queued',message:'Checking plant state'}};
 const card=new NavigationCard(fixture({control_status:state('queued','',control)}));
 const output={hidden:true},button={disabled:false};card._detailDialog={querySelector:()=>output,querySelectorAll:()=>[button]};
 card._ownerSettingRequest={id:'job'};card._syncOwnerSetting();assert.equal(button.disabled,true);
 card._state('control_status').attributes.operation={request_id:'job',phase:'uncertain',message:'Waiting for reconciliation'};card._syncOwnerSetting();
 assert.equal(button.disabled,true);assert.match(output.textContent,/reconciliation/);
 card._state('control_status').attributes.operation={request_id:'job',phase:'restored',message:'Previous setting restored'};card._syncOwnerSetting();
 assert.equal(button.disabled,false);assert.equal(card._ownerSettingRequest.uncertain,false);
});

test('chart telemetry refresh preserves connected chart tree and selected history period',()=>{
  const card=new NavigationCard(fixture({}, {}, {config_entry:'scroll-test'}));card._view='charts';
  const catalog={dataset:{chartCatalogKey:availableCharts(card).map(([kind])=>kind).join(',')}};
  const selected={period:'month',date:'2026-09-01'},chart={dataset:{chart:'solar'},data:selected};
  card.shadowRoot={querySelector:selector=>selector==='.chart-catalog'?catalog:null,querySelectorAll:selector=>selector==='sigen-history-chart'?[chart]:[],addEventListener:()=>{}};
  card._chartPageConfig=card._config;
  let updates=0;card._upgradeCharts=()=>{updates++;};
  // A root redraw would bind navigation; the fast path must leave it untouched.
  card._render();card._render();
  assert.equal(updates,2);assert.equal(card._navigationBound,undefined);
  assert.equal(card._chartInstances.get('solar:'),chart);assert.equal(card._chartViews.get('solar:'),selected);
});

test('chart categories keep each device power and electrical charts together',()=>{
  const card=new NavigationCard(fixture({pv_voltage:state(400,'V'),pv1_voltage:state(400,'V'),dc_voltage:state(400,'V'),dc_current:state(10,'A')},{},{config_entry:'categories'}));
  const html=card._chartsPage();
  assert.match(html,/Solar & inverter/);assert.doesNotMatch(html,/data-chart-panel="load"/);assert.match(html,/>Battery<\/h2>/);assert.match(html,/>Grid<\/h2>/);
  const dc=html.slice(html.indexOf('<h2>Chargers</h2>'));
  for(const kind of ['ac','dc'])assert.ok(dc.includes(`data-chart-panel="${kind}"`));
  assert.doesNotMatch(dc,/data-chart-panel="(?:solar|pv_voltage|grid|dc_soc|dc_metrics)"/);
});

test('overview mode selection reviews a locked draft and immediately restores the observed dropdown', () => {
  const card=new NavigationCard(fixture({cloud_mode:state('Sigen AI Mode')})),opened=[];
  const selection={value:'',focused:0,focus(){this.focused++;}};
  card._detailDialog={querySelector:selector=>selector==='[data-settings-form="mode"] select[name="mode"]'?selection:null};
  card._openDetail=route=>opened.push(route);
  card._hass.callService=()=>assert.fail('Mode selection cannot send a plant command');
  card._hass.callWS=()=>assert.fail('Mode selection cannot call a provider');
  const dropdown={value:'tou'};card._chooseOverviewMode(dropdown);
  assert.equal(dropdown.value,'sigen_ai');assert.deepEqual(opened,['mode']);
  assert.equal(selection.value,'tou');assert.equal(selection.focused,1);assert.equal(card._detailDirty,true);
  assert.match(card._overviewModeControl(),/value="sigen_ai" selected/);
  const detail=card._detailModel('mode');
  assert.doesNotMatch(detail.body,/Plant controls are locked/);
  assert.match(detail.body,/<button[^>]+disabled[^>]*>Apply to Sigenergy/);
  assert.doesNotMatch(card._battery(),/Current Battery Level/);
  assert.match(card._battery(),/data-detail="energy_profile"/);assert.match(card._battery(),/data-detail="strategies"/);
});

test('overview mode respects an existing unsaved dialog and cancellation never changes the plant mode', () => {
  const card=new NavigationCard(fixture({native_mode:state('self_consumption')})),opened=[];
  const selection={value:'',focus(){}};let prompts=0,closed=0;
  card._detailDialog={querySelector:selector=>selector==='[data-settings-form="mode"] select[name="mode"]'?selection:null,close(){closed++;},remove(){}};
  card._openDetail=route=>opened.push(route);card._confirmDiscard=()=>prompts++;
  card._detailDirty=true;const dropdown={value:'tou'};card._chooseOverviewMode(dropdown);
  assert.equal(dropdown.value,'self_consumption');assert.equal(prompts,1);assert.deepEqual(opened,[]);
  card._detailDirty=false;card._runPendingDetail();assert.deepEqual(opened,['mode']);assert.equal(selection.value,'tou');
  card._closeDetail();assert.equal(prompts,2);assert.equal(closed,0);
  card._detailDirty=false;card._runPendingDetail();assert.equal(closed,1);assert.equal(card._detailDialog,null);
  assert.equal(card._state('native_mode').state,'self_consumption');
  assert.match(card._overviewModeControl(),/value="self_consumption" selected/);
});

test('overview mode ignores repeated and unknown choices and never invents an observed mode', () => {
  const card=new NavigationCard(fixture({cloud_mode:state('Sigen AI Mode')}));let opened=0;
  card._openDetail=()=>opened++;
  for(const value of ['sigen_ai','invalid','']){const dropdown={value};card._chooseOverviewMode(dropdown);assert.equal(dropdown.value,'sigen_ai');}
  assert.equal(opened,0);
  const missing=new NavigationCard();missing._openDetail=()=>opened++;
  const dropdown={value:'invalid'};missing._chooseOverviewMode(dropdown);assert.equal(dropdown.value,'');assert.equal(opened,0);
});

test('central Charts exposes available histories regardless of the old three saved favorites',()=>{
  const card=new NavigationCard(fixture({solar_power:state(1,'kW'),battery_soc:state(50,'%'),battery_temperature:state(19,'°C'),grid_l1_reactive_power:state(-250,'var'),pv1_current:state(4,'A')},{},{charts:['power','tariff','statistics'],config_entry:'catalog-only'}));
  card._view='overview';card._tab='charts';
  const content=card._content(),kinds=availableCharts(card).map(([key])=>key);
  for(const key of ['power','solar','battery','grid','soc','price','ac','dc','battery_temperature','grid_reactive','pv_metrics'])assert.ok(kinds.includes(key),key);
  for(const key of kinds)assert.match(content,new RegExp(`data-chart="${key}"`));
  assert.ok(!kinds.includes('inverter_temperature'));
  for(const key of ['production','consumption','energy_produced'])assert.match(card._detailModel('energy_totals').body,new RegExp(`widget-${key}`));
  assert.doesNotMatch(card._detailModel('battery').body,/<sigen-history-chart/);
});

test('Default consolidates electrical charts while customization restores individual options',()=>{
  const states={home_power:state(2,'kW'),dc_power:state(3,'kW'),dc_voltage:state(400,'V'),dc_current:state(7.5,'A'),pv1_voltage:state(450,'V'),pv1_current:state(4,'A')};
  const card=new NavigationCard(fixture(states,{}, {config_entry:'combined'}));
  const kinds=availableCharts(card).map(([key])=>key);
  assert.ok(kinds.includes('dc'));assert.ok(kinds.includes('pv_metrics'));
  for(const key of ['load','dc_metrics','dc_soc','dc_voltage','dc_current','pv_voltage','pv_current','forecast','strings'])assert.ok(!kinds.includes(key));
  card._config.chart_selection=['load','dc_voltage','pv_current'];
  assert.deepEqual(availableCharts(card).map(([key])=>key),['load','pv_current','dc_voltage']);
  const dc=historySeries(card,'dc_metrics');assert.deepEqual(dc.map(s=>s.unit),['kW','V','A']);
  const pv=historySeries(card,'pv_metrics');assert.deepEqual(pv.map(s=>s.unit),['V','A']);
  assert.match(card._chartsPage(),/data-detail="chart_settings"/);
});

test('engineering history retains its actual units and signed readings without treating them as kW',()=>{
  const card=fixture({battery_temperature:state(19,'°C'),battery_soh:state(99,'%'),grid_l1_reactive_power:state(-2,'kVar'),pv1_voltage:state(450000,'mV'),pv1_current:state(4100,'mA')},{'sensor.battery_temperature':[{start:NOW,mean:0}],'sensor.battery_soh':[{start:NOW,mean:98}],'sensor.grid_l1_reactive_power':[{start:NOW,mean:-2}],'sensor.pv1_voltage':[{start:NOW,mean:450000}],'sensor.pv1_current':[{start:NOW,mean:4100}]});
  for(const [kind,value,unit] of [['battery_temperature',0,'°C'],['battery_soh',98,'%'],['grid_reactive',-2,'kVar'],['pv_voltage',450,'V'],['pv_current',4.1,'A']]){const line=historySeries(card,kind)[0];assert.equal(line.unit,unit);assert.equal(line.points[0].value,value);}
});

test('Cloud history merges known local five-minute readings without duplicates or changing signs',()=>{
  const cloud=[{key:'battery_power',label:'Battery',unit:'kW',points:[{time:NOW-600000,value:2},{time:NOW-300000,value:1},{time:NOW,value:3}]}],local=[{key:'battery_power',label:'Battery',unit:'kW',points:[{time:NOW-300000+1000,value:-4},{time:NOW,value:null}]}];
  const original=structuredClone(cloud),merged=mergeHistorySeries(local,cloud);
  assert.equal(merged.length,1);assert.deepEqual(merged[0].points.map(point=>point.value),[2,-4,3]);assert.deepEqual(cloud,original);
  assert.equal(mergeHistorySeries([{...local[0],unit:'kWh'}],cloud).length,2);
});

test('measured tariff currencies replace empty native legend placeholders without merging real mismatched units',()=>{
  const cloud=[{key:'buy_price',label:'Buying price',unit:'EUR/kWh',points:[{time:NOW,value:0}]},{key:'sell_price',label:'Selling price',unit:'EUR/kWh',points:[{time:NOW,value:.19}]},{key:'battery_soc',unit:'%',points:[{time:NOW,value:75}]}];
  const placeholders=[{key:'buy_price',label:'Buying price',unit:'Currency/kWh',points:[]},{key:'sell_price',label:'Selling price',unit:'Currency/kWh',points:[{time:NOW,value:null}]}];
  const before=structuredClone({cloud,placeholders}),merged=mergeHistorySeries(placeholders,cloud);
  assert.deepEqual(merged.map(line=>[line.key,line.unit]),[['buy_price','EUR/kWh'],['sell_price','EUR/kWh'],['battery_soc','%']]);
  assert.equal(merged[0].points[0].value,0);assert.deepEqual({cloud,placeholders},before);
  const realDollar={key:'buy_price',unit:'USD/kWh',points:[{time:NOW,value:.11}]};
  assert.deepEqual(mergeHistorySeries([realDollar],cloud).filter(line=>line.key==='buy_price').map(line=>line.unit),['EUR/kWh','USD/kWh']);
  assert.equal(mergeHistorySeries(placeholders,[]).length,2);
  assert.deepEqual(mergeHistorySeries([realDollar],[{...realDollar,unit:'EUR/kWh',points:[]}]).map(line=>line.unit),['USD/kWh']);
});

test('authenticated plant Cloud history fills periods before Test Recorder commissioning',async()=>{
  const cloudPoint={time:NOW-3600000,value:3},localPoint={start:NOW-1000,mean:4},card=new NavigationCard(fixture({solar_power:state(1,'kW')},{},{config_entry:'history-source-a',history_start:new Date(NOW-300000).toISOString()})),requests=[];
  card._hass.callWS=async request=>{requests.push(request);return request.type==='sigen_hybrid/history'?{series:[{key:'solar_power',unit:'kW',points:[cloudPoint]}],source:'sigenergy_cloud',chartType:'line'}:{'sensor.solar_power':[localPoint]};};
  const result=await card._chartData('solar').load({start:NOW-7200000,end:NOW+3600000,period:'day',date:'2026-10-27'});
  const cloud= requests.find(request=>request.type==='sigen_hybrid/history'),recorder=requests.find(request=>request.type==='recorder/statistics_during_period');
  assert.equal(cloud.start_time,new Date(NOW-7200000).toISOString());assert.equal(recorder.start_time,card._config.history_start);
  assert.equal(result.series.length,1);assert.deepEqual(result.series[0].points.map(point=>point.value),[3,4]);
});

test('Cloud month charts preserve kWh bars and cannot merge instantaneous Recorder kW',async()=>{
  const card=new NavigationCard(fixture({solar_power:state(1,'kW')},{},{config_entry:'history-source-month'}));
  card._hass.callWS=async request=>request.type==='sigen_hybrid/history'?{series:[{key:'solar_energy',unit:'kWh',points:[{time:NOW-3600000,value:22}]}],source:'sigenergy_cloud',chartType:'bar'}:{'sensor.solar_power':[{start:NOW-1000,mean:4}]};
  const result=await card._chartData('solar').load({start:NOW-86400000,end:NOW+86400000,period:'month',date:'2026-10-27'});
  assert.equal(result.chartType,'bar');assert.deepEqual(result.series.map(line=>line.unit),['kWh']);assert.equal(result.series[0].points[0].value,22);
});

test('Lifetime requests trusted annual Cloud energy and retains its axis before native commissioning',async()=>{
  const first=Date.parse('2026-01-01T00:00:00Z'),end=Date.parse('2027-01-01T00:00:00Z'),card=new NavigationCard(fixture({solar_power:state(1,'kW')},{},{config_entry:'history-source-lifetime',history_start:new Date(NOW-300000).toISOString()})),requests=[];
  card._hass.callWS=async request=>{requests.push(request);return request.type==='sigen_hybrid/history'?{series:[{key:'solar_energy',unit:'kWh',points:[{time:first,value:129.25}]}],start:first,end,source:'sigenergy_cloud',chartType:'bar'}:{'sensor.solar_power':[{start:NOW-1000,mean:4}]};};
  const result=await card._chartData('solar').load({start:NOW-300000,end:NOW,period:'lifetime',date:'2026-10-27'});
  assert.equal(requests.filter(request=>request.type==='sigen_hybrid/history').length,1);assert.equal(result.chartType,'bar');assert.equal(result.start,first);assert.equal(result.end,end);assert.equal(result.series[0].points[0].value,129.25);assert.ok(result.series.every(line=>line.unit==='kWh'));
});

test('per-device history never requests plant Cloud fallback even when an account is connected',async()=>{
  const card=new NavigationCard(fixture({solar_power:state(1,'kW'),'sensor.own_inverter':state(2,'kW')},{},{config_entry:'history-source-device',devices:[{id:'inverter-only',type:'inverter',entities:{solar_power:'sensor.own_inverter'}}]})),requests=[];
  card._auto={...card._entities};Object.defineProperty(card,'_entities',{get(){return {...this._auto,...this._config.entities};}});card._state=function(key){return this._hass.states[this._entities[key]??key];};
  card._hass.callWS=async request=>{requests.push(request);return {};};
  await card._chartData('solar','inverter-only').load({start:NOW-3600000,end:NOW,period:'day'});
  assert.equal(requests.length,1);assert.equal(requests[0].type,'recorder/statistics_during_period');assert.deepEqual(requests[0].statistic_ids,['sensor.own_inverter']);
});

test('a recording start excludes older preview buckets while preserving real measurements',()=>{
  const card=fixture({ac_power:state(0,'kW')},{'sensor.ac_power':[{start:NOW-600000,mean:99},{start:NOW,mean:0}]},{history_start:new Date(NOW-300000).toISOString()});
  assert.deepEqual(historySeries(card,'ac')[0].points,[{time:NOW,value:0}]);
});

test('all Energy Profile pages resolve through navigation and local search', () => {
  const card = new NavigationCard();
  for (const route of ENERGY_ROUTES) {
    const model = card._detailModel(route);
    assert.notEqual(model.title, 'Measurement details', route);
    assert.ok(model.body.includes('energy-profile-page'), route);
    assert.ok(searchCatalogue(card._detailContext()).some(item => item.route === route), route);
    assert.ok(!/<(?:input|select|button)[^>]*(?:data-save-settings|data-service)/.test(model.body), route);
  }
  assert.match(card._header(), /data-detail="search"/);
  assert.doesNotMatch(card._header(), /data-detail="energy_profile"/);
  assert.match(card._battery(), /data-detail="energy_profile"/);
  assert.match(card._detailModel('settings').body, /data-detail="energy_profile"/);
});

test('cancelling manual control restores the complete nested navigation history', () => {
  const card = new NavigationCard(), previous = [{route:'settings'},{route:'energy_profile'},{route:'manual_control'}];
  let onClose;
  card._detailDialog = {};
  card._detailStack = structuredClone(previous);
  card.shadowRoot.querySelector = () => ({addEventListener:(event,callback)=>{if(event==='close')onClose=callback;}});
  card._closeDetail = () => {card._detailDialog=null;card._detailStack=[];};
  card._openDetail = (route,id) => {card._detailStack=[{route,id}];};
  card._openPreview('discharge');
  assert.equal(card.manualMode,'discharge');
  onClose();
  assert.deepEqual(card._detailStack,previous);
});

test('current entity mappings resolve to device, forecast, mode and settings detail routes', () => {
  const routes = {
    solar_power: 'solar', solar_today: 'solar', pv_kw: 'solar', home_power: 'load', home_today: 'load', load_power: 'load',
    battery_soc: 'battery', battery_power: 'battery', battery_capacity: 'battery', battery_charge_today: 'battery', battery_discharge_today: 'battery',
    grid_power: 'grid', grid_status: 'grid', grid_import_today: 'grid', grid_export_today: 'grid',
    ac_power: 'ac', ac_state: 'ac', ac_today: 'ac', dc_power: 'dc', dc_today: 'dc',
    forecast_today: 'forecast', forecast_tomorrow: 'forecast', forecast_status: 'forecast', cloud_mode: 'mode', native_mode: 'mode',
    buy_price: 'tariffs', sell_price: 'tariffs', tariff_plan: 'tariffs', export_permitted: 'safety', cloud_status: 'sensor', control_status: 'sensor',
  };
  for (const [key, route] of Object.entries(routes)) assert.equal(routeForEntity(key), route, key);
  for (const key of ['', null, undefined, '<img src=x onerror=bad>']) assert.equal(routeForEntity(key), 'sensor');
});

test('history preserves units, direction and real zero across power and SOC charts', () => {
  const card = fixture({ solar_power: state(1, 'MW'), battery_power: state(1, 'W'), grid_power: state(1, 'kW'), home_power: state(1, 'W'), battery_soc: state(60, '%') });
  const t = NOW - 3600000;
  const rows = {
    'sensor.solar_power': [{ start: t, mean: .004 }],
    'sensor.battery_power': [{ start: t, mean: 2000 }, { start: t + 1000, mean: -1500 }, { start: t + 2000, mean: 0 }],
    'sensor.grid_power': [{ start: t, mean: -2 }, { start: t + 1000, mean: 0 }],
    'sensor.home_power': [{ start: t, mean: 1200 }],
    'sensor.battery_soc': [{ start: t, mean: 60 }, { start: t + 1000, mean: 0 }],
  };
  const before = structuredClone(rows), power = historySeries(card, 'power', rows);
  assert.equal(power.find(series => series.key === 'solar_power').points[0].value, 4);
  const battery = power.find(series => series.key === 'battery_power');
  assert.deepEqual(battery.points.slice(0, 2).map(point => point.value), [-2, 1.5]);
  assert.ok(Object.is(battery.points[2].value, -0));
  assert.deepEqual(power.find(series => series.key === 'grid_power').points.map(point => point.value), [-2, 0]);
  assert.equal(power.find(series => series.key === 'home_power').points[0].value, -1.2);
  assert.ok(power.every(series => series.unit === 'kW'));
  const soc = historySeries(card, 'soc', rows)[0];
  assert.equal(soc.unit, '%'); assert.deepEqual(soc.points.map(point => point.value), [60, 0]);
  assert.deepEqual(rows, before);
});

test('price history retains negative prices and normalizes minor units with the supplied currency', () => {
  const card = fixture({ buy_price: state(9, 'cent/kWh', { currency: 'EUR' }), sell_price: state(-.05, 'EUR/kWh', { currency: 'EUR' }) }, {
    'sensor.buy_price': [{ start: NOW - 1000, mean: 9 }, { start: NOW, mean: 0 }],
    'sensor.sell_price': [{ start: NOW - 1000, mean: -.05 }],
  });
  const series = historySeries(card, 'price');
  assert.equal(series[0].unit, 'EUR/kWh'); assert.deepEqual(series[0].points.map(point => point.value), [.09, 0]);
  assert.equal(series[1].points[0].value, -.05);
});

test('major-unit prices retain their actual currency when a separate currency attribute is absent', () => {
  const card = fixture({ buy_price: state(1, 'GBP/kWh') }, { 'sensor.buy_price': [{ start: NOW, mean: .25 }] });
  const series = historySeries(card, 'price')[0];
  assert.equal(series.unit, 'GBP/kWh'); assert.equal(series.points[0].value, .25);
});

test('unknown units do not become plausible kW, SOC or tariff samples', () => {
  const card = fixture({ solar_power: state(230, 'V'), battery_soc: state(75, 'kWh'), buy_price: state(9, 'unverified') }, {
    'sensor.solar_power': [{ start: NOW, mean: 230 }], 'sensor.battery_soc': [{ start: NOW, mean: 75 }], 'sensor.buy_price': [{ start: NOW, mean: 9 }],
  });
  assert.deepEqual(historySeries(card, 'solar')[0].points, []);
  assert.deepEqual(historySeries(card, 'soc')[0].points, []);
  assert.deepEqual(historySeries(card, 'price')[0].points, []);
});

test('blank, boolean, missing and cumulative-only samples are not fabricated as instantaneous readings', () => {
  const samples = ['', ' ', true, false, null, undefined, 'unavailable', NaN, Infinity];
  const card = fixture({ solar_power: state(1, 'kW') }, { 'sensor.solar_power': [
    ...samples.map((mean, index) => ({ start: NOW - index * 1000, mean })),
    { start: NOW - 20000, sum: 1234 }, { start: 'invalid', mean: 3 }, { start: NOW - 30000, mean: '2.5' }, { start: NOW, mean: 0 },
  ] });
  const points=historySeries(card, 'solar')[0].points;
  assert.deepEqual(points.filter(point=>point.value!==null).map(point => point.value), [2.5, 0]);
  assert.equal(points.filter(point=>point.value===null).length,10);
});

test('time-valid unavailable readings remain gaps in history and forecast overlays',()=>{
  const start=NOW-120000;
  const card=fixture({grid_power:state(1,'kW'),forecast_today:state(8,'kWh',{series:[{start:new Date(start).toISOString(),power_kw:1},{start:new Date(start+60000).toISOString(),power_kw:null},{start:new Date(start+120000).toISOString(),power_kw:3}]})},{'sensor.grid_power':[{start,mean:1},{start:start+60000,mean:null},{start:start+120000,mean:3}]});
  for(const kind of ['grid','forecast']){
    const points=historySeries(card,kind)[0].points;
    assert.deepEqual(points.map(point=>point.value),[1,null,3]);
    assert.equal(gapPaths(points).length,2);
  }
});

test('history timestamp normalization accepts valid seconds, milliseconds and ISO state history', () => {
  const card = fixture({ grid_power: state(1, 'kW') }, { 'sensor.grid_power': [
    { start: NOW / 1000, mean: 1 }, { start: NOW + 1000, mean: 2 }, { last_changed: new Date(NOW + 2000).toISOString(), state: '-3' },
  ] });
  assert.deepEqual(historySeries(card, 'grid')[0].points, [{ time: NOW, value: 1 }, { time: NOW + 1000, value: 2 }, { time: NOW + 2000, value: -3 }]);
});

test('optimizer history resolves configured module identifiers and validates power units', () => {
  const config = { optimizers: [{ id: 'module-one', power: 'sensor.panel_one' }] };
  const card = fixture({ 'sensor.panel_one': state(362, 'W') }, { 'sensor.panel_one': [{ start: NOW, mean: 362 }, { start: NOW + 1000, mean: 0 }] }, config);
  card._detailId = 'module-one';
  assert.deepEqual(historySeries(card, 'optimizer')[0].points.map(point => point.value), [.362, 0]);
  card._detailId = 'sensor.panel_one';
  assert.deepEqual(historySeries(card, 'optimizer')[0].points.map(point => point.value), [.362, 0]);
  card._hass.states['sensor.panel_one'] = state(1, 'MW');
  card._history['sensor.panel_one'] = [{ start: NOW, mean: .000362 }];
  assert.ok(Math.abs(historySeries(card, 'optimizer')[0].points[0].value - .362) < 1e-12);
  card._hass.states['sensor.panel_one'] = state(230, 'V');
  assert.deepEqual(historySeries(card, 'optimizer')[0].points, []);
});

test('forecast history preserves real zero, rejects failed sources and never invents missing intervals', () => {
  const series = [{ start: new Date(NOW).toISOString(), end: new Date(NOW + 3600000).toISOString(), power_kw: 0 }, { start: new Date(NOW + 3 * 3600000).toISOString(), end: new Date(NOW + 4 * 3600000).toISOString(), power_kw: 2.5 }];
  const card = fixture({ forecast_today: state(8, 'kWh', { available: true, series }) });
  assert.deepEqual(historySeries(card, 'forecast')[0].points, [{ time: NOW, value: 0 }, { time: NOW + 3 * 3600000, value: 2.5 }]);
  card._hass.states['sensor.forecast_today'].attributes.available = false;
  assert.deepEqual(historySeries(card, 'forecast').flatMap(item => item.points), []);
  card._hass.states['sensor.forecast_today'].attributes.available = true;
  card._hass.states['sensor.forecast_today'].state = 'unavailable';
  assert.deepEqual(historySeries(card, 'forecast').flatMap(item => item.points), []);
});

test('unsupported and prototype property chart names use a safe default', () => {
  const card = fixture({ solar_power: state(1, 'kW') }, { 'sensor.solar_power': [{ start: NOW, mean: 1 }] });
  for (const name of ['not-a-chart', 'constructor', '__proto__', 'toString', null, undefined]) {
    assert.doesNotThrow(() => historySeries(card, name), String(name));
    assert.equal(historySeries(card, name)[0].key, 'solar_power', String(name));
  }
});

test('navigation wrappers keep existing markup and expose meaningful device and chart entry points', () => {
  const card = new NavigationCard(fixture({ solar_power: state(1, 'kW') }));
  for (const route of ['search', 'plant']) assert.ok(card._header().includes(`data-detail="${route}"`));
  assert.ok(card._battery().includes('class="battery-summary" data-detail="battery"'));
  assert.ok(card._flow().includes('data-detail="solar" role="button"'));
  assert.ok(card._house().includes('data-detail="weather"'));
  assert.ok(card._power().includes('data-upgrade-chart="power"'));
  assert.ok(card._singlePower('grid_chart').includes('data-upgrade-chart="grid"'));
  assert.ok(card._priceChart().includes('data-upgrade-chart="price"'));
});

test('house equipment clicks use only the cropped hit rectangles while atlas images stay inert',()=>{
  const card=new NavigationCard(fixture({solar_power:state(1,'kW')})),html=card._house();
  for(const route of ['battery','gateway','ac','dc']){
    const match=html.match(new RegExp(`(<svg[^>]*class="portal-equipment"[^>]*data-equipment="${route}"[^>]*>)([\\s\\S]*?)(<\\/svg>)`));
    assert.ok(match,route);
    assert.doesNotMatch(match[1],/data-detail|role=|tabindex|aria-label/);
    assert.match(match[2],/<image[^>]*pointer-events="none"\/>/);
    assert.match(match[2],new RegExp(`<rect x="50" y="489" width="42" height="84"[^>]*class="portal-equipment-hit" data-detail="${route}" role="button" tabindex="0"`));
    let opened;card._openDetail=value=>{opened=value;};
    card._navigationClick(clickEvent({dataset:{detail:route},matches:()=>true,hasAttribute:()=>false}));
    assert.equal(opened,route);
  }
  assert.match(html,/<g data-entity="sensor.ac_power"><text>AC charger<\/text><\/g>/);
  assert.match(html,/data-detail="weather"/);
  assert.match(html,/aria-label="PV panels"/);
});

test('entity clicks route to matching details and configured optimizer identities without issuing requests', () => {
  const card = new NavigationCard(fixture({ solar_power: state(1, 'kW'), forecast_today: state(8, 'kWh'), battery_soc: state(70, '%'), 'sensor.panel_one': state(362, 'W') }, {}, { optimizers: [{ id: 'module-one', power: 'sensor.panel_one' }] }));
  const opened = [], requests = []; card._openDetail = (route, id) => opened.push({ route, id }); card._hass.callWS = request => requests.push(request);
  for (const [id, expected] of [['sensor.solar_power', 'solar'], ['sensor.forecast_today', 'forecast'], ['sensor.battery_soc', 'battery'], ['sensor.panel_one', 'optimizer']]) {
    const target = { dataset: { entity: id }, matches: () => true, hasAttribute: () => false };
    card._navigationClick({ composedPath: () => [target], preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
    assert.equal(opened.at(-1).route, expected);
    if (expected !== 'optimizer') assert.equal(opened.at(-1).id, undefined);
  }
  assert.equal(opened.at(-1).id, 'module-one');
  assert.deepEqual(requests, []);
});

test('optimizer tiles without an explicit module ID open the matching individual panel page',()=>{
  const card=new NavigationCard(fixture({'sensor.unidentified_panel':state(362,'W',{observed_at:new Date(NOW).toISOString()})},{},{optimizers:[{name:'Mapped panel',power:'sensor.unidentified_panel'}]}));
  let opened;card._openDetail=(route,id)=>{opened={route,id,model:card._detailModel(route,id)};};
  card._navigationClick(clickEvent({dataset:{entity:'sensor.unidentified_panel'},matches:()=>true,hasAttribute:()=>false}));
  assert.equal(opened.route,'optimizer');assert.equal(opened.id,'sensor.unidentified_panel');
  assert.equal(opened.model.title,'Mapped panel');assert.ok(opened.model.body.includes('362 W'));
  assert.ok(!opened.model.body.includes('<sigen-history-chart'));
});

test('native more-info allows only sensor, binary sensor and weather IDs and respects dirty forms',t=>{
  const previous=globalThis.CustomEvent;
  globalThis.CustomEvent=class{constructor(type,options){this.type=type;Object.assign(this,options);}};
  t.after(()=>{if(previous===undefined)delete globalThis.CustomEvent;else globalThis.CustomEvent=previous;});
  const card=new NavigationCard();card._detailDialog={};const events=[],opened=[];let closed=0;
  card._closeDetail=()=>closed++;card.dispatchEvent=event=>events.push(event);card._openDetail=(...route)=>opened.push(route);card._confirmDiscard=()=>{};
  const target=id=>({dataset:{entity:id},matches:()=>true,hasAttribute:()=>false});
  for(const id of ['sensor.solar_power','binary_sensor.export_permitted','weather.forecast_home'])card._navigationClick(clickEvent(target(id)));
  assert.deepEqual(events.map(event=>event.detail.entityId),['sensor.solar_power','binary_sensor.export_permitted','weather.forecast_home']);
  assert.ok(events.every(event=>event.type==='hass-more-info'&&event.bubbles&&event.composed));
  assert.equal(closed,3);
  card._navigationClick(clickEvent(target('switch.unrelated')));
  assert.equal(events.length,3);assert.equal(opened.length,1);
  card._detailDirty=true;card._navigationClick(clickEvent(target('weather.forecast_home')));
  assert.equal(events.length,3);assert.equal(closed,3);
  card._navigationClick(clickEvent(actionTarget('data-discard-detail')));
  assert.equal(events.length,4);assert.equal(closed,4);
});

test('live chart refresh updates readings without losing hidden legends, selected range or expanded dialog',()=>{
  const pane=()=>({innerHTML:'',querySelector:()=>null}),main=pane(),modal=pane(),dialog={open:true,querySelector:()=>modal};
  const chart=new SigenHistoryChart();chart.shadowRoot={querySelector:selector=>selector==='.main'?main:selector==='dialog'?dialog:null};chart._bind=()=>{};
  const original={title:'Power',period:'day',date:'2026-10-27',timezone:'Europe/Dublin',start:NOW-3600000,end:NOW+3600000,now:NOW,series:[{key:'solar',label:'Solar',unit:'kW',points:[{time:NOW,value:1}]},{key:'battery',label:'Battery',unit:'kW',points:[{time:NOW,value:2}]}]};
  chart.data=original;chart._visible.delete('battery');
  const fresh={...original,now:NOW+60000,series:[{...original.series[0],points:[{time:NOW,value:3}]},original.series[1]],load:async()=>[]};
  chart.data=refreshedChartData(chart.data,fresh,'power');
  assert.equal(chart.data.date,original.date);assert.equal(chart.data.start,original.start);assert.equal(chart.data.end,original.end);
  assert.equal(chart.data.series[0].points[0].value,3);assert.equal(chart._visible.has('battery'),false);
  assert.equal(dialog.open,true);assert.equal(chart.shadowRoot.querySelector('dialog'),dialog);
  assert.match(modal.innerHTML,/Close expanded chart/);assert.match(modal.innerHTML,/data-series="1" aria-pressed="false"/);
  const historical={...chart.data,date:'2026-10-26',period:'month',series:[original.series[0]]};
  const refreshed=refreshedChartData(historical,fresh,'power');
  assert.equal(refreshed.period,'month');assert.equal(refreshed.date,'2026-10-26');assert.equal(refreshed.series,historical.series);
  assert.equal(refreshed.load,fresh.load);
});

test('popup weather heroes refresh through textContent and dirty or editable forms remain untouched',t=>{
  const previousDocument=globalThis.document;
  const old=Object.fromEntries(['symbol','condition','temperature'].map(field=>[field,{textContent:'old'}]));
  const next={symbol:{textContent:'☀'},condition:{textContent:'Sunny'},temperature:{textContent:'13 °C'}};
  const field=selector=>/data-weather-field="([^"]+)"/.exec(selector)?.[1];
  let templates=0,form=false,chartUpdates=0;
  globalThis.document={createElement(){templates++;return {innerHTML:'',content:{querySelector:selector=>next[field(selector)],querySelectorAll:()=>[]}};}};
  t.after(()=>{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
  const card=new NavigationCard();card._detailStack=[{route:'weather'}];card._detailModel=()=>({body:'weather'});
  const chart={dataset:{chart:'power'},get data(){return null;},set data(value){chartUpdates++;}};
  card._chartData=()=>({series:[]});
  card._detailDialog={querySelector:selector=>selector==='form'?form:selector==='.detail-unsaved'?null:old[field(selector)],querySelectorAll:selector=>selector==='sigen-history-chart'?[chart]:[]};
  card._refreshDetailReadings();
  assert.deepEqual(Object.values(old).map(reading=>reading.textContent),['☀','Sunny','13 °C']);assert.equal(chartUpdates,1);
  chart._loading=true;card._refreshDetailReadings();assert.equal(templates,2);assert.equal(chartUpdates,1);
  card._detailDirty=true;card._refreshDetailReadings();assert.equal(templates,2);
  card._detailDirty=false;form=true;card._refreshDetailReadings();assert.equal(templates,2);assert.equal(chartUpdates,1);
});

test('detail rendering remains local, escaped and read-only with no control permission', () => {
  const card = new NavigationCard(fixture({ solar_power: state(1, 'kW'), 'sensor.malicious': state('<img src=x onerror="bad">', '<svg onload="bad">') }, {}, { title: '<script>bad</script>', devices: [] }));
  let requests = 0; card._hass.callWS = () => { requests++; throw new Error('A detail render must not request data'); };
  assert.equal(card._detailContext().controlPermission, false);
  for (const route of ['solar', 'load', 'battery', 'grid', 'ac', 'dc', 'forecast', 'devices', 'settings', 'mode', 'strategies', 'energy', 'statistics']) assert.equal(typeof card._detailModel(route).body, 'string', route);
  const body = card._detailModel('sensor', 'sensor.malicious').body;
  assert.ok(body.includes('&lt;img') && body.includes('&lt;svg'));
  assert.ok(!body.includes('<img') && !body.includes('<svg'));
  assert.equal(requests, 0);
});

test('chart loading uses only scoped HA recorder reads and no cloud or device service calls', async () => {
  const card = new NavigationCard(fixture({ solar_power: state(1, 'kW') }));
  const requests = []; card._hass.callWS = async request => { requests.push(request); return { 'sensor.solar_power': [{ start: NOW - 1000, mean: 2 }] }; };
  const data = card._chartData('solar');
  const result = await data.load({ start: NOW - 3600000, end: NOW, period: 'day' });
  assert.equal(requests.length, 1); assert.equal(requests[0].type, 'recorder/statistics_during_period');
  assert.deepEqual(requests[0].statistic_ids, ['sensor.solar_power']); assert.deepEqual(requests[0].types, ['mean']);
  assert.equal(result[0].points[0].value, 2);
  card._config.recorded_history = {};
  await card._chartData('solar').load({ start: NOW - 3600000, end: NOW, period: 'day' });
  assert.equal(requests.length, 1);
  const source = await readFile(new URL('../custom_components/sigen_hybrid/frontend/sigen-hybrid-navigation.js', import.meta.url), 'utf8');
  const explicitOwnerAction=source.slice(source.indexOf('  Card.prototype._sendOwnerSetting='),source.indexOf('  Card.prototype._syncOwnerSetting='));
  assert.match(explicitOwnerAction,/service:'owner_setting'/);
  const navigationReads=source.replace(explicitOwnerAction,'');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|dry_run\s*:\s*false|type:\s*['"]call_service|service:\s*['"]/.test(navigationReads));
});

test('Recorder history publishes immediately while Cloud backfill remains pending',async()=>{
  const card=new NavigationCard(fixture({solar_power:state(1,'kW')},{},{config_entry:'progressive-history'})),updates=[];let finishCloud;
  card._hass.callWS=request=>request.type==='sigen_hybrid/history'?new Promise(resolve=>{finishCloud=resolve;}):Promise.resolve({'sensor.solar_power':[{start:NOW-1000,mean:4}]});
  const pending=card._chartData('solar').load({start:NOW-7200000,end:NOW,period:'day',date:'2026-10-27',onUpdate:value=>updates.push(value)});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(updates.length,1);assert.equal(updates[0].series[0].points[0].value,4);
  finishCloud({series:[{key:'solar_power',unit:'kW',points:[{time:NOW-3600000,value:3}]}]});
  const result=await pending;assert.deepEqual(result.series[0].points.map(point=>point.value),[3,4]);
});

test('explicit earlier history mapping survives source migration with current readings winning overlaps',async()=>{
  const card=new NavigationCard(fixture({solar_power:state(2,'kW'),'sensor.earlier_pv':state(1000,'W')},{},{history_entities:{solar_power:'sensor.earlier_pv'}})),requests=[];
  card._hass.callWS=async request=>{requests.push(request);return {'sensor.solar_power':[{start:NOW-1000,mean:2}],'sensor.earlier_pv':[{start:NOW-600000,mean:1000},{start:NOW-1000,mean:9000}]};};
  const result=await card._chartData('solar').load({start:NOW-3600000,end:NOW,period:'day'});
  assert.deepEqual(requests[0].statistic_ids,['sensor.solar_power','sensor.earlier_pv']);
  assert.deepEqual(result[0].points.map(point=>point.value),[1,2]);
});

test('shared chart selection updates every sibling without recursion or detail popup changes',()=>{
  const card=new NavigationCard(),calls=[],origin={_change:()=>{throw Error('origin must not reload twice');}},other={_change:(...args)=>calls.push(args)};
  card.shadowRoot={querySelectorAll:selector=>{assert.equal(selector,'.chart-catalog sigen-history-chart');return [origin,other];}};
  card._synchronizeChartRange('month','2026-10-01',origin);
  assert.deepEqual(card._chartsRange,{period:'month',date:'2026-10-01'});assert.deepEqual(calls,[['month','2026-10-01']]);
});

test('chart page exposes one shared selector and preserves its selected date across telemetry refreshes',()=>{
  const card=new NavigationCard(),charts=['power','solar','battery'].map(kind=>({dataset:{chart:kind},addEventListener(){}}));
  card.shadowRoot={querySelector:selector=>selector==='.chart-catalog'?{}:null,querySelectorAll:selector=>selector==='sigen-history-chart'?charts:[]};
  card._chartData=kind=>({title:kind,now:NOW,date:'2026-10-27',period:'day',timezone:'UTC',series:[]});
  card._chartViews=new Map([['power:',{date:'2026-10-26',period:'day'}]]);
  card._upgradeCharts();
  assert.deepEqual(charts.map(chart=>chart.data.hideControls),[true,true,true]);assert.ok(charts.every(chart=>chart.data.date==='2026-10-27'));
  card._chartsRange={period:'month',date:'2026-10-01'};card._upgradeCharts();
  assert.ok(charts.every(chart=>chart.data.period==='month'&&chart.data.date==='2026-10-01'));
  assert.equal(new Set(charts.map(chart=>chart.data.start)).size,1);assert.equal(new Set(charts.map(chart=>chart.data.end)).size,1);
});

test('a category jump completes before a live refresh preserves the tablet scroll position',()=>{
  const card=new NavigationCard(),container={scrollTop:35},fields={addEventListener(){}};
  card.parentElement=container;
  let click;
  const button={dataset:{chartJump:'1'},addEventListener:(name,handler)=>{if(name==='click')click=handler;}};
  const target={scrollIntoView:options=>{if(options.behavior!=='smooth')container.scrollTop=900;}};
  const toolbar={dataset:{},querySelector:()=>fields,querySelectorAll:()=>[]};
  card.shadowRoot={querySelector:selector=>selector==='.chart-toolbar-global'?toolbar:target,querySelectorAll:()=>[button]};
  card._updateChartToolbar();click();
  assert.equal(container.scrollTop,900);
  preserveChartScroll(card,()=>{container.scrollTop=0;});
  assert.equal(container.scrollTop,900);
});

test('calendar navigation can request older recorded periods beyond the currently loaded 24-hour window', async () => {
  const card = new NavigationCard(fixture({ solar_power: state(1, 'kW') }, { 'sensor.solar_power': [{ start: NOW - 3600000, mean: 1 }] }));
  const requests = []; card._hass.callWS = async request => { requests.push(request); return {}; };
  const start = NOW - 7 * 86400000, end = NOW - 6 * 86400000;
  await card._chartData('solar').load({ start, end, period: 'day' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].start_time, new Date(start).toISOString());
  assert.equal(requests[0].end_time, new Date(end).toISOString());
  assert.ok(Date.parse(requests[0].start_time) < Date.parse(requests[0].end_time));
});

test('forward forecast chart range includes supplied intervals and permits their future horizon', () => {
  const start = NOW + 3600000, end = NOW + 3 * 3600000;
  const card = new NavigationCard(fixture({ forecast_today: state(8, 'kWh', { available: true, series: [
    { start: new Date(start).toISOString(), end: new Date(start + 3600000).toISOString(), power_kw: 2 },
    { start: new Date(start + 3600000).toISOString(), end: new Date(end).toISOString(), power_kw: 3 },
  ] }) }));
  const data = card._chartData('forecast');
  assert.ok(data.start <= start); assert.ok(data.end >= end);
  assert.ok(data.maxFuture >= end);
  assert.equal(data.series[0].points.length, 2);
});

test('device chart history never substitutes aggregate battery power or SOC for missing module mappings', async () => {
  const base = fixture({ battery_power: state(3, 'kW'), battery_soc: state(72, '%'), 'sensor.module_one_soc': state(55, '%'), 'sensor.module_two_power': state(200, 'W') }, {
    'sensor.battery_power': [{ start: NOW - 1000, mean: 3 }], 'sensor.battery_soc': [{ start: NOW - 1000, mean: 72 }],
    'sensor.module_one_soc': [{ start: NOW - 1000, mean: 55 }], 'sensor.module_two_power': [{ start: NOW - 1000, mean: 200 }],
  }, { devices: [{ id: 'module-one', type: 'battery_module', entities: { battery_soc: 'sensor.module_one_soc' } }, { id: 'module-two', type: 'battery_module', entities: { battery_power: 'sensor.module_two_power' } }] });
  const card = new NavigationCard(base);
  card._auto = { ...base._entities };
  Object.defineProperty(card, '_entities', { configurable: true, get() { return { ...this._auto, ...this._config.entities }; } });
  card._state = function(key) { return this._hass.states[this._entities[key] ?? key]; };
  const requests = []; card._hass.callWS = async request => { requests.push(request); return { 'sensor.module_two_power': [{ start: NOW - 1000, mean: 200 }] }; };
  assert.deepEqual(card._chartData('battery', 'module-one').series, []);
  assert.deepEqual(await card._chartData('battery', 'module-one').load({ start: NOW - 3600000, end: NOW, period: 'day' }), []);
  assert.deepEqual(requests, []);
  assert.deepEqual(card._chartData('soc', 'module-one').series[0].points.map(point => point.value), [55]);
  assert.deepEqual(card._chartData('soc', 'module-two').series, []);
  const own = card._chartData('battery', 'module-two');
  assert.deepEqual(own.series[0].points.map(point => point.value), [-.2]);
  await own.load({ start: NOW - 3600000, end: NOW, period: 'day' });
  assert.deepEqual(requests[0].statistic_ids, ['sensor.module_two_power']);
  assert.deepEqual(card._chartData('battery').series[0].points.map(point => point.value), [-3]);
});

test('device charts resolve every supported serial identity alias and reject ambiguous matches',()=>{
  for(const alias of ['serial','serial_number','serialNumber']){
    const id=`sensor.${alias.toLowerCase()}_own`,base=fixture({battery_power:state(7,'kW'),[id]:state(-150,'W')},{[id]:[{start:NOW,mean:-150}]},{devices:[{[alias]:'device-identity',type:'battery_module',entities:{battery_power:id}}]});
    const card=new NavigationCard(base);card._auto={...base._entities};Object.defineProperty(card,'_entities',{get(){return {...this._auto,...this._config.entities};}});card._state=function(key){return this._hass.states[this._entities[key]??key];};
    assert.deepEqual(card._chartData('battery','device-identity').series[0].points.map(point=>point.value),[.15],alias);
    card._config.devices.push({id:'device-identity',type:'battery_module',entities:{battery_power:'sensor.battery_power'}});
    assert.deepEqual(card._chartData('battery','device-identity').series,[],`${alias}: ambiguous identity must not borrow readings`);
  }
});

test('device charts accept serial identities, preserve own readings and exclude plant forecasts or stale-ID aggregates',async()=>{
  const base=fixture({solar_power:state(9,'kW'),battery_power:state(3,'kW'),battery_soc:state(72,'%'),grid_power:state(4,'kW'),forecast_today:state(8,'kWh',{series:[{start:new Date(NOW).toISOString(),power_kw:6}]}),'sensor.inverter_pv':state(250,'W'),'sensor.pv1':state(.4,'kW')},{'sensor.solar_power':[{start:NOW,mean:9}],'sensor.battery_power':[{start:NOW,mean:3}],'sensor.battery_soc':[{start:NOW,mean:72}],'sensor.inverter_pv':[{start:NOW,mean:250}],'sensor.pv1':[{start:NOW,mean:.4}]},{devices:[{serial:'inverter-one',type:'inverter',entities:{solar_power:'sensor.inverter_pv'}},{id:'pv1',type:'string',entities:{solar_power:'sensor.pv1'}}]});
  const card=new NavigationCard(base);card._auto={...base._entities};
  Object.defineProperty(card,'_entities',{get(){return {...this._auto,...this._config.entities};}});
  card._state=function(key){return this._hass.states[this._entities[key]??key];};
  const requests=[];card._hass.callWS=async request=>{requests.push(request);return {'sensor.inverter_pv':[{start:NOW,mean:250}]};};
  assert.equal(card._chartData('solar').series.find(series=>series.forecast).points[0].value,6);
  for(const [id,expected] of [['inverter-one',.25],['pv1',.4]]){
    const own=card._chartData('solar',id);
    assert.equal(own.series.length,1);assert.equal(own.series[0].points[0].value,expected);
    assert.ok(!own.series.some(series=>series.forecast));
  }
  for(const kind of ['solar','power','battery','soc','grid','price','forecast']){
    const missing=card._chartData(kind,'removed-device');
    assert.deepEqual(missing.series,[],kind);
    assert.deepEqual(await missing.load({start:NOW-3600000,end:NOW,period:'day'}),[],kind);
  }
  assert.deepEqual(requests,[]);
  const own=card._chartData('solar','inverter-one');
  assert.equal((await own.load({start:NOW-3600000,end:NOW,period:'day'}))[0].points[0].value,.25);
  assert.deepEqual(requests[0].statistic_ids,['sensor.inverter_pv']);
});

function settingsHarness(route){
  const card=new NavigationCard(),output={hidden:true,textContent:''};
  const form={reportValidity:()=>true,...(route==='strategy'?{name:'First plan',weekdays:['mon'],start:'02:00',end:'05:00',condition:'none',action:'charge',priority:1}:route==='vehicle'?{brand:'First brand',model:'First car',year:2026,capacity_kwh:50}:{provider:'forecast_solar',entity_id:'sensor.forecast_today'})};
  const dialog={attributes:{},setAttribute(key,value){this.attributes[key]=value;},innerHTML:'',querySelectorAll:()=>[],querySelector(selector){return selector==='[data-settings-form]'?form:selector==='.detail-save-notice'?output:selector==='[data-detail-back]'?{focus(){}}:null;}};
  Object.assign(card,{_detailDialog:dialog,_detailStack:[],_upgradeCharts(){},_bindSankeyRoutes(){},_confirmDiscard(){this.confirmed=(this.confirmed??0)+1;}});
  card._config.config_entry='test-entry';card._sharedInterfaceOptions={};card._sharedTestStore={value:null};
  card._hass.callWS=async request=>{if(request.type==='frontend/get_system_data')return structuredClone(card._sharedTestStore);if(request.type==='frontend/set_system_data'){card._sharedTestStore.value=structuredClone(request.value);return;}assert.fail('Unexpected request '+request.type);};
  return {card,form,dialog,output};
}
function clickEvent(target){return {prevented:false,composedPath:()=>[target],preventDefault(){this.prevented=true;},stopPropagation(){},stopImmediatePropagation(){}};}
const actionTarget=attribute=>({dataset:{},matches:()=>true,hasAttribute:key=>key===attribute});

test('new strategy and vehicle drafts receive distinct stable identities and preserve sibling drafts',async t=>{
  const previous=globalThis.localStorage,storage=new Map();
  globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  t.after(()=>{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;});
  for(const route of ['strategy','vehicle']){
    const {card,form,dialog}=settingsHarness(route);
    card._openDetail(route,'new');
    const first=card._detailStack.at(-1).id;
    assert.match(first,/^draft-[a-z0-9-]+$/);assert.notEqual(first,'new');
    await card._saveDetail();
    const label=route==='strategy'?'name':'model';form[label]='Edited first';
    card._openDetail(route,first,true);await card._saveDetail();
    assert.equal(card._detailStack.at(-1).id,first);
    card._openDetail(route,'new');const second=card._detailStack.at(-1).id;
    assert.notEqual(second,first);
    assert.ok(!dialog.innerHTML.includes('Edited first'));
    form[label]='Second draft';await card._saveDetail();
    const saved=card._sharedTestStore.value.settings[route];
    assert.equal(storage.size,0);
    assert.equal(Object.keys(saved).length,2);
    assert.equal(saved[first][label],'Edited first');assert.equal(saved[first].id,first);
    assert.equal(saved[second][label],'Second draft');assert.equal(saved[second].id,second);
  }
});

test('dirty navigation retains a draft identity until the user chooses to leave',()=>{
  const {card}=settingsHarness('strategy');
  card._openDetail('strategy','new');const first=card._detailStack.at(-1).id;
  card._detailDirty=true;card._openDetail('strategy','new');
  assert.equal(card.confirmed,1);assert.equal(card._detailStack.at(-1).id,first);
  card._navigationClick(clickEvent(actionTarget('data-keep-editing')));
  assert.equal(card._detailPending,null);assert.equal(card._detailStack.at(-1).id,first);
  card._openDetail('strategy','new');
  card._navigationClick(clickEvent(actionTarget('data-discard-detail')));
  const second=card._detailStack.at(-1).id;
  assert.notEqual(second,first);
  card._openDetail('strategy',second,true);
  assert.equal(card._detailStack.at(-1).id,second);
});

test('new tariff seasons allocate independent stable IDs while retaining their import or export direction',()=>{
  const {card}=settingsHarness('strategy');
  card._detailModel=(route,id)=>({title:'Season',body:`<div>${id}</div>`});
  const ids=[];
  for(const direction of ['import','export','import']){
    card._openDetail('tariff_season',`${direction}:new`);
    const id=card._detailStack.at(-1).id;
    assert.match(id,new RegExp(`^${direction}:draft-[a-z0-9-]+$`));
    ids.push(id);card._openDetail('tariff_season',id,true);
    assert.equal(card._detailStack.at(-1).id,id);
  }
  assert.equal(new Set(ids).size,3);
});

test('integration links respect unsaved forms and resume the actual anchor click after Save or Discard',async t=>{
  const previous=globalThis.localStorage,storage=new Map();
  globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  t.after(()=>{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;});
  const {card,form}=settingsHarness('ai_settings');Object.assign(form,{provider:'home_assistant',agent_entity:'conversation.home_assistant'});card._openDetail('ai_settings');
  let clicks=0,closed=0;card._closeDetail=()=>closed++;
  const anchor={tagName:'A',dataset:{},matches:selector=>selector.includes('a[href]'),hasAttribute:key=>key==='href',getAttribute:()=>'/config/integrations/dashboard',click(){clicks++;const resumed=clickEvent(this);card._navigationClick(resumed);assert.equal(resumed.prevented,false);}};
  card._detailDirty=true;const initial=clickEvent(anchor);card._navigationClick(initial);
  assert.equal(initial.prevented,true);assert.equal(clicks,0);assert.equal(card.confirmed,1);
  card._navigationClick(clickEvent(actionTarget('data-keep-editing')));
  assert.equal(card._detailPending,null);assert.equal(card._detailDirty,true);
  card._navigationClick(clickEvent(anchor));await card._saveDetail();
  assert.equal(clicks,1);assert.equal(closed,1);assert.equal(card._detailDirty,false);
  assert.equal(card._sharedTestStore.value.settings.ai_settings.provider,'home_assistant');
  form.provider='openai';card._detailDirty=true;card._navigationClick(clickEvent(anchor));
  card._navigationClick(clickEvent(actionTarget('data-discard-detail')));
  assert.equal(clicks,2);assert.equal(closed,2);
  assert.equal(card._sharedTestStore.value.settings.ai_settings.provider,'home_assistant');
  const clean=clickEvent(anchor);card._navigationClick(clean);assert.equal(clean.prevented,false);
  const unsafe=clickEvent({...anchor,getAttribute:()=>'javascript:bad()'});card._navigationClick(unsafe);
  assert.equal(unsafe.prevented,true);assert.equal(clicks,2);
});

test('battery navigation rows retain rectangular corners without changing circular icon actions',async()=>{
  const source=await readFile(new URL('../custom_components/sigen_hybrid/frontend/sigen-hybrid-navigation.js',import.meta.url),'utf8');
  assert.match(source,/\.navigation-actions \.detail-link\{border-radius:16px;min-width:0;min-height:44px;flex:1 1 100%\}/);
  assert.match(source,/\.navigation-actions button,\.detail-icon\{[^}]*border-radius:50%/);
});

test('rich device and settings route catalogue contains no unhandled popup or subpage links', () => {
  const deviceRoutes = ['solar', 'load', 'battery', 'battery_module', 'inverter', 'gateway', 'grid', 'ac', 'dc', 'optimizer', 'strings', 'devices', 'forecast', 'weather', 'battery_energy', 'plant', 'alerts','alert_history','alert_detail','system_about','software_update','warranty','warranty_download','care','sigen_care','diagnosis','diagnosis_history','diagnosis_detail','modbus_server','support_history','service','messages','message_detail'];
  const extraRoutes = ['energy', 'statistics', 'power', 'production', 'consumption', 'energy_produced', 'solar_chart', 'load_chart', 'battery_chart', 'grid_chart', 'sensor','search','system_share','data_download'];
  const known = new Set([...deviceRoutes, ...SETTINGS_ROUTES, ...ENERGY_ROUTES, ...extraRoutes]);
  const charts = new Set(['power', 'solar', 'strings', 'battery', 'grid', 'load', 'ac', 'dc', 'soc', 'forecast', 'optimizer', 'price']);
  const config = {
    title: 'Test plant', weather_entity: 'weather.test',
    devices: [{ id: 'inv-1', type: 'inverter', name: 'Test inverter' }, { id: 'bat-1', type: 'battery_module', name: 'Test battery' }, { id: 'gateway-1', type: 'gateway' }, { id: 'ac-1', type: 'ac' }, { id: 'dc-1', type: 'dc' }],
    optimizers: [{ id: 'panel-1', power: 'sensor.test_panel', name: 'Test panel', string: 'Test string' }],
    alerts: [{ severity: 'warning', title: 'Test alert', message: 'A supplied test alert' }],
  };
  const readings = { solar_power: state(1, 'kW'), home_power: state(2, 'kW'), battery_power: state(-1, 'kW'), battery_soc: state(70, '%'), grid_power: state(0, 'kW'), ac_power: state(0, 'kW'), dc_power: state(0, 'kW'), cloud_mode: state('TOU', ''), native_mode: state('self_consumption', ''), control_status: state('live_writes_locked', '', { live_writes_locked: true }), forecast_status: state('forecast_solar', ''), forecast_today: state(8, 'kWh'), forecast_tomorrow: state(10, 'kWh'), solar_today: state(3, 'kWh'), home_today: state(4, 'kWh'), battery_charge_today: state(1, 'kWh'), battery_discharge_today: state(2, 'kWh'), grid_import_today: state(3, 'kWh'), grid_export_today: state(0, 'kWh'), 'sensor.test_panel': state(362, 'W', { sample_data: true }), 'weather.test': state('sunny', '', { temperature: 15, temperature_unit: '°C' }) };
  const card = new NavigationCard(fixture(readings, {}, config));
  const originalContext = card._detailContext.bind(card);
  card._detailContext = id => ({ ...originalContext(id), interfaceOptions: {
    strategy: { night: { name: 'Test overnight plan', weekdays: ['mon'], start: '02:00', end: '05:00', action: 'charge', condition: 'above', soc: 75 } },
    tariff_edit: { import: { name: 'Test import', currency: 'EUR', base_price: .09, timezone: 'Europe/Dublin', windows: [{ weekdays: ['mon'], start: '02:00', end: '05:00', price: .09 }] }, export: { name: 'Test export', currency: 'EUR', base_price: .18 } },
    vehicle: { car: { brand: 'Test brand', model: 'Test model', year: 2026, capacity_kwh: 60 } },
  } });
  let requests = 0; card._hass.callWS = () => { requests++; throw new Error('A route catalogue must not request data'); };
  const ids = { battery_module: 'bat-1', inverter: 'inv-1', gateway: 'gateway-1', ac: 'ac-1', dc: 'dc-1', optimizer: 'panel-1' };
  const combinations = [...deviceRoutes, ...extraRoutes, ...ENERGY_ROUTES].map(route => [route, ids[route]]);
  for (const route of SETTINGS_ROUTES) for (const id of [undefined, 'dc-1', 'import', 'export', 'year', 'new']) combinations.push([route, id]);
  const targets = new Set();
  for (const [route, id] of combinations) {
    const model = card._detailModel(route, id);
    assert.equal(typeof model?.body, 'string', `${route}:${id}`);
    for (const [, target] of model.body.matchAll(/\bdata-detail="([^"]+)"/g)) {
      assert.ok(known.has(target), `${route}:${id} links to unhandled route ${target}`); targets.add(target);
      assert.equal(typeof card._detailModel(target).body, 'string', `${route} → ${target}`);
    }
    for (const [, chart] of model.body.matchAll(/\bdata-chart="([^"]+)"/g)) assert.ok(charts.has(chart), `${route} has unsupported chart ${chart}`);
    assert.ok(!model.body.includes('data-detail=""'), route);
  }
  for (const route of ['battery_module', 'inverter', 'gateway', 'ac', 'dc', 'optimizer', 'charging_mode', 'charger_records', 'charger_schedule', 'vehicles', 'vehicle', 'tariff_edit', 'strategy', 'pv_capacity', 'pv_brand', 'pv_model', 'string_names', 'forecast_settings', 'safety']) assert.ok(targets.has(route), `${route} is not reachable from the rendered catalogue`);
  assert.equal(requests, 0);
});

test('current Day statistics use the actual daily counters rather than configured historical values', () => {
  const card = fixture({ solar_today: state(2.5, 'kWh'), home_today: state(10, 'kWh'), grid_export_today: state(0, 'kWh') }, {}, { energy_periods: { day: { '2026-10-27': { solar_today: 999, home_today: 999 } } } });
  const actual = statisticsValues(card, 'day', '2026-10-27');
  assert.equal(actual.solar_today, 2.5); assert.equal(actual.home_today, 10); assert.equal(actual.grid_export_today, 0);
  assert.equal(actual.battery_charge_today, null);
  assert.deepEqual(statisticsValues(card), actual);
});

test('historical Day, Month and Year totals never reuse Today or manufacture zero', () => {
  const card = fixture({ solar_today: state(2.5, 'kWh'), home_today: state(10, 'kWh'), grid_export_today: state(0, 'kWh') });
  for (const [period, date] of [['day', '2026-10-26'], ['month', '2026-10-27'], ['month', '2026-09-01'], ['year', '2026-10-27'], ['year', '2025-01-01']]) {
    assert.ok(Object.values(statisticsValues(card, period, date)).every(value => value === null), `${period}:${date}`);
  }
});

test('Lifetime statistics use verified cumulative energy entities with their real units', () => {
  const card = fixture({ solar_today: state(999, 'kWh'), solar_lifetime: state(.1, 'MWh'), home_lifetime: state(2, 'MWh'), battery_charge_lifetime: state(3000, 'Wh'), battery_discharge_lifetime: state(4, 'kWh'), grid_import_lifetime: state(5, 'kWh'), grid_export_lifetime: state(0, 'kWh'), ac_energy_lifetime: state(700, 'kWh'), dc_energy_lifetime: state(800, 'kWh'), ac_plant_lifetime: state(7, 'kWh'), dc_plant_lifetime: state(8, 'kWh') });
  assert.deepEqual(statisticsValues(card, 'lifetime', '2026-10-01'), { solar_today: 100, home_today: 2000, battery_charge_today: 3, battery_discharge_today: 4, grid_import_today: 5, grid_export_today: 0, ac_today: 7, dc_today: 8, dc_discharge_today: null });
  assert.equal(statisticsValues(fixture({dc_discharge_lifetime:state(500,'Wh')}),'lifetime').dc_discharge_today,.5);
  assert.deepEqual(statisticsValues(fixture({ solar_lifetime: state(100, 'unverified') }), 'lifetime').solar_today, null);
  const differentOrigins=statisticsValues(fixture({ac_energy_lifetime:state(700,'kWh'),dc_energy_lifetime:state(800,'kWh')}),'lifetime');
  assert.equal(differentOrigins.ac_today,null); assert.equal(differentOrigins.dc_today,null);
});

test('explicit period data is exact-date scoped and rejects negative, nonfinite, boolean and missing counters', () => {
  const card = fixture({ solar_today: state(999, 'kWh') }, {}, { energy_periods: {
    month: { '2026-09-01': { solar_today: '25.5', home_today: 0, battery_charge_today: -1, battery_discharge_today: Infinity, grid_import_today: true, grid_export_today: '', ac_today: 'bad', dc_today: null } },
    year: { '2025-01-01': { solar_today: 200, home_today: 300 } },
    day: { '2026-10-26': { solar_today: 5 } },
  } });
  const month = statisticsValues(card, 'month', '2026-09-01');
  assert.equal(month.solar_today, 25.5); assert.equal(month.home_today, 0);
  for (const key of ['battery_charge_today', 'battery_discharge_today', 'grid_import_today', 'grid_export_today', 'ac_today', 'dc_today']) assert.equal(month[key], null, key);
  assert.ok(Object.values(statisticsValues(card, 'month', '2026-09-02')).every(value => value === null));
  assert.ok(Object.values(statisticsValues(card, 'year', '2026-09-01')).every(value => value === null));
  assert.equal(statisticsValues(card, 'year', '2025-01-01').solar_today, 200);
  assert.equal(statisticsValues(card, 'day', '2026-10-26').solar_today, 5);
});

test('statistics proxy changes only selected energy counters and preserves parent state and toolbar layout', () => {
  const card = new NavigationCard(fixture({ solar_today: state(2.5, 'kWh'), solar_lifetime: state(.1, 'MWh'), grid_power: state(-1, 'kW') }));
  card._statsSelection = { period: 'month', date: '2026-09-01' };
  const proxy = card._statisticsCard();
  assert.equal(proxy._value('solar_today', 'energy'), null);
  assert.equal(proxy._value('grid_power', 'power'), -1);
  assert.equal(card._value('solar_today', 'energy'), 2.5);
  assert.equal(proxy._config, card._config);
  const body = card._statistics();
  for (const label of ['Day','Week', 'Month', 'Year', 'Lifetime']) assert.ok(body.includes(`>${label}</option>`), label);
  assert.ok(body.includes('data-statistics-date') && body.includes('data-statistics-period') && body.includes('data-statistics-step'));
  assert.ok(body.includes('Energy totals unavailable for this period'));
  card._statsSelection = { period: 'lifetime', date: '2026-10-27' };
  assert.equal(card._statisticsCard()._value('solar_today', 'energy'), 100);
  assert.ok(card._statistics().includes('Lifetime · kWh'));
});

test('Solar and Power charts distinguish the supplied forecast as a grey dashed overlay', () => {
  const card = fixture({ solar_power: state(1, 'kW'), grid_power: state(2, 'kW'), forecast_today: state(8, 'kWh', { available: true, series: [{ start: new Date(NOW + 3600000).toISOString(), end: new Date(NOW + 7200000).toISOString(), power_kw: 2.5 }] }) }, { 'sensor.solar_power': [{ start: NOW - 1000, mean: 1 }] });
  for (const kind of ['solar', 'power']) {
    const series = historySeries(card, kind), forecasts = series.filter(item => item.key === 'forecast');
    assert.equal(forecasts.length, 1); assert.equal(forecasts[0].forecast, true); assert.equal(forecasts[0].color, '#92a0b1');
    assert.equal(forecasts[0].dash, '6 5'); assert.equal(forecasts[0].unit, 'kW'); assert.equal(forecasts[0].points[0].value, 2.5);
    assert.equal(series.find(item => item.key === 'solar_power').points[0].value, 1);
  }
  assert.ok(!historySeries(card, 'grid').some(item => item.key === 'forecast'));
  card._hass.states['sensor.forecast_today'].attributes.available = false;
  assert.ok(!historySeries(card, 'solar').some(item => item.key === 'forecast'));
});

function localStore(t){
  const previous=globalThis.localStorage,data=new Map();
  globalThis.localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  t.after(()=>{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;});return data;
}

function previewTarget(kind,value){
  const attribute=`data-preview-${kind}`,key=`preview${kind[0].toUpperCase()+kind.slice(1)}`;
  return {dataset:{[key]:value},matches:selector=>selector.includes(`[${attribute}]`),hasAttribute:name=>name===attribute};
}

test('temporary preview toolbar sits below overview navigation and does not appear on other pages',t=>{
  localStore(t);const card=new NavigationCard(fixture({}, {}, {show_preview_controls:true}));Object.assign(card,{_view:'overview',_tab:'overview'});
  const html=card._content();
  assert.equal((html.match(/aria-label="Display preview"/g)??[]).length,1);
  assert.ok(html.indexOf('</nav>')<html.indexOf('overview-preview-toolbar'));
  assert.ok(html.indexOf('overview-preview-toolbar')<html.indexOf('class="overview-grid"'));
  for(const [kind,values] of [['display',['house','flow','photo']],['appearance',['auto','day','night']],['layout',['current','classic','advanced']]]){
    for(const value of values)assert.match(html,new RegExp(`data-preview-${kind}="${value}" aria-pressed="(?:true|false)"`));
  }
  assert.match(html,/data-preview-display="photo" aria-pressed="true"/);
  assert.match(html,/data-preview-appearance="auto" aria-pressed="true"/);
  assert.match(html,/data-preview-layout="current" aria-pressed="true"/);
  for(const tab of ['energy','charts','devices']){card._tab=tab;assert.doesNotMatch(card._content(),/overview-preview-toolbar/);}
  card._view='battery';assert.doesNotMatch(card._content(),/overview-preview-toolbar/);
});

test('preview actions remain per-card, reset to saved configuration, and never persist preferences or control the plant',t=>{
  const storage=localStore(t),card=new NavigationCard(fixture({}, {}, {config_entry:'preview-one',main_display:'photo',show_preview_controls:true})),other=new NavigationCard();
  Object.assign(card,{_view:'overview',_tab:'overview'});let renders=0;
  card._render=()=>renders++;card._hass.callService=()=>assert.fail('No plant command');card._hass.callWS=()=>assert.fail('No provider call');
  const saved={route:'display_settings',local_only:true,...displayDefaults(card._detailContext()),main_display:'flow',appearance:'night',immersive_weather:true};
  storage.set('sigen-hybrid:interface:preview-one',JSON.stringify({display_settings:saved}));const before=[...storage.entries()];
  card._navigationClick(clickEvent(previewTarget('display','house')));assert.equal(card._previewMainDisplay,'house');
  card._navigationClick(clickEvent(previewTarget('appearance','day')));assert.equal(card._previewAppearance,'day');
  card._navigationClick(clickEvent(previewTarget('layout','advanced')));assert.equal(card._previewLayout.preset,'advanced');
  assert.deepEqual(card._previewLayout.hidden,[]);assert.notEqual(card._previewLayout.order,DISPLAY_PRESETS.advanced.order);assert.equal(card._previewLayout.immersive_weather,true);
  assert.match(card._content(),/data-preview-layout="advanced" aria-pressed="true"/);
  assert.doesNotMatch(card._content(),/extended-energy-grid|saved-energy-layout|data-display-module="power"/);assert.deepEqual([...storage.entries()],before);
  assert.equal(other._previewMainDisplay,undefined);assert.equal(other._previewAppearance,undefined);assert.equal(other._previewLayout,undefined);
  card._navigationClick(clickEvent(previewTarget('layout','current')));assert.equal(card._previewLayout,undefined);assert.equal(card._previewMainDisplay,'house');assert.equal(card._previewAppearance,'day');
  card._navigationClick(clickEvent(previewTarget('reset','')));assert.equal(card._previewMainDisplay,undefined);assert.equal(card._previewAppearance,undefined);assert.equal(card._previewLayout,undefined);
  const reset=card._content();assert.match(reset,/data-preview-display="flow" aria-pressed="true"/);assert.match(reset,/data-preview-appearance="night" aria-pressed="true"/);
  assert.equal(renders,5);assert.deepEqual([...storage.entries()],before);
});

test('preview changes respect an unsaved form and invalid values cannot change the display',t=>{
  localStore(t);const card=new NavigationCard();let prompts=0,renders=0,closed=0;
  card._render=()=>renders++;card._confirmDiscard=()=>prompts++;card._closeDetail=()=>{closed++;card._detailDialog=null;};
  card._detailDirty=true;card._detailDialog={querySelector:()=>null};card._navigationClick(clickEvent(previewTarget('display','flow')));
  assert.equal(prompts,1);assert.equal(renders,0);assert.equal(card._previewMainDisplay,undefined);
  card._navigationClick(clickEvent({dataset:{},matches:()=>true,hasAttribute:attribute=>attribute==='data-keep-editing'}));
  assert.equal(card._detailPending,null);assert.equal(card._previewMainDisplay,undefined);
  card._navigationClick(clickEvent(previewTarget('display','flow')));card._detailDirty=false;card._runPendingDetail();
  assert.equal(card._previewMainDisplay,'flow');assert.equal(renders,1);assert.equal(closed,1);
  for(const kind of ['display','appearance','layout'])card._navigationClick(clickEvent(previewTarget(kind,'invalid')));
  assert.equal(renders,1);assert.equal(card._previewMainDisplay,'flow');assert.equal(card._previewAppearance,undefined);assert.equal(card._previewLayout,undefined);
});

test('preview rendering restores keyboard focus to the chosen button',t=>{
  localStore(t);const card=new NavigationCard();let focused=0,selector;
  card._render=()=>{};card.shadowRoot.querySelector=value=>{selector=value;return {focus(){focused++;}};};
  card._changeOverviewPreview(previewTarget('display','flow'));
  assert.equal(selector,'[data-preview-display="flow"]');assert.equal(focused,1);
  card._changeOverviewPreview(previewTarget('reset',''));
  assert.equal(selector,'[data-preview-reset]');assert.equal(focused,2);
});

test('saved homepage appearance reads only scoped trusted values without recursing into detail context',t=>{
  const storage=localStore(t),card=new NavigationCard(fixture({}, {}, {title:'Scoped title'}));
  card._detailContext=()=>assert.fail('Appearance must not recurse through _detailContext and _night');
  const key='sigen-hybrid:interface:Scoped title';
  for(const appearance of ['auto','day','night','theme']){
    storage.set(key,JSON.stringify({display_settings:{route:'display_settings',local_only:true,appearance}}));assert.equal(card._savedHomepageAppearance(),appearance);
  }
  for(const value of ['{broken',JSON.stringify({display_settings:{appearance:'night'}}),JSON.stringify({display_settings:{route:'display_settings',local_only:false,appearance:'night'}}),JSON.stringify({display_settings:{route:'display_settings',local_only:true,appearance:'invalid'}})]){
    storage.set(key,value);assert.equal(card._savedHomepageAppearance(),undefined);
  }
  storage.set('sigen-hybrid:interface:another',JSON.stringify({display_settings:{route:'display_settings',local_only:true,appearance:'night'}}));storage.delete(key);assert.equal(card._savedHomepageAppearance(),undefined);
});

test('homepage background reads only the validated saved draft for this card scope',t=>{
  const storage=localStore(t),card=new NavigationCard(fixture({}, {}, {config_entry:'background-one'}));
  card._hass.callService=()=>assert.fail('Background changes cannot send a plant command');card._hass.callWS=()=>assert.fail('No provider request');
  const defaults=displayDefaults(card._detailContext()),key='sigen-hybrid:interface:background-one',saved={...defaults,route:'display_settings',local_only:true,background_type:'image',background_image:'/local/my-background.jpg'};
  assert.equal(card._homepageBackground().type,'theme');
  storage.set('sigen-hybrid:interface:another',JSON.stringify({display_settings:saved}));assert.equal(card._homepageBackground().type,'theme');
  storage.set(key,JSON.stringify({display_settings:{...saved,local_only:false}}));assert.equal(card._homepageBackground().type,'theme');
  storage.set(key,JSON.stringify({display_settings:{...saved,background_image:'javascript:bad()'}}));assert.equal(card._homepageBackground().type,'theme');
  storage.set(key,JSON.stringify({display_settings:saved}));const before=[...storage.entries()];
  assert.deepEqual(card._homepageBackground(),{type:'image',color:'#17444e',image:'/local/my-background.jpg'});assert.deepEqual([...storage.entries()],before);
  storage.set(key,JSON.stringify({display_settings:{...saved,background_type:'color',background_color:'#AABBCC',background_image:''}}));
  assert.deepEqual(card._homepageBackground(),{type:'color',color:'#aabbcc',image:''});
});

test('header keeps Search and Plant information while customization has one Settings home',()=>{
  const card=new NavigationCard(),html=card._header();
  assert.deepEqual([...html.matchAll(/data-detail="([^"]+)"/g)].map(match=>match[1]),['search','plant']);
  assert.doesNotMatch(html,/data-home-menu|data-display-weather/);
  assert.match(card._detailModel('settings').body,/data-detail="display_settings"/);
});

test('Settings extends existing navigation while Service remains available as a detail route',async()=>{
  const original='<nav class="original" aria-label="Energy sections">'+['overview','energy','charts','devices'].map(tab=>`<button data-tab="${tab}">${tab}</button>`).join('')+'</nav><section>Content</section>';
  const upgraded=withServiceNavigation(original);
  assert.deepEqual([...upgraded.matchAll(/data-tab="([^"]+)"/g)].map(match=>match[1]),['overview','energy','charts','devices','settings']);
  assert.match(upgraded,/<nav class="original energy-tab-strip" aria-label="Energy sections">/);
  assert.equal((upgraded.match(/data-detail="service"/g)??[]).length,0);assert.equal((upgraded.match(/data-tab="settings"/g)??[]).length,1);
  assert.equal(withServiceNavigation(upgraded).match(/data-tab="settings"/g).length,1);
  assert.ok(upgraded.endsWith('<section>Content</section>'));
  const card=new NavigationCard(fixture({}, {}, {messages:[],service_provider:{name:'Example installer'},service:{community_url:'https://community.example.invalid/'}}));
  for(const route of ['service','messages','message_detail'])assert.equal(typeof card._detailModel(route).body,'string');
  const source=await readFile(new URL('../custom_components/sigen_hybrid/frontend/sigen-hybrid-navigation.js',import.meta.url),'utf8');
  assert.match(source,/\.energy-tab-strip\{overflow-x:auto;/);assert.match(source,/\.energy-tab-strip>button\{flex:0 0 auto;white-space:nowrap\}/);
});

test('local search indexes only known routes, supplied devices, mapped readings and supplied alerts',()=>{
  const readings={pv:state(1.2,'kW',{friendly_name:'Café solar'}),export:state('off','',{friendly_name:'Export permission'})};
  const ctx={entities:{solar_power:'sensor.pv',export_permitted:'binary_sensor.export',missing:'sensor.absent'},state:key=>key==='solar_power'?readings.pv:key==='export_permitted'?readings.export:key==='sensor.panel_one'?state(300,'W'):null,inventory:[{serial:'inv-one',type:'inverter',name:'Garage inverter',model:'EC Test'},{id:'bad',type:'constructor',name:'Unsafe type'}],optimizers:[{id:'panel-one',power:'sensor.panel_one',name:'South panel 1',string:'String1'},{power:'sensor.unknown_panel',name:'Unreported panel'}],config:{alerts_active:[{title:'Battery warning',message:'Supplied warning'}]}};
  const entries=searchCatalogue(ctx);
  assert.equal(searchMatches(entries,'cafe')[0].label,'Café solar');
  assert.equal(searchMatches(entries,'garage inverter')[0].id,'inv-one');
  assert.equal(searchMatches(entries,'export permission')[0].id,'export_permitted');
  assert.equal(searchMatches(entries,'south panel')[0].id,'panel-one');assert.equal(searchMatches(entries,'unreported panel').length,0);
  assert.equal(searchMatches(entries,'battery warning','alerts').length,1);
  assert.equal(searchMatches(entries,'','forum').length,0);
  assert.ok(!entries.some(item=>item.label==='Unsafe type'||item.key==='entity:sensor.absent'));
  assert.ok(entries.filter(item=>item.href).every(item=>item.category==='help'&&item.href.startsWith('https://sigenergy.com/')));
  const card=new NavigationCard(fixture({'sensor.pv':state(2,'kW')},{},{devices:[{id:'one',type:'inverter',name:'<img src=x onerror=bad>'}]}));
  card._searchSelection={query:'',category:'functions'};
  const page=card._detailModel('search').body;
  assert.match(page,/&lt;img/);assert.doesNotMatch(page,/<img src=x/);assert.match(page,/data-detail="ai"/);
  card._searchSelection={category:'help'};assert.match(card._detailModel('search').body,/href="https:\/\/sigenergy.com\/en\/support\/learn" target="_blank" rel="noopener noreferrer"/);
});

test('display preferences require an explicitly saved valid draft and cannot mutate input order',()=>{
  const defaults=displayDefaults({config:{overview_sections:['power','today']}}),draft={route:'display_settings',local_only:true,...defaults};
  assert.equal(savedDisplaySettings({interfaceOptions:{display_settings:defaults}}),null);
  assert.equal(savedDisplaySettings({interfaceOptions:{display_settings:{...draft,order:['power']}}}),null);
  assert.deepEqual(savedDisplaySettings({interfaceOptions:{display_settings:draft}}).order,defaults.order);
  const before=[...defaults.order],moved=moveDisplayModule(before,'power',0);
  assert.equal(moved[0],'power');assert.deepEqual(before,defaults.order);assert.equal(new Set(moved).size,DISPLAY_MODULES.length);
});

test('unsaved display edits leave the original sidebar intact and saved modules preserve explicit order and independent manual controls',t=>{
  const storage=localStore(t),card=new NavigationCard(fixture({battery_soc:state(50,'%')},{},{overview_sections:['power','today']}));
  Object.assign(card,{_view:'overview',_tab:'overview',_scene:'house'});
  const original=card._content(),defaults=displayDefaults(card._detailContext()),keys=DISPLAY_MODULES.map(item=>item.key);
  const order=['manual_controls','forecast','power',...keys.filter(key=>!['manual_controls','forecast','power'].includes(key))],hidden=keys.filter(key=>!['manual_controls','forecast','power'].includes(key));
  storage.set('sigen-hybrid:interface:default',JSON.stringify({display_settings:{...defaults,order,hidden}}));
  assert.equal(card._content(),original);
  storage.set('sigen-hybrid:interface:default',JSON.stringify({display_settings:{route:'display_settings',local_only:true,preset:'custom',order,hidden,immersive_weather:false}}));
  const saved=card._content();assert.deepEqual([...saved.matchAll(/data-display-module="([^"]+)"/g)].map(match=>match[1]),['manual_controls','forecast']);
  assert.match(saved,/Manual controls/);assert.doesNotMatch(saved,/data-display-module="current_mode_battery"|data-display-module="power"|extended-energy-grid/);assert.match(saved,/Overview frame/);
  storage.set('sigen-hybrid:interface:default',JSON.stringify({display_settings:{route:'display_settings',local_only:true,...defaults,immersive_weather:true}}));
  assert.match(card._content(),/Overview frame/);assert.doesNotMatch(card._content(),/saved-energy-layout|data-display-module="power"/);
});

test('overview always ends at its main frame while saved and preview analytics stay available in other views',t=>{
  const storage=localStore(t),card=new NavigationCard(fixture({battery_soc:state(50,'%'),solar_power:state(1,'kW')},{},{overview_sections:['statistics','power','today','tariff','solar_chart']}));
  Object.assign(card,{_view:'overview',_tab:'overview'});
  const before=JSON.stringify(card._config),defaults=displayDefaults(card._detailContext()),keys=DISPLAY_MODULES.map(item=>item.key);
  const verify=()=>{
    const html=card._content(),modules=[...html.matchAll(/data-display-module="([^"]+)"/g)].map(match=>match[1]);
    assert.ok(html.endsWith('</section>'));
    assert.doesNotMatch(html,/overview-preview-toolbar/);
    assert.ok(modules.every(key=>['forecast','today','current_mode_battery','manual_controls'].includes(key)));
    assert.doesNotMatch(html,/Original sidebar|extended-energy-grid|saved-energy-layout|data-upgrade-chart|sigen-history-chart|Energy statistics/);
    assert.equal((html.match(/Overview frame/g)??[]).length,1);
    return modules;
  };
  assert.deepEqual(verify(),['forecast','today','current_mode_battery','manual_controls']);
  for(const preset of ['classic','advanced']){
    card._previewLayout={...defaults,...DISPLAY_PRESETS[preset],preset};assert.ok(verify().includes('manual_controls'));
  }
  delete card._previewLayout;
  const saved={...defaults,route:'display_settings',local_only:true,preset:'advanced',order:[...keys],hidden:[]};
  storage.set('sigen-hybrid:interface:default',JSON.stringify({display_settings:saved}));const stored=[...storage.entries()];
  assert.ok(verify().includes('today'));assert.deepEqual([...storage.entries()],stored);assert.equal(JSON.stringify(card._config),before);
  card._tab='charts';const charts=card._content();assert.match(charts,/chart-catalog/);assert.match(charts,/data-chart-panel="power"/);assert.doesNotMatch(charts,/overview-preview-toolbar/);
  card._tab='energy';assert.match(card._content(),/Original sidebar/);assert.doesNotMatch(card._content(),/overview-preview-toolbar/);
  card._view='statistics';assert.match(card._content(),/Original sidebar/);
});

function displayForm(initial){
  const listeners={},keys=DISPLAY_MODULES.map(item=>item.key),preset={value:initial.preset,matches:selector=>selector==='[data-display-preset]'},weather={checked:initial.immersive_weather},positions=new Map(),visible=new Map(),rows=new Map(),list={items:[...initial.order],appendChild(row){this.items=this.items.filter(key=>key!==row.dataset.displayKey);this.items.push(row.dataset.displayKey);}};
  for(const key of keys){positions.set(key,{name:`order_${key}`,value:String(initial.order.indexOf(key)+1)});visible.set(key,{name:'visible',value:key,checked:!initial.hidden.includes(key)});const row={dataset:{displayKey:key},closest:selector=>selector==='[data-display-row]'?row:null};rows.set(key,row);}
  const form={reportValidity:()=>true,addEventListener(type,handler){(listeners[type]??=[]).push(handler);},querySelector(selector){if(selector==='[data-display-preset]')return preset;if(selector==='[name="immersive_weather"]')return weather;if(selector==='.settings-display-list')return list;let match=/^\[name="order_([^"]+)"\]$/.exec(selector);if(match)return positions.get(match[1]);match=/^\[name="visible"\]\[value="([^"]+)"\]$/.exec(selector);if(match)return visible.get(match[1]);match=/^\[data-display-row\]\[data-display-key="([^"]+)"\]$/.exec(selector);return match?rows.get(match[1]):null;},*entries(){yield ['preset',preset.value];for(const [key,control] of positions)yield [`order_${key}`,control.value];for(const [key,control] of visible)if(control.checked)yield ['visible',key];if(weather.checked)yield ['immersive_weather','on'];},getAll(name){return [...this.entries()].filter(([key])=>key===name).map(([,value])=>value);}};
  return {form,preset,weather,positions,visible,rows,list,fire:(type,event)=>listeners[type]?.forEach(handler=>handler(event))};
}

test('display editor keeps appearance through preset and ordering changes and restores its default',t=>{
  localStore(t);const card=new NavigationCard(fixture({}, {}, {appearance:'auto'})),defaults=displayDefaults(card._detailContext()),ui=displayForm(defaults),appearance={value:'auto'},query=ui.form.querySelector;
  ui.form.querySelector=selector=>selector==='[name="appearance"]'?appearance:query(selector);
  card._detailDialog={querySelector:selector=>selector==='[data-settings-form="display_settings"]'?ui.form:null};card._bindDisplayForm();
  appearance.value='night';assert.equal(card._displayDraft(ui.form).appearance,'night');
  ui.preset.value='advanced';ui.fire('change',{target:ui.preset});assert.equal(appearance.value,'night');
  ui.positions.get('power').value='1';ui.fire('change',{target:ui.positions.get('power')});assert.equal(appearance.value,'night');
  const restore={hasAttribute:key=>key==='data-display-restore',closest:()=>restore};ui.fire('click',{target:restore,preventDefault(){}});
  assert.equal(appearance.value,'auto');assert.equal(card._displayDraft(ui.form).appearance,'auto');
});

test('background editing survives layout changes, saves locally and restores the default only after Save',t=>{
  const storage=localStore(t),card=new NavigationCard(),defaults=displayDefaults(card._detailContext()),ui=displayForm(defaults),output={},query=ui.form.querySelector;
  const controls={background_type:{value:'image'},background_color:{value:'#AABBCC'},background_image:{value:'/local/my-background.jpg'}};
  ui.form.querySelector=selector=>{const match=/^\[name="(background_type|background_color|background_image)"\]$/.exec(selector);return match?controls[match[1]]:query(selector);};
  const entries=ui.form.entries.bind(ui.form);ui.form.entries=function*(){yield*entries();for(const [key,control] of Object.entries(controls))yield [key,control.value];};
  card._detailDialog={querySelector:selector=>selector==='[data-settings-form="display_settings"]'||selector==='[data-settings-form]'?ui.form:selector==='.detail-save-notice'?output:null};
  card._detailStack=[{route:'display_settings'}];card._bindDisplayForm();
  ui.preset.value='advanced';ui.fire('change',{target:ui.preset});ui.positions.get('power').value='1';ui.fire('change',{target:ui.positions.get('power')});
  const draft=card._displayDraft(ui.form);assert.equal(draft.background_type,'image');assert.equal(draft.background_color,'#aabbcc');assert.equal(draft.background_image,'/local/my-background.jpg');
  assert.equal(storage.size,0);assert.equal(card._homepageBackground().type,'theme');
  card._saveDetail();assert.deepEqual(card._homepageBackground(),{type:'image',color:'#aabbcc',image:'/local/my-background.jpg'});
  const before=[...storage.entries()],restore={hasAttribute:key=>key==='data-display-restore',closest:()=>restore};ui.fire('click',{target:restore,preventDefault(){}});
  assert.equal(controls.background_type.value,'theme');assert.equal(controls.background_color.value,'#17444e');assert.equal(controls.background_image.value,'');
  assert.equal(card._homepageBackground().type,'image');assert.deepEqual([...storage.entries()],before);
  card._saveDetail();assert.equal(card._homepageBackground().type,'theme');
});

test('display preset, move, position and restore controls stay inert until Save',t=>{
  const storage=localStore(t),card=new NavigationCard(fixture({battery_soc:state(50,'%')},{},{overview_sections:['power','today']}));
  Object.assign(card,{_view:'overview',_tab:'overview',_scene:'house'});const original=card._content(),defaults=displayDefaults(card._detailContext()),ui=displayForm(defaults),output={};
  card._detailDialog={querySelector:selector=>selector==='[data-settings-form="display_settings"]'||selector==='[data-settings-form]'?ui.form:selector==='.detail-save-notice'?output:null};
  card._detailStack=[{route:'display_settings'}];card._bindDisplayForm();
  ui.preset.value='advanced';ui.fire('change',{target:ui.preset});assert.ok([...ui.visible.values()].every(item=>item.checked));
  const move={dataset:{displayKey:'power',displayMove:'-1'},hasAttribute:()=>false,closest:()=>move};
  const previous=ui.form._displayOrder.indexOf('power');ui.fire('click',{target:move,preventDefault(){}});assert.equal(ui.form._displayOrder.indexOf('power'),previous-1);
  ui.positions.get('power').value='18';ui.fire('change',{target:ui.positions.get('power')});assert.equal(ui.form._displayOrder.at(-1),'power');assert.equal(new Set([...ui.positions.values()].map(item=>item.value)).size,18);
  ui.fire('dragstart',{target:ui.rows.get('power'),dataTransfer:{setData(){}}});ui.fire('drop',{target:ui.rows.get('forecast'),preventDefault(){}});assert.notEqual(ui.form._displayOrder.at(-1),'power');
  const restore={hasAttribute:key=>key==='data-display-restore',closest:()=>restore};ui.fire('click',{target:restore,preventDefault(){}});
  assert.deepEqual(ui.form._displayOrder,defaults.order);assert.equal(storage.size,0);assert.equal(card._content(),original);
  card._saveDetail();const saved=JSON.parse([...storage.values()][0]).display_settings;
  assert.equal(saved.route,'display_settings');assert.equal(saved.local_only,true);assert.deepEqual(saved.order,defaults.order);assert.equal(card._renderPending,true);
});

test('Week totals use only explicit local week-start records and weekly charts use scoped hourly HA reads',async()=>{
  const card=new NavigationCard(fixture({solar_today:state(999,'kWh'),solar_power:state(1,'kW')},{},{energy_periods:{week:{'2026-10-26':{solar_today:12}}}}));
  assert.equal(statisticsValues(card,'week','2026-10-27').solar_today,12);
  assert.equal(statisticsValues(card,'week','2026-10-20').solar_today,null);
  card._config.week_start=0;assert.equal(statisticsValues(card,'week','2026-10-27').solar_today,null);
  card._config.energy_periods.week['2026-10-25']={solar_today:7};assert.equal(statisticsValues(card,'week','2026-10-27').solar_today,7);
  assert.match(card._statistics(),/>Week<\/option>/);
  const requests=[];card._hass.callWS=async request=>{requests.push(request);return {};};
  const chart=card._chartData('solar');assert.equal(chart.weekStart,0);
  await chart.load({start:NOW-7*86400000,end:NOW,period:'week'});assert.equal(requests[0].period,'hour');assert.deepEqual(requests[0].statistic_ids,['sensor.solar_power']);
});

test('system sharing uses native HA users and data download keeps CSV controls without graphs',()=>{
  const card=new NavigationCard();
  assert.match(card._detailModel('system_share').body,/href="\/config\/users"/);
  const download=card._detailModel('data_download','battery').body;
  assert.match(download,/<option value="battery" selected>/);assert.match(download,/data-download-records/);assert.doesNotMatch(download,/<sigen-history-chart|email|mailto:|send/i);
  card._hass.locale={language:'en'};card._hass.config.unit_system={length:'km'};card._hass.themes={darkMode:true};
  const ctx=card._detailContext();assert.equal(ctx.haLocale.language,'en');assert.equal(ctx.haUnitSystem.length,'km');assert.equal(ctx.haDarkMode,true);
});

test('settings and device popups contain no history graphs while explicit chart views remain available',()=>{
  const card=new NavigationCard();
  for(const route of [...SETTINGS_ROUTES,...ENERGY_ROUTES,'solar','battery','battery_energy','battery_module','inverter','gateway','grid','load','ac','dc','optimizer','strings','forecast','data_download']){
    assert.doesNotMatch(card._detailModel(route).body,/<sigen-history-chart|data-chart=/,route);
  }
  for(const route of ['power','solar_chart','load_chart','battery_chart','grid_chart'])assert.match(card._detailModel(route).body,/<sigen-history-chart/,route);
});

test('CSV export loads recorded readings directly without creating a hidden chart',async t=>{
  const previousDocument=globalThis.document,created=[];
  t.after(()=>{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});
  let clicked=0,blob;
  globalThis.document={createElement:tag=>{created.push(tag);return {click(){clicked++;}};}};
  t.mock.method(URL,'createObjectURL',value=>{blob=value;return 'blob:recorded-export';});
  t.mock.method(URL,'revokeObjectURL',()=>{});
  const card=new NavigationCard(),output={},controls={'[name="download_kind"]':{value:'solar'},'[name="download_period"]':{value:'day'},'[name="download_date"]':{value:'2026-10-27'},'[data-download-status]':output};
  card._detailDialog={querySelector:key=>controls[key]};
  card._chartData=()=>({load:async()=>[{key:'solar',label:'Solar',unit:'kW',points:[{time:NOW-1000,value:1.5}]}]});
  const button={disabled:false};await card._downloadRecords(button);
  assert.deepEqual(created,['a']);assert.equal(clicked,1);assert.equal(button.disabled,false);assert.equal(output.textContent,'CSV downloaded.');
  assert.match(await blob.text(),/timestamp_utc,series,value,unit[\s\S]*Solar,1.5,kW/);
});

test('alert filtering persists only in card memory and preserves the current route and input focus',()=>{
  const card=new NavigationCard(),listeners={},input={type:'search',dataset:{alertFilter:'query'},value:'battery',selectionStart:3,selectionEnd:3,addEventListener:(type,listener)=>{listeners[type]=listener;}};
  let focused=0,selection,opened;
  card._detailStack=[{route:'alerts'}];card._detailDialog={querySelectorAll:()=>[input],querySelector:()=>({focus(){focused++;},setSelectionRange(...range){selection=range;}})};card._openDetail=(...args)=>{opened=args;};
  card._bindAlertFilters();listeners.input();
  assert.deepEqual(card._detailContext().alertFilters,{query:'battery'});assert.deepEqual(opened,['alerts',undefined,true]);assert.equal(focused,1);assert.deepEqual(selection,[3,3]);
});

test('summary expansion resolves actual overview values before generic settings placeholders',t=>{
  const store=localStore(t),card=new NavigationCard(fixture({import_cost_today:state(2,'EUR'),export_revenue_today:state(.5,'EUR'),solar_today:state(10,'kWh')},{},{environmental_factors:{co2_kg_per_kwh:.4}}));
  let requests=0;card._hass.callWS=()=>{requests++;throw new Error('Summary expansion must remain local');};
  const money=card._detailModel('energy_value').body,environment=card._detailModel('environment').body;
  assert.match(money,/2 EUR/);assert.match(money,/0.5 EUR/);assert.match(money,/1.5 EUR/);
  assert.match(environment,/4 kg/);assert.match(environment,/0.4 kg\/kWh/);assert.match(environment,/Today · Estimate/);
  assert.doesNotMatch(money,/widget-expand|data-detail="energy_value"/);assert.doesNotMatch(environment,/No factors|widget-expand|data-detail="environment"/);
  store.set('sigen-hybrid:interface:default',JSON.stringify({environment:{co2_kg_per_kwh:.2}}));
  assert.match(card._detailModel('environment').body,/2 kg/);
  assert.equal(requests,0);
});

test('expanded summary readings and configured factors refresh through text only',t=>{
  const old=Object.fromEntries(['.widget-metric strong','.widget-bottom-total strong','.widget-bottom-total small','.widget-detail-period .widget-badge','.widget-factor-list dd'].map(selector=>[selector,[{textContent:'old'}]]));
  const next=Object.fromEntries(Object.keys(old).map(selector=>[selector,[{textContent:`new ${selector}`}]]));
  const previous=globalThis.document;globalThis.document={createElement:()=>({innerHTML:'',content:{querySelector:()=>null,querySelectorAll:selector=>next[selector]??[]}})};
  t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
  const card=new NavigationCard();card._detailStack=[{route:'environment'}];card._detailDialog={querySelector:()=>null,querySelectorAll:selector=>old[selector]??[]};
  card._refreshDetailReadings();
  for(const [selector,readings]of Object.entries(old))assert.equal(readings[0].textContent,`new ${selector}`);
});

test('battery direction labels and accessible readings refresh with the magnitude',t=>{
  const selectors=['.detail-metric strong','.detail-metric small','tbody th','tbody td'];
  const old=Object.fromEntries(selectors.map(selector=>[selector,[{textContent:selector.includes('strong')||selector.includes('td')?'2 kW':'Charging power'}]]));
  const next=Object.fromEntries(selectors.map(selector=>[selector,[{textContent:selector.includes('strong')||selector.includes('td')?'3 kW':'Discharging power'}]]));
  const accessible={label:'Charging power: 2 kW',getAttribute(){return this.label;},setAttribute(name,value){this.label=value;}};
  old['.detail-metric[data-entity]']=[accessible];next['.detail-metric[data-entity]']=[{getAttribute:()=> 'Discharging power: 3 kW'}];
  const previous=globalThis.document;globalThis.document={createElement:()=>({innerHTML:'',content:{querySelector:()=>null,querySelectorAll:selector=>next[selector]??[]}})};
  t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
  const card=new NavigationCard();card._detailStack=[{route:'battery'}];card._detailDialog={querySelector:()=>null,querySelectorAll:selector=>old[selector]??[]};
  card._refreshDetailReadings();
  assert.equal(old['.detail-metric small'][0].textContent,'Discharging power');assert.equal(old['tbody th'][0].textContent,'Discharging power');
  assert.equal(old['.detail-metric strong'][0].textContent,'3 kW');assert.equal(accessible.label,'Discharging power: 3 kW');
});

test('combined PV strings retain only explicit own power histories with units, gaps and no aggregate forecast',async()=>{
  const config={devices:[{id:'pv1',type:'string',name:'String 1',entities:{solar_power:'sensor.own_pv1'}},{id:'pv2',type:'pvstring',name:'String 2',entities:{power:'sensor.own_pv2'}},{id:'duplicate',type:'string',entities:{power:'sensor.own_pv1'}},{id:'aggregate',type:'string',entities:{power:'sensor.solar_power'}}]};
  const readings={solar_power:state(9,'kW'),forecast_today:state(5,'kWh',{available:true,series:[{start:new Date(NOW).toISOString(),power_kw:8}]}),'sensor.own_pv1':state('unavailable','W'),'sensor.own_pv2':state(2,'kW')};
  const rows={'sensor.own_pv1':[{start:NOW-2000,mean:450},{start:NOW-1000,state:'unavailable'},{start:NOW,mean:0}],'sensor.own_pv2':[{start:NOW,mean:1.5}],'sensor.solar_power':[{start:NOW,mean:99}]};
  const card=new NavigationCard(fixture(readings,rows,config)),chart=card._chartData('strings');
  assert.equal(chart.title,'PV Strings');assert.equal(chart.series.length,2);assert.deepEqual(chart.series.map(series=>series.label),['String 1','String 2']);
  assert.deepEqual(chart.series[0].points.map(point=>point.value),[.45,null,0]);assert.equal(chart.series[1].points[0].value,1.5);
  assert.ok(chart.series.every(series=>series.unit==='kW'&&!series.forecast));assert.doesNotMatch(card._detailModel('solar').body,/<sigen-history-chart/);
  const requests=[];card._hass.callWS=async request=>{requests.push(request);return rows;};
  const loaded=await chart.load({start:NOW-3600000,end:NOW,period:'day'});
  assert.deepEqual(requests[0].statistic_ids,['sensor.own_pv1','sensor.own_pv2']);assert.deepEqual(loaded,chart.series);
  card._hass.states['sensor.own_pv1'].attributes.unit_of_measurement='V';assert.deepEqual(historySeries(card,'strings')[0].points,[]);
});

test('new charger schedules receive separate stable identities scoped to the selected device',()=>{
  const {card}=settingsHarness('strategy');card._detailModel=(route,id)=>({title:'Schedule',body:`<div>${id}</div>`});
  const ids=[];
  for(const charger of ['ac:opaque/one','dc-two','ac:opaque/one']){
    card._openDetail('charger_schedule',encodeChargerScheduleId(charger,'new'));
    const id=card._detailStack.at(-1).id,decoded=decodeChargerScheduleId(id);
    assert.equal(decoded.chargerId,charger);assert.match(decoded.scheduleId,/^draft-[a-z0-9-]+$/);ids.push(id);
    card._openDetail('charger_schedule',id,true);assert.equal(card._detailStack.at(-1).id,id);
  }
  assert.equal(new Set(ids).size,3);
  card._detailDirty=true;const last=card._detailStack.at(-1).id;card._openDetail('charger_schedule',encodeChargerScheduleId('ac:opaque/one','new'));
  assert.equal(card._detailStack.at(-1).id,last);assert.equal(card.confirmed,1);
  card._detailDirty=false;
  const rawId=encodeChargerScheduleId('opaque','new');card._config.devices=[{id:rawId,type:'ac'}];
  card._openDetail('charger_schedule',rawId);assert.equal(card._detailStack.at(-1).id,rawId);
});

test('charging record date filters remain device scoped and request no provider data',()=>{
  const card=new NavigationCard(),listeners={},input={dataset:{chargerRecordFilter:'from',chargerRecordDevice:'ac:opaque/one'},value:'2026-10-01',addEventListener:(type,handler)=>{listeners[type]=handler;}};
  let focused=0,opened;card._chargerRecordFilters={'dc-two':{to:'2026-10-26'}};
  card._detailStack=[{route:'charger_records',id:'ac:opaque/one'}];card._detailDialog={querySelectorAll:()=>[input],querySelector:()=>({focus(){focused++;}})};card._openDetail=(...args)=>{opened=args;};
  card._bindChargerRecordFilters();listeners.change();
  assert.deepEqual(card._detailContext().chargerRecordFilters,{'dc-two':{to:'2026-10-26'},'ac:opaque/one':{from:'2026-10-01'}});
  assert.deepEqual(opened,['charger_records','ac:opaque/one',true]);assert.equal(focused,1);assert.ok(!card._detailDirty);
});


test('dashboard installation preserves normal views and custom-shell siblings without mutating input',()=>{
 const card={type:'custom:sigen-hybrid-card',config_entry:'entry',view:'overview'},original={title:'House',views:[{title:'Home',path:'home',type:'panel',cards:[{type:'custom:taba7-dashboard-shell',pages:[{name:'Home',kind:'home'},{name:'Solar',kind:'solar',items:[{entity:'sensor.original'}]}]}]},{title:'Meters',path:'meters',type:'sections',sections:[{type:'grid',cards:[{type:'entity',entity:'sensor.keep'}]}]}]};
 const before=JSON.stringify(original),targets=dashboardEmbedTargets(original);
 assert.equal(targets.filter(t=>t.kind==='shell').length,2);
 const shell=embedDashboardCard(original,targets.find(t=>t.kind==='shell'&&t.page===1).key,card);
 assert.equal(shell.config.views[0].cards[0].pages[1].card.embed_mode,'shell');
 assert.deepEqual(shell.config.views[0].cards[0].pages[1].items,original.views[0].cards[0].pages[1].items);
 assert.deepEqual(shell.config.views[1],original.views[1]);assert.equal(JSON.stringify(original),before);
 const native=embedDashboardCard(original,'new',card,'Solar');assert.equal(native.config.views.length,3);assert.equal(native.path,'solar');
 const again=embedDashboardCard(native.config,'new',card,'Solar');assert.equal(again.path,'solar-2');
 const sections=embedDashboardCard(original,'view:1',card);assert.equal(sections.config.views[1].sections.length,2);assert.deepEqual(sections.config.views[1].sections[0],original.views[1].sections[0]);
 const panel=embedDashboardCard(original,'view:0',card);assert.equal(panel.config.views[0].cards[0].type,'vertical-stack');assert.deepEqual(panel.config.views[0].cards[0].cards[0],original.views[0].cards[0]);
 assert.throws(()=>embedDashboardCard(original,'view:99',card));assert.throws(()=>embedDashboardCard({...original,strategy:{}},'new',card));assert.throws(()=>embedDashboardCard(original,'new',{type:'button'}));
});

test('shared plans synchronize across clients, preserve sibling edits and reject stale target saves',async()=>{
 const {card}=settingsHarness('strategy');card._sharedTestStore.value={version:1,settings:{strategy:{other:{name:'Keep'}}}};
 await card._saveSharedSetting('strategy','one',{name:'First'});
 assert.equal(card._sharedTestStore.value.settings.strategy.other.name,'Keep');
 const second=new NavigationCard(fixture({}, {}, {config_entry:'test-entry'}));second._hass.callWS=card._hass.callWS;
 await second._loadSharedSettings();assert.equal(second._detailContext().interfaceOptions.strategy.one.name,'First');
 card._sharedTestStore.value.settings.strategy.one={name:'Changed elsewhere'};
 await assert.rejects(card._saveSharedSetting('strategy','one',{name:'Stale'}),/another device/);
 assert.equal(card._sharedTestStore.value.settings.strategy.one.name,'Changed elsewhere');
 assert.deepEqual(mergeInterfacePreferences({display_settings:{appearance:'day'}},{display_settings:{appearance:'night'},strategy:{a:{name:'Shared'}}}),{display_settings:{appearance:'day'},strategy:{a:{name:'Shared'}}});
});

test('HA account preferences preserve language and unrelated native preferences',async()=>{
 const card=new NavigationCard(),requests=[];card._hass.callWS=async request=>{requests.push(request);return {value:{language:'de',unrelated:true,time_format:'12'}};};
 await card._saveAccountPreferences({time_format:'24',date_format:'DMY',number_format:'decimal_comma',first_weekday:'monday'});
 assert.equal(requests[1].type,'frontend/set_user_data');assert.equal(requests[1].key,'language');
 assert.deepEqual(requests[1].value,{language:'de',unrelated:true,time_format:'24',date_format:'DMY',number_format:'decimal_comma',first_weekday:'monday'});
});

test('cancelled connection flow cannot reopen a dialog after a pending response',async()=>{
 const card=new NavigationCard(fixture({}, {}, {config_entry:'entry'})),calls=[];let resolve,opened=0;
 card._openDetail=()=>opened++;card._hass.callApi=async(method,path)=>{calls.push({method,path});return method==='POST'?await new Promise(done=>{resolve=done;}):null;};
 const pending=card._startOptionsFlow();assert.equal(opened,1);card._cancelOptionsFlow();resolve({type:'form',flow_id:'late'});await pending;
 assert.equal(opened,1);assert.equal(calls.at(-1).method,'DELETE');assert.deepEqual(card._optionsFlowData,{});
 card._optionsFlow={type:'form',flow_id:'next'};const submit=card._submitOptionsFlow({password:'ephemeral'});card._cancelOptionsFlow();resolve({type:'form',flow_id:'next'});await submit;
 assert.equal(opened,1);assert.equal(card._optionsFlow,null);assert.deepEqual(card._optionsFlowData,{});
});

test('Settings has six canonical categories and preview controls are opt-in',()=>{
 const card=new NavigationCard();card._view='overview';card._tab='overview';
 const settings=card._detailModel('settings').body;
 assert.deepEqual([...settings.matchAll(/class="settings-home-tile" data-detail="([^"]+)"/g)].map(m=>m[1]),['energy_profile','connection_settings','display_settings','system_settings','service','about']);
 assert.doesNotMatch(card._content(),/overview-preview-toolbar/);card._config.show_preview_controls=true;assert.match(card._content(),/overview-preview-toolbar/);
 const charts=card._chartsPage();assert.equal((charts.match(/data-charts-date/g)??[]).length,1);assert.equal((charts.match(/data-charts-period/g)??[]).length,1);
});


test('delegation recognizes actual connection controls rather than ignoring their clicks',()=>{
 const card=new NavigationCard();let opened=0,submitted;
 card._startOptionsFlow=()=>opened++;card._submitOptionsFlow=data=>{submitted=data;};
 for(const attribute of ['data-configure-connections','data-options-menu','data-options-submit']){
  const node={dataset:{optionsMenu:'modbus'},matches:selector=>selector.includes('['+attribute+']'),hasAttribute:key=>key===attribute};
  card._optionsFlowData={host:'192.0.2.1'};card._navigationClick(clickEvent(node));
  if(attribute==='data-configure-connections')assert.equal(opened,1);
  if(attribute==='data-options-menu')assert.deepEqual(submitted,{next_step_id:'modbus'});
  if(attribute==='data-options-submit')assert.deepEqual(submitted,{host:'192.0.2.1'});
 }
});


test('card presets reuse the selected plant while individual charts remain independent',()=>{
 const original={config_entry:'own-entry',entities:{solar_power:'sensor.actual'},devices:[{id:'charger-one',type:'ac'}],view:'overview',snapshot_at:'old',embedded:true,embed_mode:'shell'},before=JSON.stringify(original);
 for(const [key] of CARD_PRESETS){const card=presetCardConfiguration(original,key);assert.equal(card.config_entry,'own-entry');assert.deepEqual(card.entities,original.entities);assert.equal(card.view,key);assert.ok(!card.snapshot_at);assert.ok(!card.embedded);assert.ok(!card.embed_mode);if(key!=='overview')assert.equal(card.card_layout,'compact');}
 for(const [kind] of CARD_CHART_CHOICES){const card=presetCardConfiguration(original,'chart:'+kind);assert.equal(card.view,'chart');assert.equal(card.chart_kind,kind);}
 assert.equal(JSON.stringify(original),before);assert.throws(()=>presetCardConfiguration(original,'chart:unknown'));assert.throws(()=>presetCardConfiguration(original,'missing'));
});


test('standalone chart telemetry does not detach its chart tree',()=>{
 const card=new NavigationCard(fixture({}, {}, {config_entry:'own-entry'}));card._view='chart';card._chartPageConfig=card._config;
 const chart={dataset:{chart:'solar'},data:{period:'month',date:'2026-09-01'}};
 card.shadowRoot={querySelector:selector=>selector==='sigen-history-chart'?chart:null,querySelectorAll:()=>[chart]};
 let updated=0;card._upgradeCharts=()=>updated++;card._render();card._render();
 assert.equal(updated,2);assert.equal(card._navigationBound,undefined);assert.equal(card._chartInstances.get('solar:'),chart);
});


test('a theme change bypasses the chart refresh fast path so the new palette can render',()=>{
 const card=new NavigationCard(fixture({}, {}, {config_entry:'theme'}));card._view='chart';card._chartPageConfig=card._config;card._renderedUiNight=false;card._uiNight=()=>true;
 const chart={dataset:{chart:'solar'},data:{period:'day',date:'2026-10-29'}};
 card.shadowRoot={querySelector:selector=>selector==='sigen-history-chart'?chart:null,querySelectorAll:()=>[],addEventListener(){}};
 card._upgradeCharts=()=>{};card._render();assert.equal(card._navigationBound,true);assert.equal(card._renderedUiNight,true);
});
