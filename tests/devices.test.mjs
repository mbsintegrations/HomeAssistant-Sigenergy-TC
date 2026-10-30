import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderDeviceGraphic,renderDeviceOverview,deviceOverviewModel,DEVICE_STYLE} from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-devices.js';

const art={battery:'/local/battery-atlas.png',gateway:'/local/gateway-atlas.png',ac:'/local/ac-atlas.png',dc:'/local/dc-atlas.png'};
const values={solar_power:2,battery_power:-1.5,battery_soc:81.8,ac_power:0,dc_power:0,grid_power:0};
const context=(readings=values,extra={})=>({art,entities:Object.fromEntries(Object.keys(readings).map(key=>[key,`sensor.test_${key}`])),value:key=>readings[key]??null,state:key=>key==='ac_state'?{state:'Not Connected'}:Object.hasOwn(readings,key)?{state:String(readings[key])}:undefined,...extra});

test('real owner artwork is clipped to the correct distinct device sprite instead of showing the full atlas',()=>{
  for(const [type,crop]of [['battery','476 553 127 268'],['inverter','476 553 127 268'],['gateway','659 619 79 119'],['ac','50 489 42 84'],['dc','254 599 61 144']]){
    const html=renderDeviceGraphic(type,{art});
    assert.ok(html.includes(`viewBox="${crop}"`),type);
    assert.ok(html.includes('is-owner-art')&&html.includes('<image href="/local/'));
    assert.ok(html.includes('aria-hidden="true"'));
  }
  assert.ok(renderDeviceGraphic('ac',{art,night:true}).includes('viewBox="55 482 53 88"'));
  const nightDC=renderDeviceGraphic('dc',{art,night:true});
  assert.ok(nightDC.includes('viewBox="251 594 44 129"')&&nightDC.includes('width="1125" height="960"'));
  assert.match(DEVICE_STYLE,/\.sigen-device-graphic>svg\{[^}]*overflow:hidden/);
});

test('solar uses an original blue panel illustration and every missing-art hardware type has a distinct vector silhouette',()=>{
  const outputs=new Set();
  for(const type of ['solar','battery','inverter','ac','dc','gateway']){
    const html=renderDeviceGraphic(type);
    assert.ok(html.includes('is-vector')&&html.includes('<svg')&&!html.includes('<image'),type);
    assert.ok(!html.includes('data-detail='));
    if(type!=='inverter')outputs.add(html);
  }
  assert.equal(outputs.size,5);
  const solar=renderDeviceGraphic('pvpanel',{art:{solar:'/local/full-house.png'}});
  assert.ok(solar.includes('#183d5f')&&solar.includes('skewY(-8)'));
  assert.ok(!solar.includes('<image'));
  assert.equal(renderDeviceGraphic('unknown-device'), '');
});

test('the overview discovers exactly configured device types and routes them to real detail pages',()=>{
  const model=deviceOverviewModel(context());
  assert.deepEqual(model.map(item=>item.type),['solar','storage','ac','dc','gateway']);
  assert.deepEqual(model.map(item=>item.route),['solar','battery','ac','dc','gateway']);
  const body=renderDeviceOverview(context());
  for(const label of ['Solar','SigenStor','Sigen AC charger','Sigen DC charger','Gateway'])assert.ok(body.includes(`>${label}</strong>`));
  for(const route of ['solar','battery','ac','dc','gateway'])assert.ok(body.includes(`data-detail="${route}"`));
  assert.equal((body.match(/class="sigen-device-card"/g)??[]).length,5);
  assert.ok(!body.includes('data-service=')&&!body.includes('data-action='));
  assert.equal(deviceOverviewModel(context({})).length,0);
  assert.ok(renderDeviceOverview(context({})).includes('No devices configured'));
});

test('installed:false overrides leftover mappings, while unavailable/offline installed devices stay visible',()=>{
  const ctx=context(values,{inventory:[{type:'AC charger',installed:false},{type:'EVDC',id:'dc-device',available:false},{type:'Energy Gateway',id:'gateway-device',installed:true}]});
  const model=deviceOverviewModel(ctx);
  assert.ok(!model.some(item=>item.type==='ac'));
  const dc=model.find(item=>item.type==='dc');
  assert.equal(dc.offline,true);assert.equal(dc.power,null);assert.equal(dc.detail,'Unavailable');
  const html=renderDeviceOverview(ctx);
  assert.ok(html.includes('data-detail="dc" data-id="dc-device"'));
  assert.ok(html.includes('data-detail="gateway" data-id="gateway-device"'));
  assert.ok(html.includes('Sigen DC charger: —, Unavailable'));
  assert.ok(!deviceOverviewModel(context(values,{capabilities:{ac:{installed:false}}})).some(item=>item.type==='ac'));
  assert.ok(deviceOverviewModel(context(values,{capabilities:{ac:{available:false}}})).some(item=>item.type==='ac'));
});

test('inventory aliases group inverter and battery as one SigenStor and keep an inverter-only detail route',()=>{
  const withInventory=context({}, {inventory:[{type:'PV array'},{type:'Energy Controller',id:'inverter-device'},{type:'battery_module',id:'battery-device'},{type:'EVAC',id:'ac-device'},{type:'EVDC',id:'dc-device'},{type:'energy_gateway',id:'gateway-device'}]});
  assert.deepEqual(deviceOverviewModel(withInventory).map(item=>item.type),['solar','storage','ac','dc','gateway']);
  const onlyInverter=context({inverter_power:1.25},{inventory:[{type:'energy_controller',id:'inverter-device'}],capabilities:{battery:false}});
  const item=deviceOverviewModel(onlyInverter).find(item=>item.type==='storage');
  assert.equal(item.route,'inverter');assert.equal(item.power,1.25);
  assert.ok(renderDeviceOverview(onlyInverter).includes('data-detail="inverter"'));
  assert.equal(renderDeviceGraphic('battery_module',{art}),renderDeviceGraphic('inverter',{art}));
});

test('actual zero and 0% SOC remain valid, unknown power stays unknown and direction is contextual',()=>{
  const zero=context({solar_power:0,battery_power:0,battery_soc:0,grid_power:0});
  const html=renderDeviceOverview(zero);
  assert.ok(html.includes('0 kW')&&html.includes('0% SOC')&&html.includes('Balanced'));
  assert.ok(!/NaN|Infinity|undefined|null/.test(html));
  const model=deviceOverviewModel(context({...values,battery_power:-2,grid_power:-1}));
  assert.equal(model.find(item=>item.type==='storage').detail,'Discharging');
  assert.equal(model.find(item=>item.type==='gateway').detail,'Exporting');
  const missing=deviceOverviewModel(context({...values,solar_power:null,battery_soc:101}));
  assert.equal(missing.find(item=>item.type==='solar').power,null);
  assert.equal(missing.find(item=>item.type==='storage').soc,null);
  assert.ok(!renderDeviceOverview(context({...values,battery_soc:101})).includes('101%'));
});

test('gateway can show mapped home consumption without pretending it is a grid-import reading',()=>{
  const gateway=deviceOverviewModel(context({home_power:2.25})).find(item=>item.type==='gateway');
  assert.equal(gateway.power,2.25);assert.equal(gateway.detail,'Home consumption');
  assert.equal(gateway.route,'gateway');
});

test('untrusted status, identities and image URLs remain inert and safe artwork falls back to vector',()=>{
  const bad=context(values,{art:{battery:'javascript:alert(1)',ac:'//tracker.test/pixel',dc:'/asset" onload="bad'},inventory:[{type:'ac',id:'"><img src=x onerror=bad>'}],state:key=>key==='ac_state'?{state:'<img src=x onerror=bad> & ready'}:undefined});
  const body=renderDeviceOverview(bad);
  assert.ok(body.includes('&lt;img src=x onerror=bad&gt; &amp; ready'));
  assert.ok(body.includes('data-id="&quot;&gt;&lt;img'));
  assert.ok(!body.includes('<img src=x')&&!body.includes('javascript:')&&!body.includes('//tracker.test'));
  for(const type of ['storage','ac','dc'])assert.ok(renderDeviceGraphic(type,bad).includes('is-vector'));
  assert.ok(renderDeviceGraphic('gateway',{art:{gateway:'https://example.com/gateway.png'}}).includes('href="https://example.com/gateway.png"'));
});

test('devices and graphics stay pure and have responsive usable touch targets',async()=>{
  const source=await readFile(new URL('../custom_components/sigen_hybrid/frontend/sigen-hybrid-devices.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket|setInterval|setTimeout|requestAnimationFrame|callService|callWS)\s*\(/);
  assert.doesNotMatch(source,/\b(?:localStorage|sessionStorage|customElements|window|document)\b/);
  assert.doesNotMatch(source,/^import\s/m);
  assert.match(DEVICE_STYLE,/min-height:218px/);
  assert.match(DEVICE_STYLE,/@container\(max-width:400px\)/);
  const input=Object.freeze(context(Object.freeze({...values})));
  assert.equal(renderDeviceOverview(input),renderDeviceOverview(input));
});
