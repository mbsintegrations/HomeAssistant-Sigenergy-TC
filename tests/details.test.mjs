import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detailMeasurement, escapeDetailHTML, filterDetailAlerts, solarStringSeries, renderDeviceDetail, DETAIL_STYLE } from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-details.js';

test('every device and service detail route renders without graph components or placeholder slots', () => {
  const routes = ['solar','load','battery','battery_module','inverter','gateway','grid','ac','dc','optimizer','strings','devices','forecast','weather','battery_energy','plant','alerts','alert_history','alert_detail','system_about','software_update','warranty','warranty_download','care','sigen_care','diagnosis','diagnosis_detail','diagnosis_history','modbus_server','support_history','service','messages','message_detail'];
  const inventory = [{id:'inv',type:'inverter',name:'Provided inverter'},{id:'module',type:'battery_module',name:'Provided module'},{id:'gateway',type:'gateway'},{id:'ac',type:'ac'},{id:'dc',type:'dc'},{id:'pv',type:'string',entities:{solar_power:'sensor.pv'}}];
  const base = context({'sensor.pv':reading(2,'kW'),battery_soc:reading(72,'%'),battery_capacity:reading(36,'kWh'),battery_power:reading(-1,'kW'),solar_today:reading(12,'kWh')},{inventory,optimizers:[{id:'panel',power:'sensor.pv',name:'Panel 1'}]});
  for (const route of routes) {
    const id = ({inverter:'inv',battery_module:'module',gateway:'gateway',ac:'ac',dc:'dc',optimizer:'panel'})[route];
    const model = renderDeviceDetail(route,{...base,id});
    assert.ok(model && typeof model.body==='string',route);
    assert.ok(!/sigen-history-chart|detail-chart|data-chart=|data-upgrade-chart/.test(model.body),route);
    assert.ok(!Object.hasOwn(model,'chart') && !Object.hasOwn(model,'charts'),route);
  }
  assert.ok(!DETAIL_STYLE.includes('.detail-chart'));
  const inverter = renderDeviceDetail('inverter',{...base,id:'inv'}).body;
  assert.ok(inverter.includes('Real Time Info') && inverter.includes('Inverter settings') && inverter.includes('Maintenance'));
  const battery = renderDeviceDetail('battery',base).body;
  assert.ok(battery.includes('72 %') && battery.includes('Battery energy'));
});

const NOW = Date.parse('2026-10-27T01:00:00Z');
const reading = (value, unit, attributes = {}) => ({ state: String(value), attributes: { unit_of_measurement: unit, observed_at: new Date(NOW).toISOString(), ...attributes } });
function context(states = {}, extra = {}) {
  const entities = Object.fromEntries(Object.keys(states).filter(key => !key.includes('.')).map(key => [key, `sensor.${key}`]));
  const byId = { ...states, ...Object.fromEntries(Object.entries(entities).map(([key, id]) => [id, states[key]])) };
  return {
    entities, optimizers: [], inventory: [], history: {}, now: NOW, timezone: 'Europe/Dublin', config: {},
    state: key => byId[entities[key] ?? key] ?? null,
    value: (key, quantity = 'power') => detailMeasurement(byId[entities[key] ?? key], quantity),
    entity: key => entities[key] ?? (key.includes('.') ? key : ''), ...extra,
  };
}

test('detail measurements normalize only known units and reject missing or malformed readings', () => {
  assert.equal(detailMeasurement(reading(362, 'W')), .362);
  assert.equal(detailMeasurement(reading(2500, 'Wh'), 'energy'), 2.5);
  assert.equal(detailMeasurement(reading(230000, 'mV'), 'voltage'), 230);
  assert.equal(detailMeasurement(reading(1200, 'mA'), 'current'), 1.2);
  assert.equal(detailMeasurement(reading(75, '%'), 'soc'), 75);
  assert.equal(detailMeasurement(reading(50, 'Hz'), 'frequency'), 50);
  assert.equal(detailMeasurement(reading(30, '°C'), 'temperature'), 30);
  for (const value of ['unknown', 'unavailable', '', 'bad', 'Infinity']) assert.equal(detailMeasurement(reading(value, 'kW')), null);
  assert.equal(detailMeasurement({ state: true, attributes: { unit_of_measurement: 'kW' } }), null);
  assert.equal(detailMeasurement(reading(230, 'V')), null);
  assert.equal(detailMeasurement(reading(22, 'unverified'), 'temperature'), null);
});

test('detail SOC bounds reject impossible percentages without rejecting measured zero or full charge', () => {
  for (const invalid of [-1, -.01, 100.01, 101]) assert.equal(detailMeasurement(reading(invalid, '%'), 'soc'), null);
  assert.equal(detailMeasurement(reading(0, '%'), 'soc'), 0);
  assert.equal(detailMeasurement(reading(100, '%'), 'soc'), 100);
  const ctx = context({ battery_soc: reading(75, '%'), 'sensor.module_soc': reading(101, '%') }, { id: 'one', inventory: [{ id: 'one', type: 'battery_module', entities: { battery_soc: 'sensor.module_soc' } }] });
  const body = renderDeviceDetail('battery_module', ctx).body;
  assert.ok(!body.includes('<th scope="row">State of charge</th>')&&body.includes('No current module readings'));
  assert.ok(!body.includes('101 %') && !body.includes('75 %'));
});

test('negative daily and lifetime energy counters stay unknown instead of becoming positive production', () => {
  assert.equal(detailMeasurement(reading(-1, 'MWh'), 'energy'), null);
  assert.equal(detailMeasurement(reading(0, 'kWh'), 'energy'), 0);
  const keys = ['solar_today', 'home_today', 'solar_lifetime', 'home_lifetime', 'battery_charge_lifetime', 'battery_discharge_lifetime', 'grid_import_lifetime', 'grid_export_lifetime', 'ac_energy_lifetime', 'dc_energy_lifetime', 'dc_discharge_lifetime'];
  const ctx = context(Object.fromEntries(keys.map(key => [key, reading(-3, 'kWh')])));
  for (const route of ['solar', 'load', 'battery', 'battery_energy', 'grid', 'ac', 'dc']) {
    const body = renderDeviceDetail(route, ctx).body;
    assert.ok(!body.includes('3 kWh'), route);
    assert.ok(body.includes('<td>—</td>'), route);
  }
  const normalizedFallback = renderDeviceDetail('solar', context({}, { value: (_key, quantity) => quantity === 'energy' ? -3 : null })).body;
  assert.ok(normalizedFallback.includes('<th scope="row">Produced today</th><td>—</td>'));
  assert.ok(normalizedFallback.includes('<th scope="row">Total solar production</th><td>—</td>'));
  const invalidRated = renderDeviceDetail('battery_module', context({}, { id: 'one', inventory: [{ id: 'one', type: 'battery_module', rated_energy_kwh: -3 }] })).body;
  assert.ok(!invalidRated.includes('Total energy capacity')&&!invalidRated.includes('-3 kWh'));
});

test('battery-module details remain graph-free and never borrow aggregate readings', () => {
  const ctx = context({ battery_power: reading(3, 'kW'), battery_soc: reading(75, '%') }, { id: 'removed-module', inventory: [{ id: 'existing-module', type: 'battery_module' }] });
  const missing = renderDeviceDetail('battery_module', ctx).body;
  assert.ok(!missing.includes('data-chart="battery"'));
  assert.ok(!missing.includes('75 %'));
  const existing = renderDeviceDetail('battery_module', { ...ctx, id: 'existing-module' }).body;
  assert.ok(!existing.includes('sigen-history-chart'));
  assert.ok(!existing.includes('75 %'));
});

test('battery power uses a direction and magnitude while other engineering values retain their signs', () => {
  const ctx = context({ battery_power: reading(-2, 'kW'), battery_temperature: reading(-4.5, '°C'), grid_l1_voltage: reading(-230, 'V'), grid_l1_current: reading(-1.2, 'A'), grid_l1_power: reading(-.5, 'kW'), 'sensor.module_temp': reading(-6.5, '°C'), 'sensor.module_voltage': reading(-48, 'V'), 'sensor.module_current': reading(-2.5, 'A') }, { id: 'one', inventory: [{ id: 'one', type: 'battery_module', entities: { battery_temperature: 'sensor.module_temp', battery_voltage: 'sensor.module_voltage', battery_current: 'sensor.module_current' } }] });
  const battery = renderDeviceDetail('battery', ctx).body;
  assert.ok(battery.includes('-4.5 °C'));
  assert.ok(battery.includes('<th scope="row">Discharging power</th><td>2 kW</td>'));
  assert.ok(battery.includes('<small>Discharging power</small><strong>2 kW</strong>'));
  assert.equal(ctx.state('battery_power').state,'-2');
  assert.equal(detailMeasurement(ctx.state('battery_power')),-2);
  const module = renderDeviceDetail('battery_module', ctx).body;
  assert.ok(module.includes('-6.5 °C') && module.includes('-48 V') && module.includes('-2.5 A'));
  const gateway = renderDeviceDetail('gateway', {...ctx,id:undefined}).body;
  assert.ok(gateway.includes('-230 V') && gateway.includes('-1.2 A') && gateway.includes('-0.5 kW'));
});

test('inverter signs and individual module charge direction stay distinct without borrowing aggregate power', () => {
  const inventory = [{id:'inverter',type:'inverter',entities:{inverter_power:'sensor.inverter_power'}},{id:'one',type:'battery_module',entities:{battery_power:'sensor.module_power'}},{id:'two',type:'battery_module',entities:{battery_power:'sensor.module_second'}},{id:'unmapped',type:'battery_module'}];
  const ctx = context({battery_power:reading(9,'kW'),'sensor.inverter_power':reading(-5500,'W'),'sensor.module_power':reading(-.157,'kW'),'sensor.module_second':reading(.023,'kW')},{inventory});
  const inverter = renderDeviceDetail('inverter',{...ctx,id:'inverter'}).body;
  assert.ok(inverter.includes('<small>Output power</small><strong>-5.5 kW</strong>'));
  assert.ok(inverter.includes('<th scope="row">Output power</th><td>-5.5 kW</td>'));
  const first = renderDeviceDetail('battery_module',{...ctx,id:'one'}).body;
  assert.ok(first.includes('<small>Discharging power</small><strong>0.157 kW</strong>'));
  assert.ok(first.includes('<th scope="row">Discharging power</th><td>0.157 kW</td>'));
  const second = renderDeviceDetail('battery_module',{...ctx,id:'two'}).body;
  assert.ok(second.includes('<th scope="row">Standby power</th><td>0.023 kW</td>'));
  for(const id of ['one','two','unmapped','missing'])assert.ok(!renderDeviceDetail('battery_module',{...ctx,id}).body.includes('9 kW'));
  assert.ok(renderDeviceDetail('battery_module',{...ctx,id:'unmapped'}).body.includes('No current module readings'));
});

test('battery charging and discharging use positive display magnitudes without changing signed readings', () => {
  for(const [signed,label,status] of [[-4.588,'Discharging power','Discharging'],[1.2,'Charging power','Charging'],[0,'Standby power','Standby']]) {
    const state=Object.freeze(reading(signed*1000,'W')),before=JSON.stringify(state),ctx=context({battery_power:state});
    const body=renderDeviceDetail('battery',ctx).body;
    assert.ok(body.includes(`<small>${label}</small><strong>${Math.abs(signed)} kW</strong>`));
    assert.ok(body.includes(`<th scope="row">${label}</th><td>${Math.abs(signed)} kW</td>`));
    assert.ok(body.includes(`>${status}</span>`));
    assert.equal(detailMeasurement(state),signed);
    assert.equal(JSON.stringify(state),before);
    if(signed<0)assert.ok(!body.includes(`${signed} kW`));
  }
});

test('unconnected module readings have one truthful empty state and only known identity/specification rows', () => {
  const item={id:'pack-one',type:'battery_module',name:'Battery 1',model:'SigenStor BAT 10.0',serial:'TEST-PACK-ONE',rated_energy_kwh:9.04};
  const ctx=context({battery_soc:reading(75,'%'),battery_power:reading(-4.588,'kW'),battery_temperature:reading(22,'°C'),battery_capacity:reading(36.16,'kWh')},{id:'pack-one',inventory:[item]});
  const body=renderDeviceDetail('battery_module',ctx).body;
  assert.equal((body.match(/No current module readings/g)??[]).length,1);
  assert.ok(body.includes('SigenStor BAT 10.0')&&body.includes('TEST-PACK-ONE'));
  assert.ok(body.includes('<th scope="row">Total energy capacity</th><td>9.04 kWh</td>'));
  assert.ok(!body.includes('Real Time Info')&&!body.includes('class="detail-metrics"'));
  for(const missing of ['Manufacturer','Firmware version','Software version','Usable energy capacity','Rated energy'])assert.ok(!body.includes(`<th scope="row">${missing}</th>`),missing);
  assert.ok(!body.includes('<td>—</td>')&&!body.includes('36.16 kWh')&&!body.includes('75 %')&&!body.includes('4.588 kW'));
  for(const route of ['device_settings','network','maintenance'])assert.ok(body.includes(`data-detail="${route}" data-id="pack-one"`));
});

test('partial module telemetry retains valid zero/current unit values and omits only unavailable fields', () => {
  const item={id:'pack',type:'battery_module',model:'Provided model',entities:{battery_soc:'sensor.pack_soc',battery_power:'sensor.pack_power',battery_temperature:'sensor.pack_temperature'},parameters:{firmware:'Provided firmware',manufacturer:'unknown'}};
  const ctx=context({'sensor.pack_soc':reading(0,'%'),'sensor.pack_power':reading(-150,'W'),'sensor.pack_temperature':reading(-2,'°C')},{id:'pack',inventory:[item]});
  const body=renderDeviceDetail('battery_module',ctx).body;
  assert.ok(body.includes('Real Time Info')&&!body.includes('No current module readings'));
  assert.ok(body.includes('<small>State of charge</small><strong>0 %</strong>'));
  assert.ok(body.includes('<small>Discharging power</small><strong>0.15 kW</strong>'));
  assert.ok(body.includes('-2 °C')&&body.includes('Provided firmware'));
  assert.ok(!body.includes('<td>—</td>')&&!body.includes('<th scope="row">Manufacturer</th>')&&!body.includes('<th scope="row">Current</th>'));
  assert.equal(ctx.state('sensor.pack_power').state,'-150');
});

test('module total and usable energy capacities are separate supplied specifications, never model-name guesses', () => {
  const item={id:'pack',type:'battery_module',model:'SigenStor BAT 10.0',total_energy_kwh:9.04,usable_energy_kwh:8.76};
  const body=renderDeviceDetail('battery_module',context({}, {id:'pack',inventory:[item]})).body;
  assert.ok(body.includes('<th scope="row">Total energy capacity</th><td>9.04 kWh</td>'));
  assert.ok(body.includes('<th scope="row">Usable energy capacity</th><td>8.76 kWh</td>'));
  const noSpecification=renderDeviceDetail('battery_module',context({}, {id:'pack',inventory:[{id:'pack',type:'battery_module',model:'SigenStor BAT 10.0'}]})).body;
  assert.ok(!noSpecification.includes('9.04 kWh')&&!noSpecification.includes('8.76 kWh'));
  const neutral=renderDeviceDetail('battery_module',context({}, {id:'pack',inventory:[{id:'pack',type:'battery_module',capacity_kwh:9.04}]})).body;
  assert.ok(neutral.includes('<th scope="row">Energy capacity</th><td>9.04 kWh</td>'));
  assert.ok(!neutral.includes('Usable energy capacity'));
});

test('engineering reactive power, insulation resistance and power factor require compatible units',()=>{
  assert.equal(detailMeasurement(reading(-1500,'var'),'reactive_power'),-1.5);
  assert.equal(detailMeasurement(reading(510000,'Ω'),'resistance'),.51);
  assert.equal(detailMeasurement(reading(98,'%'),'power_factor'),.98);
  assert.equal(detailMeasurement(reading(-.9,''),'power_factor'),-.9);
  assert.equal(detailMeasurement(reading(-2,'℃'),'temperature'),-2);
  for(const [unit,quantity] of [['kW','reactive_power'],['V','resistance'],['W','power_factor']])assert.equal(detailMeasurement(reading(1,unit),quantity),null);
  assert.equal(detailMeasurement(reading(101,'%'),'power_factor'),null);
});

test('inverter sheet includes supplied timestamps, PV inputs and typed engineering rows without inferred values',()=>{
  const item={id:'inv',type:'inverter',status:'Online',parameters:{startup_time:'2026-01-02 03:04:05',rated_power_kw:6,output_mode:'Three phase',software_version:'Test software',firmware:'Test firmware'},realtime:{inverter_power:{value:-1500,unit:'W'},inverter_reactive_power:{value:-25,unit:'var'},inverter_power_factor:{value:98,unit:'%'},inverter_grid_frequency:{value:49.9,unit:'Hz'},solar_power:{value:700,unit:'W'},pv1_current:{value:1.1,unit:'A'},pv1_voltage:{value:320,unit:'V'},pv2_current:{value:.9,unit:'A'},pv2_voltage:{value:315,unit:'V'},inverter_insulation_resistance:{value:510000,unit:'Ω'}}};
  const body=renderDeviceDetail('inverter',context({}, {id:'inv',inventory:[item]})).body;
  for(const value of ['2026-01-02 03:04:05','-0.025 kVar','0.98','49.9 Hz','0.7 kW','1.1 A','320 V','0.9 A','315 V','0.51 MΩ','6 kW','Three phase','Test software','Test firmware'])assert.ok(body.includes(value),value);
  assert.ok(body.includes('<th scope="row">Inverter shutdown time</th><td>—</td>'));
  const unknown=renderDeviceDetail('inverter',context({}, {id:'missing',inventory:[item]})).body;
  assert.ok(!unknown.includes('Test firmware')&&!unknown.includes('-0.025 kVar'));
});

test('battery and DC sheets show their own pack/cell/current/software fields and never infer heating from generic status',()=>{
  const inventory=[{id:'module',type:'battery_module',status:'Normal',parameters:{software_version:'Module software'},realtime:{battery_pack_voltage:{value:55500,unit:'mV'},battery_cell_voltage_average:{value:3384,unit:'mV'},battery_cell_temperature_average:{value:-2,unit:'℃'},battery_discharge_lifetime:{value:9,unit:'kWh'}}},{id:'dc',type:'dc',parameters:{software_version:'DC software'},realtime:{dc_pack_voltage:{value:700,unit:'mV'},dc_charging_current:{value:0,unit:'A'},dc_discharge_output_current:{value:-2.1,unit:'A'},dc_power:{value:-1200,unit:'W'}}}];
  const ctx=context({battery_cell_voltage_average:reading(999,'V'),dc_pack_voltage:reading(999,'V')},{inventory});
  const module=renderDeviceDetail('battery_module',{...ctx,id:'module'}).body;
  for(const value of ['55.5 V','3.384 V','-2 °C','9 kWh','Module software'])assert.ok(module.includes(value));
  assert.ok(!module.includes('<th scope="row">Battery heating</th>'));
  const dc=renderDeviceDetail('dc',{...ctx,id:'dc'}).body;
  assert.ok(dc.includes('0.7 V')&&dc.includes('-2.1 A')&&dc.includes('-1.2 kW')&&dc.includes('DC software'));
  assert.ok(dc.includes('<th scope="row">Charging current</th><td>0 A</td>'));
  assert.ok(!dc.includes('999 V')&&!module.includes('999 V'));
});

test('every device route renders safely without inventing equipment values', () => {
  const ctx = context();
  for (const route of ['solar', 'load', 'battery', 'battery_module', 'inverter', 'gateway', 'grid', 'ac', 'dc', 'optimizer', 'strings', 'devices', 'forecast', 'weather', 'battery_energy', 'plant', 'alerts']) {
    const view = renderDeviceDetail(route, ctx);
    assert.equal(typeof view.title, 'string', route);
    assert.equal(typeof view.body, 'string', route);
    assert.ok(!/NaN|Infinity|undefined|null|9\.04|BAT 10|22 panels|75%/.test(view.body), route);
    assert.ok(!view.body.includes('data-entity=""'), route);
  }
  for (const route of ['constructor', '__proto__', 'toString', 'unsupported']) assert.ok(renderDeviceDetail(route, ctx).body.includes('Details unavailable'));
});

test('mapped text, inventory identifiers and attributes cannot inject HTML or active image URLs', () => {
  const bad = '<img src=x onerror="alert(1)">';
  assert.equal(escapeDetailHTML(bad), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  const ctx = context({}, { inventory: [{ id: '\" onclick=\"bad', type: 'battery', name: bad, model: '<script>bad</script>', serial: "s'<>\"", image: 'javascript:alert(1)' }] });
  const body = renderDeviceDetail('battery', ctx).body;
  assert.ok(body.includes('&lt;img'));
  assert.ok(body.includes('&quot; onclick=&quot;bad'));
  assert.ok(!body.includes('<script>'));
  assert.ok(!body.includes('<img src=x'));
  assert.ok(!body.includes('src="javascript:'));
  assert.ok(!body.includes(' onclick="'));
  const alertBody = renderDeviceDetail('alerts', context({}, { config: { alerts: [{ title: bad, message: bad, entity_id: 'sensor.x" onclick="bad' }] } })).body;
  assert.ok(!alertBody.includes('data-entity='));
});

test('SigenStor stack contains only supplied inverter, battery and DC hardware', () => {
  const ctx = context({ battery_soc: reading(72, '%'), battery_power: reading(1.4, 'kW'), battery_capacity: reading(36.16, 'kWh') }, { inventory: [
    { id: 'inv-1', type: 'inverter', model: 'Verified inverter' },
    { id: 'bat-1', type: 'battery_module', model: 'Verified battery', rated_energy_kwh: 9.04 },
    { id: 'bat-2', type: 'battery', model: 'Verified battery' },
    { id: 'dc-1', type: 'dccharger', model: 'Verified DC charger' },
    { id: 'ac-1', type: 'accharger' },
  ] });
  const body = renderDeviceDetail('battery', ctx).body;
  assert.ok(body.includes('data-detail="inverter" data-id="inv-1"'));
  assert.equal((body.match(/data-detail="battery_module"/g) ?? []).length, 2);
  assert.ok(body.includes('data-detail="dc" data-id="dc-1"'));
  assert.ok(!body.includes('data-detail="ac"'));
  assert.ok(body.includes('72 %') && body.includes('36.16 kWh'));
  assert.ok(!body.includes('sigen-history-chart'));
  const empty = renderDeviceDetail('battery', context()).body;
  assert.ok(!empty.includes('data-detail="battery_module"'));
  assert.ok(!empty.includes('data-detail="inverter"'));
});

test('Devices popup keeps Solar alongside an inverter without requiring optimizer mappings',()=>{
  const inventory=[{id:'inverter',type:'inverter',name:'Controller'}],ctx=context({solar_power:reading(1,'kW')},{inventory,optimizers:[]});
  const body=renderDeviceDetail('devices',ctx).body;
  assert.ok(body.includes('data-detail="solar"')&&body.includes('data-detail="inverter" data-id="inverter"'));
  assert.equal((body.match(/data-detail="solar"/g)??[]).length,1);
  assert.ok(renderDeviceDetail('devices',context({}, {inventory,entities:{solar_power:'sensor.temporarily_missing_pv'}})).body.includes('data-detail="solar"'));
  assert.ok(renderDeviceDetail('devices',context({}, {inventory:[...inventory,{id:'array',type:'PV array'}]})).body.includes('data-detail="solar"'));
  assert.ok(!renderDeviceDetail('devices',context({}, {inventory})).body.includes('data-detail="solar"'));
});

test('combined PV string sources use unique explicit string power entities and never aggregate or V times A',()=>{
  const inventory=[{id:'one',type:'string',name:'PV One',entities:{solar_power:'sensor.pv_one'}},{serial:'two',type:'PV string',name:'PV Two',entities:{power:'sensor.pv_two'}},{id:'duplicate',type:'string',entities:{solar_power:'sensor.pv_one'}},{id:'aggregate',type:'string',entities:{solar_power:'sensor.plant_pv'}},{id:'invalid',type:'string',entities:{solar_power:'switch.not_a_sensor'}},{id:'electrical-only',type:'string',entities:{voltage:'sensor.string_voltage',current:'sensor.string_current'}}];
  const ctx=context({}, {inventory,entities:{solar_power:'sensor.plant_pv'}});
  assert.deepEqual(solarStringSeries(ctx),[{id:'one',name:'PV One',entity_id:'sensor.pv_one'},{id:'two',name:'PV Two',entity_id:'sensor.pv_two'}]);
  assert.deepEqual(solarStringSeries(context({}, {inventory:[inventory[5]]})),[]);
  const body=renderDeviceDetail('solar',ctx).body;
  assert.ok(!body.includes('sigen-history-chart'));
  for(const subset of [[],[inventory[0]],[inventory[0],inventory[2]]]){
    const single=renderDeviceDetail('solar',context({}, {inventory:subset})).body;
    assert.ok(!single.includes('sigen-history-chart'));
  }
});

test('battery modules do not borrow aggregate SOC, capacity or unprovided module specifications', () => {
  const ctx = context({ battery_soc: reading(72, '%'), battery_capacity: reading(36.16, 'kWh') }, { id: 'bat-1', inventory: [{ id: 'bat-1', type: 'battery', model: 'Verified model', rated_energy_kwh: 9.04 }] });
  const view = renderDeviceDetail('battery_module', ctx);
  assert.ok(view.body.includes('9.04 kWh'));
  assert.ok(!view.body.includes('72 %'));
  assert.ok(!view.body.includes('36.16 kWh'));
  assert.ok(view.body.includes('No current module readings')&&!view.body.includes('>—</td>'));
  const mapped = context({ 'sensor.module_soc': reading(60, '%'), 'sensor.module_temp': reading(24, '°C') }, { id: 'bat-2', inventory: [{ id: 'bat-2', type: 'battery', entities: { battery_soc: 'sensor.module_soc', battery_temperature: 'sensor.module_temp' } }] });
  const body = renderDeviceDetail('battery_module', mapped).body;
  assert.ok(body.includes('60 %') && body.includes('24 °C'));
  assert.ok(!body.includes('9.04 kWh'));
});

test('gateway phase sections include only available sides and phases with normalized units', () => {
  const ctx = context({ grid_l1_voltage: reading(230, 'V'), grid_l1_current: reading(1200, 'mA'), grid_l1_power: reading(-500, 'W') });
  const body = renderDeviceDetail('gateway', ctx).body;
  assert.ok(body.includes('Grid side'));
  assert.ok(body.includes('230 V') && body.includes('1.2 A') && body.includes('-0.5 kW'));
  assert.ok(!body.includes('Backup side') && !body.includes('Load side'));
  assert.ok(!body.includes('>L2</th>'));
  const empty=renderDeviceDetail('gateway',context()).body;
  assert.ok(empty.includes('Grid side info')&&empty.includes('Generator side info')&&empty.includes('Inverter side info'));
  assert.ok(!empty.includes('>L1</th>'));
  assert.ok(empty.includes('<th scope="row">Voltage frequency</th><td>—</td>'));
});

test('Gateway phase reactive power is optional, signed and scoped to its own engineering reading', () => {
  const inventory=[{id:'gateway',type:'gateway',entities:{grid_l1_power:'sensor.gateway_p',grid_l1_reactive_power:'sensor.gateway_q'}}];
  const ctx=context({'sensor.gateway_p':reading(-100,'W'),'sensor.gateway_q':reading(-350,'var'),grid_l1_voltage:reading(999,'V'),grid_l1_current:reading(999,'A'),inverter_l1_reactive_power:reading(888,'kVar')},{id:'gateway',inventory});
  const body=renderDeviceDetail('gateway',ctx).body;
  assert.ok(body.includes('<th>Reactive power</th>'));
  assert.ok(body.includes('<th scope="row">L1</th><td>—</td><td>—</td><td>-0.1 kW</td><td>-0.35 kVar</td>'));
  assert.ok(!body.includes('999 V')&&!body.includes('999 A')&&!body.includes('888 kVar'));
  const absent=renderDeviceDetail('gateway',context({'sensor.gateway_p':reading(0,'W')},{id:'gateway',inventory})).body;
  assert.ok(!absent.includes('<th>Reactive power</th>'));
  const alias=renderDeviceDetail('gateway',context({}, {id:'gateway',inventory:[{id:'gateway',type:'gateway',realtime:{grid_reactive_power_l1:{value:-.2,unit:'kVar'}}}]})).body;
  assert.ok(alias.includes('<th>Reactive power</th>')&&alias.includes('-0.2 kVar'));
});

test('explicit gateway realtime phases do not fall through to aggregate phase readings',()=>{
  const ctx=context({grid_l1_voltage:reading(999,'V')},{id:'gateway',inventory:[{id:'gateway',type:'gateway',realtime:{grid_l1_voltage:{value:230.5,unit:'V'},grid_l1_current:{value:-1.2,unit:'A'}}}]});
  const body=renderDeviceDetail('gateway',ctx).body;
  assert.ok(body.includes('230.5 V')&&body.includes('-1.2 A'));
  assert.ok(!body.includes('999 V')&&!body.includes('Backup side'));
});

test('Gateway side sections use scoped engineering values and preserve existing backup/load readings',()=>{
  const item={id:'gateway',type:'gateway',parameters:{model:'Test gateway',software_version:'Test software',communication_status:'Online',mac_address:'00-00-00-00-00-01',grid_contactor_status:'Close',generator_contactor_status:'Open'},realtime:{grid_l1_voltage:{value:230.5,unit:'V'},grid_l1_current:{value:-1.2,unit:'A'},grid_frequency:{value:49.9,unit:'Hz'},grid_total_active_power:{value:-10,unit:'W'},grid_total_reactive_power:{value:-.3,unit:'kVar'},grid_l1_voltage_max_last_minute:{value:241.1,unit:'V'},grid_l1_voltage_min_last_minute:{value:238.3,unit:'V'},generator_l1_voltage:{value:0,unit:'V'},generator_l1_current:{value:0,unit:'A'},generator_frequency:{value:0,unit:'Hz'},generator_active_power:{value:0,unit:'kW'},generator_reactive_power:{value:0,unit:'kvar'},inverter_l1_voltage:{value:236.2,unit:'V'},inverter_frequency:{value:49.8,unit:'Hz'},backup_l1_voltage:{value:231.1,unit:'V'},load_l1_voltage:{value:232.2,unit:'V'}}};
  const body=renderDeviceDetail('gateway',context({grid_l1_voltage:reading(999,'V'),generator_frequency:reading(999,'Hz'),inverter_l1_voltage:reading(999,'V')},{id:'gateway',inventory:[item]})).body;
  for(const expected of ['Grid side info','Generator side info','Inverter side info','230.5 V','49.9 Hz','-0.01 kW','-0.3 kVar','241.1 V','238.3 V','Close','Open','236.2 V','49.8 Hz','Backup side','231.1 V','Load side','232.2 V','Test software','Online','00-00-00-00-00-01'])assert.ok(body.includes(expected),expected);
  assert.ok(body.includes('<th scope="row">Voltage frequency</th><td>0 Hz</td>'));
  assert.ok(!body.includes('999 V')&&!body.includes('999 Hz'));
  assert.ok(body.includes('disabled aria-disabled="true">Go Off-Grid</button>'));
});

test('unmapped Gateway generator/inverter sides stay unknown and never borrow plant aggregates',()=>{
  const body=renderDeviceDetail('gateway',context({grid_l1_voltage:reading(230,'V'),generator_power:reading(77,'kW'),generator_l1_voltage:reading(888,'V'),inverter_l1_voltage:reading(999,'V'),inverter_frequency:reading(66,'Hz')})).body;
  assert.ok(body.includes('230 V')&&body.includes('Generator side info')&&body.includes('Inverter side info'));
  for(const unexpected of ['77 kW','888 V','999 V','66 Hz'])assert.ok(!body.includes(unexpected));
  assert.ok(body.includes('<th scope="row">Maximum Phase A voltage in the past minute</th><td>—</td>'));
  assert.ok(body.includes('<th scope="row">Generator side contactor status</th><td>—</td>'));
  const stale=renderDeviceDetail('gateway',context({grid_l1_voltage:reading(999,'V')},{id:'removed',inventory:[{id:'gateway',type:'gateway'}]})).body;
  assert.ok(!stale.includes('999 V'));
});

test('charger pages link to host-owned modes, records, schedules, vehicles and settings', () => {
  const ctx = context({ ac_power: reading(7400, 'W'), ac_state: reading('Charging', ''), ac_session_energy: reading(4.6, 'kWh') }, { inventory: [{ id: 'ac-1', type: 'EVAC', model: 'Verified EVAC' }] });
  const body = renderDeviceDetail('ac', ctx).body;
  assert.ok(body.includes('7.4 kW') && body.includes('4.6 kWh'));
  for (const route of ['charging_mode', 'charger_records', 'charger_schedules', 'vehicles', 'device_settings']) assert.ok(body.includes(`data-detail="${route}" data-id="ac-1"`), route);
  assert.ok(!body.includes('sigen-history-chart'));
  assert.ok(!body.includes('data-detail="start"'));
});

test('charger More links retain opaque AC/DC identities without inventing a target for a removed device',()=>{
  const inventory=[{serial_number:'opaque:ac%one',type:'ac'},{id:'opaque:dc%two',type:'dc'}];
  for(const [type,id] of [['ac','opaque:ac%one'],['dc','opaque:dc%two']]){
    const body=renderDeviceDetail(type,context({}, {id,inventory})).body;
    assert.ok(body.includes(`data-detail="${type}_more" data-id="${id}"`));
    assert.ok(body.includes(`data-detail="charger_schedules" data-id="${id}"`));
    assert.ok(!body.includes('data-detail="charger_schedule"'));
    assert.ok(!body.includes(`data-detail="${type==='ac'?'dc':'ac'}_more"`));
    assert.ok(!renderDeviceDetail(type,context({}, {id:'removed',inventory})).body.includes(`data-detail="${type}_more"`));
  }
});

test('strings and optimizer drilldown use supplied module mappings, including owner-retained simulated devices', () => {
  const optimizers = Array.from({ length: 22 }, (_, index) => ({ id: `module-${index + 1}`, name: `Panel ${index + 1}`, string: index < 11 ? 'String 1' : 'String 2', power: `sensor.panel_${index + 1}`, ...(index === 0 ? { voltage: 'sensor.panel_voltage', current: 'sensor.panel_current', energy: 'sensor.panel_energy', model: 'Verified optimizer' } : {}) }));
  const states = Object.fromEntries(optimizers.map(item => [item.power, reading(362, 'W', { sample_data: true, observed_at: '2026-10-26T00:00:00Z' })]));
  states['sensor.panel_voltage'] = reading(37.2, 'V'); states['sensor.panel_current'] = reading(9.7, 'A'); states['sensor.panel_energy'] = reading(1540, 'Wh');
  const ctx = context(states, { optimizers });
  const body = renderDeviceDetail('strings', ctx).body;
  assert.equal((body.match(/class="detail-module"/g) ?? []).length, 22);
  assert.ok(body.includes('String 1') && body.includes('String 2'));
  assert.ok(body.includes('362 W'));
  assert.ok(!/Sample|simulated|sample_data/.test(body));
  const detail = renderDeviceDetail('optimizer', { ...ctx, id: 'module-1' }).body;
  assert.ok(detail.includes('37.2 V') && detail.includes('9.7 A') && detail.includes('1.54 kWh'));
  assert.ok(detail.includes('Verified optimizer'));
  assert.ok(!detail.includes('sigen-history-chart'));
  assert.ok(detail.includes('data-entity="sensor.panel_1"'));
});

test('real optimizer data retains freshness checks and never borrows unmapped measurements', () => {
  const optimizer = { id: 'one', power: 'sensor.old' };
  const ctx = context({ 'sensor.old': reading(400, 'W', { observed_at: '2026-10-26T00:00:00Z' }), energy: reading(9999, 'kWh') }, { optimizers: [optimizer], id: 'one' });
  const body = renderDeviceDetail('optimizer', ctx).body;
  assert.ok(!body.includes('400 W'));
  assert.ok(!body.includes('9,999'));
  assert.ok(body.includes('>—</td>'));
});

test('forecast, weather, plant and alerts show provided data and meaningful host navigation', () => {
  const ctx = context({ forecast_status: reading('forecast_solar', ''), forecast_today: reading(8.8, 'kWh'), forecast_tomorrow: reading(10.2, 'kWh'), solar_today: reading(2.6, 'kWh'), 'weather.house': { state: 'partlycloudy', attributes: { temperature: 13, temperature_unit: '°C', humidity: 65, wind_speed: 8, wind_speed_unit: 'km/h' } } }, { config: { title: 'My test plant', weather_entity: 'weather.house', plant: { commissioned_at: '2026-01-01' }, alerts: [{ severity: 'warning', title: 'Provided alert', message: 'Provided message' }] } });
  const forecast = renderDeviceDetail('forecast', ctx);
  assert.equal(forecast.subtitle, 'Forecast.Solar');
  assert.ok(forecast.body.includes('8.8 kWh') && forecast.body.includes('10.2 kWh') && forecast.body.includes('2.6 kWh'));
  assert.ok(!forecast.body.includes('sigen-history-chart'));
  assert.ok(forecast.body.includes('data-detail="forecast_settings"'));
  assert.ok(!forecast.body.includes('data-detail="device_settings"'));
  assert.ok(!forecast.body.includes('data-id="forecast"'));
  const weather = renderDeviceDetail('weather', ctx).body;
  assert.ok(weather.includes('13 °C') && weather.includes('65 %') && weather.includes('8 km/h'));
  assert.ok(weather.includes('data-entity="weather.house"'));
  const plant = renderDeviceDetail('plant', ctx);
  assert.equal(plant.title, 'My test plant');
  assert.ok(plant.body.includes('Europe/Dublin') && plant.body.includes('2026-01-01'));
  assert.ok(renderDeviceDetail('alerts', ctx).body.includes('Provided alert'));
  assert.ok(!renderDeviceDetail('alerts', context()).body.includes('No alerts'));
});

test('weather hero exposes stable refresh fields while escaping conditions and preserving unknown temperatures', () => {
  const ctx = context({ 'weather.house': { state: 'clear-night', attributes: { temperature: -3.5, temperature_unit: '°C' } } }, { config: { weather_entity: 'weather.house' } });
  const body = renderDeviceDetail('weather', ctx).body;
  assert.ok(body.includes('data-weather-field="symbol" aria-hidden="true">☾</div>'));
  assert.ok(body.includes('<h3 data-weather-field="condition">clear-night</h3>'));
  assert.ok(body.includes('<strong data-weather-field="temperature">-3.5 °C</strong>'));
  const invalid = renderDeviceDetail('weather', context({ 'weather.house': { state: '<img src=x onerror=alert(1)>', attributes: { temperature: 99, temperature_unit: 'unverified' } } }, { config: { weather_entity: 'weather.house' } })).body;
  assert.ok(invalid.includes('data-weather-field="condition">&lt;img src=x onerror=alert(1)&gt;</h3>'));
  assert.ok(invalid.includes('data-weather-field="temperature">—</strong>'));
  assert.ok(invalid.includes('data-weather-field="symbol" aria-hidden="true">—</div>'));
  assert.ok(!invalid.includes('<img src=x'));
});

test('missing and invalid entity mappings never produce dead more-info buttons', () => {
  const ctx = context({}, { entities: { solar_power: 'sensor.missing', battery_soc: 'sensor.bad" onclick="x' }, entity: key => ({ solar_power: 'sensor.missing', battery_soc: 'sensor.bad" onclick="x' })[key] });
  for (const route of ['solar', 'battery', 'devices', 'weather']) assert.ok(!renderDeviceDetail(route, ctx).body.includes('data-entity='), route);
});

test('detail module has no requests, device writes or hidden execution paths', async () => {
  const source = await readFile(new URL('../custom_components/sigen_hybrid/frontend/sigen-hybrid-details.js', import.meta.url), 'utf8');
  assert.ok(!/\bfetch\s*\(|callWS\s*\(|callService\s*\(|XMLHttpRequest|WebSocket\s*\(|dry_run\s*:\s*false/.test(source));
  assert.ok(DETAIL_STYLE.includes('.detail-module-grid'));
  assert.ok(DETAIL_STYLE.includes('@container'));
});

test('Solar Basic Info reaches the connected inverter and every PV metadata editor', () => {
  const ctx = context({}, { inventory: [{ id: 'pv', type: 'solar', capacity_wp: 10340 }, { id: 'inv', type: 'inverter', model: 'Verified inverter' }] });
  const body = renderDeviceDetail('solar', ctx).body;
  assert.ok(body.includes('Basic Info'));
  assert.ok(body.includes('data-detail="inverter" data-id="inv"'));
  assert.ok(body.includes('Connected inverter · Verified inverter'));
  for (const route of ['pv_capacity', 'pv_brand', 'pv_model', 'string_names']) assert.ok(body.includes(`data-detail="${route}"`), route);
  assert.ok(body.includes('10.34 kWp'));
  assert.ok(renderDeviceDetail('plant', ctx).body.includes('10.34 kWp'));
  assert.ok(!renderDeviceDetail('solar', context()).body.includes('Connected inverter'));
});

test('installed PV capacity accepts explicit Wp or kWp metadata and never inverter ratings or unknown units', () => {
  assert.ok(renderDeviceDetail('solar', context({}, { inventory: [{ type: 'solar', capacity_kwp: '8.8' }] })).body.includes('8.8 kWp'));
  assert.ok(renderDeviceDetail('solar', context({ solar_capacity: reading(9, 'kWp') }, { inventory: [{ type: 'solar', capacity_wp: 10340 }] })).body.includes('9 kWp'));
  for (const item of [{ type: 'inverter', capacity_wp: 10340 }, { type: 'solar', capacity: 10340 }, { type: 'solar', capacity_wp: true }, { type: 'solar', capacity_kwp: -10 }, { type: 'solar', capacity_wp: 'bad' }]) {
    assert.ok(!renderDeviceDetail('solar', context({}, { inventory: [item] })).body.includes('10.34 kWp'));
    assert.ok(!renderDeviceDetail('solar', context({}, { inventory: [item] })).body.includes('true kWp'));
  }
  assert.ok(!renderDeviceDetail('solar', context({ solar_capacity: reading(10340, 'unverified') })).body.includes('10.34 kWp'));
});

test('each PV string keeps its own measured V, A and energy without embedded history graphs', () => {
  const ctx = context({ solar_power: reading(9, 'kW'), 'sensor.pv1': reading(2, 'kW'), 'sensor.pv1v': reading(410, 'V'), 'sensor.pv1a': reading(4.88, 'A'), 'sensor.pv1today': reading(1.2, 'kWh'), 'sensor.pv1total': reading(.05, 'MWh'), 'sensor.pv2': reading(3, 'kW') }, { inventory: [
    { id: 'pv1', type: 'string', name: 'PV1', entities: { solar_power: 'sensor.pv1', voltage: 'sensor.pv1v', current: 'sensor.pv1a', energy_today: 'sensor.pv1today', energy_lifetime: 'sensor.pv1total' } },
    { id: 'pv2', type: 'string', name: 'PV2', entities: { solar_power: 'sensor.pv2' } },
    { id: 'missing', type: 'string', name: 'No measurements' },
  ] });
  const body = renderDeviceDetail('strings', ctx).body;
  assert.ok(body.includes('410 V') && body.includes('4.88 A') && body.includes('1.2 kWh') && body.includes('50 kWh'));
  assert.ok(!body.includes('sigen-history-chart'));
  assert.ok(!body.includes('data-id="missing"'));
  assert.ok(!body.includes('9 kW'));
});

test('stored battery energy prefers a measured value and labels SOC times capacity as an estimate', () => {
  const actual = context({ battery_stored_energy: reading(2200, 'Wh'), battery_soc: reading(75, '%'), battery_capacity: reading(36.16, 'kWh') });
  const actualBody = renderDeviceDetail('battery_energy', actual).body;
  assert.ok(actualBody.includes('2.2 kWh'));
  assert.ok(!actualBody.includes('Estimated stored energy'));
  const estimate = renderDeviceDetail('battery_energy', context({ battery_soc: reading(75, '%'), battery_capacity: reading(36.16, 'kWh'), battery_charge_today: reading(10, 'kWh'), solar_today: reading(20, 'kWh') })).body;
  assert.ok(estimate.includes('Estimated stored energy') && estimate.includes('27.12 kWh'));
  assert.ok(estimate.includes('<th scope="row">From Solar</th><td>—</td>'));
  assert.ok(estimate.includes('<th scope="row">From Grid</th><td>—</td>'));
  assert.ok(renderDeviceDetail('battery_energy', context({ battery_soc: reading(0, '%'), battery_capacity: reading(36.16, 'kWh') })).body.includes('0 kWh'));
  const invalid = renderDeviceDetail('battery_energy', context({ battery_soc: reading(101, '%'), battery_capacity: reading(36.16, 'kWh') })).body;
  assert.ok(!invalid.includes('Estimated stored energy'));
});

test('lifetime energy rows preserve measured MWh to kWh normalization on all equipment pages', () => {
  const ctx = context({
    solar_lifetime: reading(.10523, 'MWh'), home_lifetime: reading(.28754, 'MWh'),
    battery_charge_lifetime: reading(.14274, 'MWh'), battery_discharge_lifetime: reading(.14741, 'MWh'),
    grid_import_lifetime: reading(.18029, 'MWh'), grid_export_lifetime: reading(.00265, 'MWh'),
    ac_energy_lifetime: reading(638.71, 'kWh'), dc_energy_lifetime: reading(0, 'kWh'), dc_discharge_lifetime: reading(0, 'kWh'),
  });
  for (const [route, expected] of [['solar', '105.23 kWh'], ['load', '287.54 kWh'], ['battery', '142.74 kWh'], ['battery_energy', '147.41 kWh'], ['grid', '180.29 kWh'], ['ac', '638.71 kWh'], ['dc', '0 kWh']]) assert.ok(renderDeviceDetail(route, ctx).body.includes(expected), route);
  assert.ok(renderDeviceDetail('grid', ctx).body.includes('2.65 kWh'));
  assert.ok(renderDeviceDetail('solar', context({ total_pv_generation: reading(.1, 'MWh') })).body.includes('100 kWh'));
});

test('heating, cell voltages and discharge count stay typed and isolated for battery modules', () => {
  const ctx = context({ battery_heating: reading('Heating', ''), battery_cell_voltage_max: reading(3500, 'mV'), battery_cell_voltage_min: reading(3.4, 'V'), battery_discharge_count: reading(50, 'cycles'), battery_discharge_lifetime: reading(100, 'kWh'), 'sensor.module_heat': reading('Off', ''), 'sensor.module_max': reading(3450, 'mV'), 'sensor.module_cycles': reading(0, '') }, { inventory: [{ id: 'unmapped', type: 'battery' }, { id: 'mapped', type: 'battery', entities: { battery_heating: 'sensor.module_heat', battery_cell_voltage_max: 'sensor.module_max', battery_discharge_count: 'sensor.module_cycles' } }] });
  const aggregate = renderDeviceDetail('battery', ctx).body;
  assert.ok(aggregate.includes('Heating') && aggregate.includes('3.5 V') && aggregate.includes('3.4 V'));
  assert.ok(aggregate.includes('<th scope="row">Discharge count</th><td>50</td>'));
  const unmapped = renderDeviceDetail('battery_module', { ...ctx, id: 'unmapped' }).body;
  assert.ok(!unmapped.includes('3.5 V') && !unmapped.includes('100 kWh'));
  assert.ok(!unmapped.includes('<th scope="row">Discharge count</th>')&&unmapped.includes('No current module readings'));
  const mapped = renderDeviceDetail('battery_module', { ...ctx, id: 'mapped' }).body;
  assert.ok(mapped.includes('3.45 V'));
  assert.ok(mapped.includes('<th scope="row">Battery heating</th><td>Off</td>'));
  assert.ok(mapped.includes('<th scope="row">Discharge count</th><td>0</td>'));
});

test('charger primary actions remain visible and locked without owner permission', () => {
  for (const route of ['ac', 'dc']) {
    const body = renderDeviceDetail(route, context()).body;
    assert.match(body,/<button[^>]+data-charger-action="start"[^>]+disabled aria-disabled="true"[^>]*>Start charging<\/button>/);
    assert.ok(body.includes(`data-detail="charging_mode" data-id="${route}"`));
    assert.ok(!/data-(manual|service|start)=/.test(body));
  }
});

test('device network, maintenance and settings links preserve the selected equipment identity', () => {
  const inventory = ['inverter', 'battery_module', 'gateway', 'ac', 'dc'].map(type => ({ id: `${type}-selected`, type }));
  for (const type of ['inverter', 'battery_module', 'gateway', 'ac', 'dc']) {
    const id = `${type}-selected`, body = renderDeviceDetail(type, context({}, { id, inventory })).body;
    for (const route of ['network', 'maintenance', 'device_settings']) assert.ok(body.includes(`data-detail="${route}" data-id="${id}"`), `${type}: ${route}`);
    const missing = renderDeviceDetail(type, context({}, { id: 'removed-device', inventory })).body;
    for (const route of ['network', 'maintenance', 'device_settings']) assert.ok(!missing.includes(`data-detail="${route}"`), `removed ${type}: ${route}`);
  }
  const malicious = 'device" data-action="execute';
  const body = renderDeviceDetail('gateway', context({}, { id: malicious, inventory: [{ id: malicious, type: 'gateway' }] })).body;
  assert.ok(body.includes('data-id="device&quot; data-action=&quot;execute"'));
  assert.ok(!body.includes('data-action="execute"'));
});

test('plant and inventory expose connection and maintenance pages without emitting commissioning actions', () => {
  for (const route of ['plant', 'devices']) {
    const body = renderDeviceDetail(route, context()).body;
    for (const target of ['network', 'maintenance', 'add_device']) assert.ok(body.includes(`data-detail="${target}"`), `${route}: ${target}`);
    assert.ok(!/data-(service|start|execute|commission)=/.test(body));
  }
});

test('System About and software information use only supplied metadata and each device firmware', () => {
  const ctx = context({firmware:reading('aggregate-secret-version','')}, {config:{plant:{name:'Test system',commissioned_at:'2026-01-02'},system_about:{installer:'<Test installer>'}},inventory:[{id:'inv',type:'inverter',name:'Controller',model:'Test model',firmware:'3.2',update_status:'Update available'},{id:'module',type:'battery_module'}]});
  const about = renderDeviceDetail('system_about',ctx).body;
  assert.ok(about.includes('Test system')&&about.includes('data-detail="system_details"'));
  assert.ok(!about.includes('&lt;Test installer&gt;')&&about.includes('data-detail="plant"'));
  assert.ok(renderDeviceDetail('plant',ctx).body.includes('&lt;Test installer&gt;'));
  const software = renderDeviceDetail('software_update',ctx).body;
  assert.ok(software.includes('3.2')&&software.includes('Update available'));
  assert.ok(!software.includes('aggregate-secret-version')&&!software.includes('Up to date'));
  for(const route of ['system_about','software_update','warranty'])assert.ok(renderDeviceDetail(route,context()).body.includes('—')||renderDeviceDetail(route,context()).body.includes('unavailable'));
});

test('warranty dates remain unknown unless supplied and document links require an explicit safe URL', () => {
  const ctx = context({}, {inventory:[{id:'device',type:'inverter',warranty_expires:'2030-01-02',warranty_policy_url:'https://example.test/warranty.pdf'}]});
  const warranty = renderDeviceDetail('warranty',ctx).body;
  assert.ok(warranty.includes('2030')&&warranty.includes('data-detail="warranty_download"'));
  const document = renderDeviceDetail('warranty_download',ctx).body;
  assert.ok(document.includes('href="https://example.test/warranty.pdf"'));
  assert.ok(!/\bdownload(?:=|\s|>)/.test(document));
  assert.ok(!renderDeviceDetail('warranty_download',{...ctx,id:'missing'}).body.includes('href='));
  for(const url of ['javascript:alert(1)','//untrusted.test/file.pdf','https://name:password@example.test/file.pdf','https://example.test/" onclick="bad'])assert.ok(!renderDeviceDetail('warranty_download',context({}, {config:{warranty_policy_url:url}})).body.includes('href='));
  assert.ok(!renderDeviceDetail('warranty',context({}, {inventory:[{id:'device',type:'inverter',warranty_expires:'2030-02-30'}]})).body.includes('2030'));
});

test('SigenCare keeps observed categories and measured metrics without inventing scores or running tests', () => {
  const ctx = context({battery_soh:reading(97,'%'),battery_capacity:reading(20,'kWh'),net_cost_today:reading(-1.2,'EUR')},{config:{cloud_paused:true}});
  const body = renderDeviceDetail('sigen_care',ctx).body;
  for(const category of ['Network Reliability','Revenue Performance','Equipment Reliability','Environmental Reliability','Battery Health','Capacity Assessment'])assert.ok(body.includes(category));
  assert.ok(body.includes('97 %')&&body.includes('20 kWh')&&body.includes('-1.2 EUR')&&body.includes('Paused'));
  assert.ok(body.includes('disabled aria-disabled="true">Start test</button>'));
  assert.ok(!/score|healthy|data-(test|service|execute)=/i.test(body));
  assert.equal(body,renderDeviceDetail('care',ctx).body);
});

test('diagnosis distinguishes unavailable reports from recorded empty findings and keeps per-report tabs scoped', () => {
  const unknown = renderDeviceDetail('diagnosis',context()).body;
  assert.ok(unknown.includes('report unavailable')&&!unknown.includes('No recorded abnormalities'));
  const config = {diagnosis:{id:'current',saved_at:'2026-10-27T01:00:00Z',abnormal:[],alerts:[]},diagnosis_history:[{id:'old:report',saved_at:'2026-10-24T12:00:00Z',abnormal:[{code:'OLD',message:'Earlier issue'}],categories:[{key:'network',status:'Observed status',rows:[{label:'Ethernet',status:'Connected',currently_used:true}]}]}]};
  const current = renderDeviceDetail('diagnosis',context({}, {config})).body;
  assert.ok(current.includes('No recorded abnormalities')&&current.includes('disabled aria-disabled="true">Check Again'));
  const report = renderDeviceDetail('diagnosis_detail',context({}, {config,id:'old:report'})).body;
  assert.ok(report.includes('Earlier issue')&&!report.includes('No recorded abnormalities'));
  assert.ok(report.includes('data-id="full:old%3Areport"'));
  const full = renderDeviceDetail('diagnosis_detail',context({}, {config,id:'full:old%3Areport'})).body;
  for(const category of ['Power Sensor Connection','Gateway Connection','Network','Battery Terminal Connection','DC-side Cable Connection','AC-side Environmental Status','Energy Storage Status','DC Charger Connection Status'])assert.ok(full.includes(category));
  assert.ok(full.includes('Connected · Currently used')&&full.includes('WLAN')&&full.includes('Cellular'));
  assert.ok(!full.includes('Healthy'));
  assert.ok(!renderDeviceDetail('diagnosis_detail',context({}, {config,id:'missing'})).body.includes('Earlier issue'));
  assert.ok(renderDeviceDetail('diagnosis_history',context({}, {config})).body.includes('data-id="abnormal:old%3Areport"'));
  const encoded = {...config,diagnosis_history:[{id:'alerts:report%2Fone',abnormal:[{message:'Identity preserved'}]}]};
  assert.ok(renderDeviceDetail('diagnosis_detail',context({}, {config:encoded,id:'abnormal:alerts%3Areport%252Fone'})).body.includes('Identity preserved'));
});

test('alert availability is explicit and active/history rows open data-driven details without clear actions', () => {
  assert.ok(renderDeviceDetail('alerts',context()).body.includes('Alert information unavailable'));
  const empty = context({}, {config:{alerts_active:[],alert_history:[]}});
  assert.ok(renderDeviceDetail('alerts',empty).body.includes('No active alerts'));
  assert.ok(renderDeviceDetail('alert_history',empty).body.includes('No alert history'));
  const config = {alerts_active:[],alert_history:[{id:'fault',title:'Earlier fault',code:'A123',device_type:'battery',device_serial:'TEST-SN',message:'Connection issue',occurred_at:'2026-10-25T01:30:00Z',resolved_at:'2026-10-25T02:00:00Z',suggestion:'Inspect the cable'}]};
  const ctx = context({}, {config});
  const history = renderDeviceDetail('alert_history',ctx).body;
  assert.ok(history.includes('detail-alert-split')&&history.includes('Earlier fault')&&history.includes('data-id="history:fault"'));
  assert.ok(history.includes('data-alert-filter="query"')&&history.includes('data-alert-filter="type"')&&history.includes('data-alert-filter="from"')&&history.includes('data-alert-filter="to"'));
  assert.ok(!history.includes('<form'));
  const detail = renderDeviceDetail('alert_detail',{...ctx,id:'history:fault'}).body;
  assert.ok(detail.includes('A123')&&detail.includes('TEST-SN')&&detail.includes('Inspect the cable'));
  assert.ok(!/data-(clear|acknowledge|execute|service)=/.test(detail));
  assert.ok(renderDeviceDetail('alert_detail',{...ctx,id:'history:missing'}).body.includes('unavailable'));
});

test('alert filters search code/system/serial and apply source types and local date boundaries', () => {
  const rows = [{code:'A1',system_id:'SYS',device_serial:'SN1',device_type:'inverter',occurred_at:'2026-03-28T23:30:00Z'},{code:'B2',device_type:'battery_module',occurred_at:'2026-03-29T23:30:00Z'},{code:'C3',device_type:'dc',occurred_at:'2026-03-29T12:00:00Z'}];
  for(const query of ['a1','sys','sn1'])assert.deepEqual(filterDetailAlerts(rows,{query},{timezone:'Europe/Dublin'}),[rows[0]]);
  assert.deepEqual(filterDetailAlerts(rows,{type:'battery'}),[rows[1]]);
  assert.deepEqual(filterDetailAlerts(rows,{type:'charger'}),[rows[2]]);
  assert.deepEqual(filterDetailAlerts(rows,{from:'2026-03-30',to:'2026-03-30'},{timezone:'Europe/Dublin'}),[rows[1]]);
  for(const filters of [{from:'2026-02-30'},{from:'2026-03-30',to:'2026-03-29'}])assert.deepEqual(filterDetailAlerts(rows,filters),[]);
  assert.deepEqual(filterDetailAlerts(rows,null),rows);
});

test('new report and alert pages escape supplied text, identifiers and filter values', () => {
  const unsafe = '"><img src=x onerror=alert(1)>';
  const config = {diagnosis:{saved_at:'invalid',abnormal:[{title:unsafe,message:unsafe}]},alert_history:[{id:unsafe,title:unsafe,suggestion:unsafe}]};
  for(const route of ['diagnosis','alert_history','alert_detail']) {
    const body = renderDeviceDetail(route,context({}, {config,id:route==='alert_detail'?`history:${encodeURIComponent(unsafe)}`:undefined,alertFilters:{query:'',from:unsafe}})).body;
    assert.ok(!body.includes('<img src=x'));
  }
});

test('Modbus Server displays only verified enabled/IP facts and never emits a toggle action', () => {
  const body = renderDeviceDetail('modbus_server',context({}, {config:{modbus_server:{enabled:true,ip_address:'192.0.2.1'}}})).body;
  assert.ok(body.includes('role="switch" aria-label="Modbus server enabled" disabled checked'));
  assert.ok(body.includes('192.0.2.1'));
  assert.ok(!/data-(toggle|service|execute)|onchange=/.test(body));
  const unknown = renderDeviceDetail('modbus_server',context()).body;
  assert.ok(unknown.includes('<strong>—</strong>')&&!unknown.includes('role="switch"'));
});

test('support history uses supplied issue/workorder records with readonly status filters and safe native links', () => {
  const config = {support_history:{issues:[{id:'one',title:'Pending issue',status:'processing'},{id:'two',title:'Old issue',status:'closed'}],workorders:[],portal_url:'https://example.test/support'}};
  const body = renderDeviceDetail('support_history',context({}, {config,id:'issues:processing'})).body;
  assert.ok(body.includes('Pending issue')&&!body.includes('Old issue'));
  assert.ok(body.includes('href="/config/logs"')&&body.includes('href="/config/repairs"')&&body.includes('href="https://example.test/support"'));
  assert.ok(body.includes('Issue List')&&body.includes('Workorder List')&&body.includes('Escalated'));
  const workorders = renderDeviceDetail('support_history',context({}, {config,id:'workorders:all'})).body;
  assert.ok(workorders.includes('Finished')&&workorders.includes('No workorders'));
  assert.ok(!/data-(send|escalate|execute|service)=/.test(body));
  assert.ok(renderDeviceDetail('support_history',context()).body.includes('history unavailable'));
});

test('Service hub links to plant information and retains safe support shortcuts and active alerts', () => {
  const config = {service_provider:{name:'Test installer',phone:'+353 000 000',email:'installer@example.test'},service:{community_url:'https://example.test/community'},alerts_active:[{id:'active-one',title:'Provided active alert'}]};
  const body = renderDeviceDetail('service',context({}, {config})).body;
  assert.ok(body.includes('Provided active alert'));
  for(const contact of ['Test installer','+353 000 000','installer@example.test'])assert.ok(!body.includes(contact));
  for(const route of ['plant','diagnosis','messages','support_history','alerts'])assert.ok(body.includes(`data-detail="${route}"`));
  assert.ok(body.includes('href="https://example.test/community"'));
  assert.ok(!/href="(?:mailto:|tel:)|data-(call|send|service|execute)=/.test(body));
  const unknown = renderDeviceDetail('service',context()).body;
  assert.ok(unknown.includes('Alert information unavailable'));
  assert.ok(unknown.includes('disabled aria-disabled="true">Community</button>'));
  assert.ok(!unknown.includes('No active alerts')&&!unknown.includes('installer@example.test'));
  assert.ok(renderDeviceDetail('service',context({}, {config:{alerts_active:[]}})).body.includes('No active alerts'));
});

test('Message Centre categories filter supplied records while unknown and known-empty lists stay distinct', () => {
  const records = [{id:'system',category:'system',title:'System notice'},{id:'sales',category:'After-sales',title:'Service notice'},{id:'update',category:'update',title:'Update notice'},{id:'event',category:'events',title:'Event notice'}];
  const config = {messages:{records}};
  const all = renderDeviceDetail('messages',context({}, {config})).body;
  for(const label of ['All','System','After-sales','Update','Community','Events'])assert.ok(all.includes(`>${label}</button>`));
  assert.ok(all.includes('System notice')&&all.includes('Service notice')&&all.includes('Event notice'));
  const sales = renderDeviceDetail('messages',context({}, {config,id:'after_sales'})).body;
  assert.ok(sales.includes('Service notice')&&!sales.includes('System notice'));
  assert.ok(renderDeviceDetail('messages',context()).body.includes('Message information unavailable'));
  assert.ok(renderDeviceDetail('messages',context({}, {config:{messages:[]}})).body.includes('No messages'));
  assert.ok(renderDeviceDetail('messages',context({}, {config,id:'community'})).body.includes('No messages in this category'));
});

test('opening and filtering messages cannot alter provider unread flags or synthesize records', () => {
  const record = Object.freeze({id:'notice:one%2Ftwo',category:'system',title:'Provided notice',body:'First line\nSecond line',unread:true,read:false,created_at:'2026-10-27T01:00:00Z'});
  const records = Object.freeze([record]), config = {messages:{records}}, before = JSON.stringify(config);
  const list = renderDeviceDetail('messages',context({}, {config})).body;
  assert.ok(list.includes('>Unread</span>'));
  assert.ok(list.includes('data-id="message:notice%3Aone%252Ftwo"'));
  const detail = renderDeviceDetail('message_detail',context({}, {config,id:'message:notice%3Aone%252Ftwo'})).body;
  assert.ok(detail.includes('First line\nSecond line'));
  assert.ok(renderDeviceDetail('message_detail',context({}, {config,id:'message:missing'})).body.includes('Message unavailable'));
  renderDeviceDetail('messages',context({}, {config,id:'update'}));
  assert.equal(JSON.stringify(config),before);
  assert.ok(!/data-(mark|read|delete|send|execute|service)=/.test(list+detail));
});

test('service and message content stays escaped and unprovided or active document links stay absent', () => {
  const unsafe = '"><img src=x onerror=alert(1)>', config = {service_provider:{name:unsafe,phone:unsafe,email:unsafe},service:{community_url:'javascript:alert(1)',support_url:'mailto:installer@example.test'},messages:[{id:unsafe,title:unsafe,body:'<script>bad()</script>',url:'javascript:alert(1)'}]};
  const service = renderDeviceDetail('service',context({}, {config})).body;
  const plant = renderDeviceDetail('plant',context({}, {config})).body;
  const list = renderDeviceDetail('messages',context({}, {config})).body;
  const detail = renderDeviceDetail('message_detail',context({}, {config,id:`message:${encodeURIComponent(unsafe)}`})).body;
  assert.ok(plant.includes('&lt;img')&&list.includes('&lt;img')&&detail.includes('&lt;script&gt;'));
  assert.ok(!/<img src=x|<script>|href="(?:javascript:|mailto:|tel:)/.test(service+plant+list+detail));
});

test('plant information contains only supplied provider contacts, omitting missing rows and duplicate hubs', () => {
  const provider={name:'Example installer',phone:'+353 000 000',email:'installer@example.test',source:'Verified portal',source_observed_at:'2026-10-27T02:00:00Z'};
  const config={service_provider:provider};
  const body=renderDeviceDetail('plant',context({}, {config})).body;
  assert.equal((body.match(/class="detail-provider"/g)??[]).length,1);
  for(const supplied of [provider.name,provider.phone,provider.email])assert.ok(body.includes(supplied));
  assert.ok(!body.includes('<th scope="row">Address</th>'));
  assert.ok(!/href="(?:tel:|mailto:)|data-(call|send|execute|service)=/.test(body));
  for(const route of ['service','system_about']) {
    const other=renderDeviceDetail(route,context({}, {config})).body;
    assert.ok(!other.includes('class="detail-provider"')&&!other.includes(provider.email));
    assert.ok(other.includes('data-detail="plant"'));
  }
  const empty=renderDeviceDetail('plant',context()).body;
  assert.ok(!empty.includes('class="detail-provider"')&&!empty.includes('<summary>Service provider</summary>'));
  const nameOnly=renderDeviceDetail('plant',context({}, {config:{plant:{service_provider:'Example installer'}}})).body;
  assert.ok(nameOnly.includes('Example installer')&&!nameOnly.includes('<th scope="row">Phone</th>'));
  const legacy=renderDeviceDetail('plant',context({}, {config:{service:{provider:{name:'Legacy installer',address:'Provided address'}}}})).body;
  assert.ok(legacy.includes('Legacy installer')&&legacy.includes('Provided address'));
});

test('unavailable, invalid and other-plant service contacts never create a placeholder or leak identities', () => {
  for(const supplied of [{},[],false,{name:true},{name:'unknown'},{name:'unavailable'},{name:' unknown ',phone:' null ',email:' '},{available:false,name:'Hidden installer'}]) {
    const body=renderDeviceDetail('plant',context({}, {config:{service_provider:supplied}})).body;
    assert.ok(!body.includes('class="detail-provider"'));
  }
  const config={plant:{id:'first'},service_provider:{name:'First installer',email:'first@example.test'}};
  assert.ok(!renderDeviceDetail('plant',context({}, {config,id:'second'})).body.includes('First installer'));
});

test('module details bind fresh own cloud telemetry by exact serial with software and capacity',()=>{
  const measured=(value,unit)=>({value,unit,observed_at:null,retrieved_at:new Date(NOW).toISOString(),timestamp_basis:'cloud_retrieval'});
  const module={serial:'example-module-1',available:true,model:'Example battery',firmware:'v1.2',rated_energy_kwh:9.04,measurements:{soc:measured(51.2,'%'),power_kw:measured(-.455,'kW'),voltage_v:measured(29.8,'V'),temperature_c:measured(18.2,'°C'),cell_voltage_v:measured(3.304,'V'),total_discharge_kwh:measured(39.95,'kWh'),heating:measured('Off',null)}};
  const item={id:'module-one',type:'battery_module',serial:'example-module-1',name:'Battery 1'};
  const before=JSON.stringify({item,module});
  const ctx=context({cloud_status:reading('connected','',{battery_modules:[module]}),battery_soc:reading(99,'%')},{id:'module-one',inventory:[item]});
  const body=renderDeviceDetail('battery_module',ctx).body;
  for(const value of ['51.2 %','Discharging power','0.455 kW','29.8 V','Average cell temperature','18.2 °C','3.304 V','39.95 kWh','Off','v1.2','9.04 kWh']) assert.ok(body.includes(value),value);
  assert.ok(!body.includes('No current module readings')&&!body.includes('99 %'));assert.equal(JSON.stringify({item,module}),before);
});

test('module cloud data rejects stale, offline, future and ambiguous identity without aggregate fallback',()=>{
  for(const scenario of ['stale','future','offline','duplicate','other']) {
    const stamp=NOW+(scenario==='stale'?-1800001:scenario==='future'?5001:0),module={serial:scenario==='other'?'other-module':'expected-module',available:true,firmware:'v2',measurements:{soc:{value:66,unit:'%',observed_at:new Date(stamp).toISOString(),retrieved_at:new Date(NOW).toISOString()}}};
    const ctx=context({battery_soc:reading(88,'%'),cloud_status:reading(scenario==='offline'?'error':'connected','',{battery_modules:scenario==='duplicate'?[module,module]:[module]})},{id:'module-one',inventory:[{id:'module-one',type:'battery_module',serial:'expected-module'}]});
    const body=renderDeviceDetail('battery_module',ctx).body;
    assert.ok(body.includes('No current module readings'),scenario);assert.ok(!body.includes('66 %')&&!body.includes('88 %'),scenario);
  }
});
