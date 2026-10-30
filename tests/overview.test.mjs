import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderTodayEnergy, renderMobilePower, renderBatteryLevel, renderChargingEnergy, renderChargerControls, chargerEnergyModel, OVERVIEW_STYLE} from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-overview.js';

const state = (value, unit, extra = {}) => ({state:String(value),attributes:{unit_of_measurement:unit,...extra}});

test('charger actions unlock only for an exact discovered serial and owner permission',()=>{
 const control={attributes:{owner_devices:{acSnList:['A','B']}}};
 const extra={inventory:[{id:'ac-one',type:'ac',serial:'B'}],controlPermission:true,capabilities:{ac_charging:{available:true}}};
 const native=context({ac_today:state(1,'kWh')},extra),read=native.state;
 native.state=key=>key==='control_status'?control:read(key);
 const ready=renderChargerControls(native);assert.match(ready,/data-serial="B"/);assert.doesNotMatch(ready,/disabled/);
 native.inventory=[{id:'not-bound',type:'ac'}];assert.match(renderChargerControls(native),/disabled aria-disabled="true"/);
 native.inventory=extra.inventory;native.controlPermission=false;assert.match(renderChargerControls(native),/disabled aria-disabled="true"/);
});
function context(states = {}, extra = {}) {
  return {entities:Object.fromEntries(Object.keys(states).map(key=>[key,`sensor.${key}`])),state:key=>states[key],value:(key, quantity='energy')=>{
    const item=states[key]; if(!item)return null;
    const factor=quantity==='soc' ? item.attributes.unit_of_measurement==='%' ? 1 : undefined : ({Wh:.001,kWh:1,MWh:1000})[item.attributes.unit_of_measurement];
    return factor===undefined ? null : Number(item.state)*factor;
  },locale:{language:'en-IE'},...extra};
}

test('today energy matches the six requested cells in row order with existing detail routes',()=>{
  const html=renderTodayEnergy(context({solar_today:state(72370,'Wh'),grid_import_today:state(2.17,'kWh'),grid_export_today:state(.01882,'MWh'),battery_charge_today:state(16.46,'kWh'),battery_discharge_today:state(6,'kWh'),battery_soc:state(64,'%'),ac_today:state(1,'kWh'),dc_today:state(2,'kWh')},{inventory:[{type:'ac'},{type:'dc'}]}));
  assert.match(html,/>Today's energy<\/h2>/);
  assert.deepEqual([...html.matchAll(/<small>([^<]+)<\/small>/g)].map(match=>match[1]),['Solar produced','Grid imported','Grid exported','Battery charged','Battery discharged','AC/DC charger']);
  for(const amount of ['72.37 kWh','2.17 kWh','18.82 kWh','16.46 kWh','6 kWh','3 kWh'])assert.ok(html.includes(amount),amount);
  assert.deepEqual([...html.matchAll(/data-detail="([^"]+)"/g)].map(match=>match[1]),['solar','grid','grid','battery','battery','charging_energy']);
  assert.equal((html.match(/class="overview-energy-metric"/g)??[]).length,6);
});

test('zero readings remain real and missing, malformed, unavailable, wrong units and negative values never become zero',()=>{
  const zero=renderTodayEnergy(context({solar_today:state(0,'kWh'),ac_today:state(0,'kWh')}));
  assert.match(zero,/Solar produced: 0 kWh/); assert.match(zero,/AC charger charged today: 0 kWh/);
  for(const item of [state('unknown','kWh'),state('unavailable','kWh'),state('','kWh'),state(-2,'kWh'),state(2,'W'),state('not a number','kWh'),state(Infinity,'kWh'),state(5,'kWh',{available:false})]){
    const html=renderTodayEnergy(context({solar_today:item}));
    assert.match(html,/Solar produced: —/);assert.doesNotMatch(html,/NaN|Infinity|undefined|null/);
  }
  assert.doesNotMatch(zero,/<small>Battery SOC<\/small>/);
});

test('installed AC and DC daily energy sum with a separate popup breakdown and exact device identities',()=>{
  const ctx=context({ac_today:state(1500,'Wh'),dc_today:state(.002,'MWh')},{inventory:[{type:'EVAC',id:'actual-ac'},{device_type:'DC Charger',serial_number:'actual-dc'}]}),model=chargerEnergyModel(ctx),page=renderChargingEnergy(ctx);
  assert.equal(model.total,3.5);assert.equal(model.complete,true);assert.equal(model.label,'AC/DC charger');
  assert.deepEqual(model.items.map(item=>[item.type,item.value,item.id]),[['ac',1.5,'actual-ac'],['dc',2,'actual-dc']]);
  assert.equal(page.title,'Charging energy today');assert.match(page.body,/>3\.5 kWh<\/strong>/);
  assert.match(page.body,/data-detail="ac" data-id="actual-ac"/);assert.match(page.body,/data-detail="dc" data-id="actual-dc"/);
  assert.match(page.body,/>1\.5 kWh<\/strong>/);assert.match(page.body,/>2 kWh<\/strong>/);assert.doesNotMatch(page.body,/charging_mode|callService/);
  assert.match(page.body,/<sigen-history-chart data-chart="ac" data-id="actual-ac">/);
  assert.match(page.body,/<sigen-history-chart data-chart="dc" data-id="actual-dc">/);
});

test('single installed charger types include only their own readings despite unrelated mapped totals',()=>{
  for(const type of ['ac','dc']){
    const ctx=context({ac_today:state(2,'kWh'),dc_today:state(8,'kWh')},{inventory:[{type:'inverter'},{type,installed:true,id:'installed-only'}]}),model=chargerEnergyModel(ctx),html=renderTodayEnergy(ctx),page=renderChargingEnergy(ctx);
    assert.deepEqual(model.items.map(item=>item.type),[type]);assert.equal(model.total,type==='ac'?2:8);assert.equal(model.label,type.toUpperCase()+' charger');
    assert.match(html,new RegExp(`<small>${type.toUpperCase()} charger<\\/small>`));assert.doesNotMatch(html,/AC\/DC/);
    assert.match(page.body,new RegExp(`data-detail="${type}" data-id="installed-only"`));assert.doesNotMatch(page.body,new RegExp(`data-detail="${type==='ac'?'dc':'ac'}"`));
    assert.equal((page.body.match(/<sigen-history-chart/g)??[]).length,1);
  }
});

test('no installed charger omits the sixth tile and leaves a balanced five-cell grid',()=>{
  const readings={ac_today:state(4,'kWh'),dc_today:state(6,'kWh'),ac_power:state(2,'kW')};
  for(const inventory of [[{type:'inverter'}],[{type:'ac',installed:false},{type:'dc',installed:false}],[{type:'solar'},{type:'ac',capabilities:{available:false}}]]){
    const ctx=context(readings,{inventory}),model=chargerEnergyModel(ctx),html=renderTodayEnergy(ctx);
    assert.equal(model.items.length,0);assert.equal(model.total,null);assert.equal(model.complete,false);
    assert.equal((html.match(/class="overview-energy-metric"/g)??[]).length,5);assert.match(html,/overview-energy-five/);assert.doesNotMatch(html,/data-detail="charging_energy"|AC charger|DC charger/);
    assert.match(renderChargingEnergy(ctx).body,/No charger installed/);
  }
});

test('explicit absent capability wins while an offline installed charger stays present',()=>{
  const base=context({ac_today:state(2,'kWh'),dc_today:state(4,'kWh')},{inventory:[{type:'AC-charger',available:false},{type:'EV_DC'}]});
  assert.deepEqual(chargerEnergyModel(base).items.map(item=>item.type),['ac','dc']);
  assert.deepEqual(chargerEnergyModel({...base,capabilities:{dc:false}}).items.map(item=>item.type),['ac']);
  assert.deepEqual(chargerEnergyModel({...base,config:{capabilities:{ac_charger:{available:false}}}}).items.map(item=>item.type),['dc']);
});

test('an unavailable installed type makes the combined total unknown rather than a partial amount or zero',()=>{
  for(const bad of [state('unavailable','kWh'),state('unknown','kWh'),state(-1,'kWh'),state(1,'W'),undefined]){
    const ctx=context({ac_today:state(2,'kWh'),dc_today:bad},{inventory:[{type:'ac'},{type:'dc'}]}),model=chargerEnergyModel(ctx),html=renderTodayEnergy(ctx),page=renderChargingEnergy(ctx);
    assert.equal(model.total,null);assert.equal(model.complete,false);assert.equal(model.items[0].value,2);assert.equal(model.items[1].value,null);
    assert.match(html,/AC\/DC charger charged today: —/);assert.match(page.body,/AC charger charged today: 2 kWh/);assert.match(page.body,/DC charger charged today: —/);assert.doesNotMatch(page.body,/NaN|Infinity|undefined|null/);
  }
  const zero=chargerEnergyModel(context({ac_today:state(0,'Wh'),dc_today:state(0,'MWh')},{inventory:[{type:'ac'},{type:'dc'}]}));
  assert.equal(zero.total,0);assert.equal(zero.complete,true);
});

test('empty legacy inventory uses explicit entity mappings or has capability and never state alone',()=>{
  const ctx=context({ac_today:state(2,'kWh')});
  assert.deepEqual(chargerEnergyModel({...ctx,inventory:[]}).items.map(item=>item.type),['ac']);
  assert.deepEqual(chargerEnergyModel({...ctx,entities:{},has:key=>key==='dc_state'}).items.map(item=>item.type),['dc']);
  assert.equal(chargerEnergyModel({...ctx,entities:{}}).items.length,0);
  assert.equal(chargerEnergyModel({...ctx,inventory:[{name:'Unknown device'}]}).items.length,0);
});

test('multiple chargers of one type do not invent a unique device link and untrusted identities are escaped',()=>{
  const many=renderChargingEnergy(context({ac_today:state(2,'kWh')},{inventory:[{type:'ac',id:'one'},{type:'ac',id:'two'}]}));
  assert.match(many.body,/data-detail="ac"/);assert.doesNotMatch(many.body,/data-id=/);
  const escaped=renderChargingEnergy(context({ac_today:state(2,'kWh')},{inventory:[{type:'ac',id:'<script>"bad'}]}));
  assert.match(escaped.body,/data-id="&lt;script&gt;&quot;bad"/);assert.doesNotMatch(escaped.body,/<script>/);
});

test('charger instant actions appear only for installed types and remain hardware locked',()=>{
  assert.equal(renderChargerControls({}), '');
  for(const type of ['ac','dc']){
    const ctx=context({ac_today:state(2,'kWh'),dc_today:state(8,'kWh')},{inventory:[{type,id:'installed-one'},{type:type==='ac'?'dc':'ac',installed:false}]}),html=renderChargerControls(ctx);
    assert.match(html,new RegExp(`data-charger-type="${type}"`));
    assert.match(html,new RegExp(`data-detail="${type}" data-id="installed-one"`));
    assert.doesNotMatch(html,new RegExp(`data-charger-type="${type==='ac'?'dc':'ac'}"`));
    assert.equal((html.match(/data-charger-action=/g)??[]).length,2);
    assert.equal((html.match(/disabled aria-disabled="true"/g)??[]).length,2);
    assert.match(html,/>Start charging<\/button>/);assert.match(html,/>Stop charging<\/button>/);
    assert.match(html,new RegExp(`aria-label="Start ${type.toUpperCase()} charger charging"`));
    assert.doesNotMatch(html,/data-preview|data-manual|callService/);
  }
});

test('absent charger capability hides controls while an offline installed charger stays visible and locked',()=>{
  const ctx=context({ac_today:state(0,'kWh'),dc_today:state('unavailable','kWh')},{inventory:[{type:'ac',id:'ac-one'},{type:'dc',id:'dc-one',available:false}]}),html=renderChargerControls(ctx);
  assert.equal((html.match(/class="overview-charger-control"/g)??[]).length,2);
  assert.equal((html.match(/disabled aria-disabled="true"/g)??[]).length,4);
  assert.doesNotMatch(renderChargerControls({...ctx,capabilities:{ac:{installed:false},dc:false}}),/button/);
  assert.equal(renderChargerControls(context({ac_today:state(0,'kWh')},{inventory:[{type:'inverter'}]})), '');
});

test('multiple chargers navigate to inventory without selecting a device and charger identities are escaped',()=>{
  const many=renderChargerControls({inventory:[{type:'ac',id:'one'},{type:'ac',id:'two'}]});
  assert.match(many,/data-detail="devices"/);assert.doesNotMatch(many,/data-id=/);
  assert.equal((many.match(/data-charger-action=/g)??[]).length,2);
  const escaped=renderChargerControls({inventory:[{type:'ac',id:'<script>"bad'}]});
  assert.match(escaped,/data-id="&lt;script&gt;&quot;bad"/);assert.doesNotMatch(escaped,/<script>/);
  const mappedOnly=renderChargerControls(context({dc_today:state(0,'kWh')}));
  assert.match(mappedOnly,/data-charger-type="dc"/);assert.match(mappedOnly,/data-detail="devices"/);assert.doesNotMatch(mappedOnly,/data-id=/);
});

test('combined circle panel retains measured battery storage and accessible SOC progress',()=>{
  const html=renderBatteryLevel(context({battery_soc:state(64,'%'),battery_capacity:state(40300,'Wh'),battery_stored_energy:state(25.8,'kWh')}));
  assert.match(html,/>Battery level<\/span>/);assert.match(html,/>64\.0%<\/strong>/);
  assert.match(html,/role="progressbar"/);assert.match(html,/aria-valuenow="64"/);assert.match(html,/--ring-fill:64%/);
  assert.match(html,/>25\.8 of 40\.3 kWh<\/small>/);assert.doesNotMatch(html,/Estimated|≈/);
  assert.match(html,/data-detail="battery_energy"/);
});

test('estimated storage requires both valid SOC and measured capacity and is identified as an estimate',()=>{
  const html=renderBatteryLevel(context({battery_soc:state(64,'%'),battery_capacity:state(40.3,'kWh')}));
  assert.match(html,/≈ 25\.8 of 40\.3 kWh/);assert.match(html,/Estimated stored energy/);
  const capacityOnly=renderBatteryLevel(context({battery_capacity:state(40.3,'kWh')}));
  assert.match(capacityOnly,/40\.3 kWh capacity/);assert.match(capacityOnly,/aria-valuetext="Unavailable"/);assert.doesNotMatch(capacityOnly,/aria-valuenow|width:0|≈/);
  const socOnly=renderBatteryLevel(context({battery_soc:state(64,'%')}));
  assert.match(socOnly,/--ring-fill:64%/);assert.doesNotMatch(socOnly,/of .*kWh|≈/);
});

test('battery zero and full charge preserve exact endpoints and bad capacity cannot invent storage',()=>{
  for(const soc of [0,100]){
    const html=renderBatteryLevel(context({battery_soc:state(soc,'%'),battery_capacity:state(40,'kWh')}));
    assert.ok(html.includes(`aria-valuenow="${soc}"`));assert.ok(html.includes(`--ring-fill:${soc}%`));assert.ok(html.includes(`≈ ${soc===0?0:40} of 40 kWh`));
  }
  for(const capacity of [0,-1,Infinity,'unavailable'])assert.doesNotMatch(renderBatteryLevel(context({battery_soc:state(50,'%'),battery_capacity:state(capacity,'kWh')})),/of .*kWh|≈/);
  const impossible=renderBatteryLevel(context({battery_soc:state(50,'%'),battery_capacity:state(40,'kWh'),battery_stored_energy:state(50,'kWh')}));
  assert.match(impossible,/40 kWh capacity/);assert.doesNotMatch(impossible,/50 of|≈/);
});

test('three circles show actual daily production, consumption and SOC with independent detail routes',()=>{
  const html=renderBatteryLevel(context({solar_today:state(24030,'Wh'),home_today:state(40.64,'kWh'),battery_soc:state(48.5,'%')}));
  assert.deepEqual([...html.matchAll(/data-detail="([^"]+)"/g)].map(m=>m[1]),['production','consumption','battery_energy']);
  assert.match(html,/PV production: 24\.03 kWh/);assert.match(html,/Consumption: 40\.64 kWh/);assert.match(html,/>48\.5%<\/strong>/);
  assert.equal((html.match(/class="overview-summary-ring/g)??[]).length,3);
  const missing=renderBatteryLevel(context({solar_today:state('unavailable','kWh'),home_today:state(0,'kWh')}));
  assert.match(missing,/PV production: Unavailable/);assert.match(missing,/Consumption: 0 kWh/);assert.doesNotMatch(missing,/NaN|Infinity/);
});

test('measured stored energy can use the alternate source without a capacity and never guesses capacity',()=>{
  const html=renderBatteryLevel(context({battery_energy_stored:state(5700,'Wh')}));
  assert.match(html,/5\.7 kWh stored/);assert.doesNotMatch(html,/<small class="overview-battery-energy[^>]*>[^<]*(?: of |≈)/);
});

test('compact summary remains a pure local renderer and styles retain phone and dark treatment',async()=>{
  const source=await readFile(new URL('../custom_components/sigen_hybrid/frontend/sigen-hybrid-overview.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|callWS|callApi|callService|setInterval|setTimeout|localStorage|sessionStorage)\s*[.(]/);
  assert.ok(OVERVIEW_STYLE.includes('repeat(2,minmax(0,1fr))'));assert.ok(OVERVIEW_STYLE.includes('.night .overview-compact-panel'));assert.ok(OVERVIEW_STYLE.includes('@container'));
  assert.doesNotMatch(renderTodayEnergy({value:()=>{throw Error('missing');}}),/NaN|undefined|null/);
});


test('phone readings preserve zero, signs and unknowns while using existing detail routes',()=>{
 const values={solar_power:0,home_power:null,battery_power:-2.4,battery_soc:76.2,grid_power:-1};
 const html=renderMobilePower({entities:Object.fromEntries(Object.keys(values).map(key=>[key,'sensor.'+key])),value:key=>values[key],haLocale:{language:'en'}});
 assert.match(html,/Solar: 0 kW/);assert.match(html,/Home: —/);assert.match(html,/Battery: 2.4 kW, 76.2% · Discharging/);assert.match(html,/Grid: 1 kW, Exporting/);
 assert.doesNotMatch(html,/AC charger|DC charger|NaN/);assert.equal((html.match(/<button/g)??[]).length,4);
 values.battery_power=2;assert.match(renderMobilePower({entities:{battery_power:'sensor.b'},value:key=>values[key]}),/Charging/);
});
