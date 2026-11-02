import test from 'node:test';
import assert from 'node:assert/strict';
import {presetTarget,renderPreset,nativeFields,renderPlantTariffs,normalizeChargingRecords,nativeHistoryPage} from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-presets.js';

const ctx={state:key=>key==='control_status'?{attributes:{control_api_version:1}}:undefined};
test('native personalization remains separate from TC scheduling and survives disabled TC scheduler',()=>{
  const value={rules:[{personalizationRuleId:17,personalizationRuleName:'Night charge',ruleCondition:'02:00–05:00 SOC ≤ 40%',ruleEffect:'Force charge',ruleStatus:1}]};
  const result=renderPreset('strategies',{...ctx,plantConfiguration:{section:'strategies',route:'strategies',value}},{body:'<button>Scheduling: disabled</button>'});
  assert.match(result.body,/Sigenergy plant strategies.*Night charge/s);
  assert.match(result.body,/plant_strategy/);
  assert.match(result.body,/Home Assistant schedules.*Scheduling: disabled/s);
  const detail=renderPreset('plant_strategy',{...ctx,id:'17',plantConfiguration:{section:'strategies',route:'plant_strategy',id:'17',value}});
  assert.match(detail.body,/Force charge/);assert.doesNotMatch(detail.body,/data-settings-form|Apply|Enable this strategy/);
});
test('loading, failed, empty and foreign-device presets remain different states',()=>{
  assert.match(renderPreset('strategies',ctx,{}).body,/Reading plant configuration/);
  assert.match(renderPreset('strategies',{...ctx,plantConfiguration:{section:'strategies',route:'strategies',error:'Unavailable'}},{}).body,/Unavailable/);
  assert.match(renderPreset('strategies',{...ctx,plantConfiguration:{section:'strategies',route:'strategies',value:{rules:[]}}},{}).body,/No personal strategies in this operating mode/);
  assert.equal(presetTarget('network',{id:'OTHER',inventory:[{id:'EC',type:'inverter'}]}),null);
});
test('native configuration renders false, zero and unknown values without defaulting or HTML execution',()=>{
  const html=nativeFields({enabled:false,price:0,note:'<img src=x onerror=alert(1)>',password:'secret',limit:'4294967.295'});
  assert.match(html,/Disabled/);assert.match(html,/>0</);assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<img|secret/);assert.match(html,/System maximum/);
});

test('native tariff periods retain provider units, dates, zero and negative prices',()=>{
  const html=renderPlantTariffs({currency:{currencyCode:'EUR',currencyMinName:'Cent',conversionRatio:100},plan:{buySellTariff:{buyTariff:{staticConfig:{providerName:'Energy supplier',planName:'Night rate',pricePeriods:[{startDate:'2026-11-01',combinedPrices:[{monthRange:'01-12',weekPrices:[{weekRange:'1-7',timeRange:[{timeRange:'02:00-05:00',price:9.5},{timeRange:'05:00-08:00',price:0},{timeRange:'08:00-09:00',price:-1}]}]}]}]}},sellTariff:{staticConfig:{providerName:'Energy supplier'}}}}});
  assert.match(html,/Energy supplier/);assert.match(html,/2026-11-01/);assert.match(html,/9.5 Cent\/kWh/);
  assert.match(html,/0 Cent\/kWh/);assert.match(html,/-1 Cent\/kWh/);assert.doesNotMatch(html,/950|9.5 EUR/);
});

test('native charging records retain filterable timestamps and never invent incomplete-history totals',()=>{
  const page=normalizeChargingRecords({total:51,records:[{chargingStartTime:1793584800,chargingEndTime:1793588400,singleChargingPower:0}]},'ac');
  assert.equal(page.complete,false);assert.equal(page.records[0].charged_kwh,0);assert.equal(page.records[0].discharged_kwh,0);
  assert.match(page.records[0].started_at,/Z$/);
  const dc=normalizeChargingRecords({total:1,records:[{chargingStartTime:1793584800,singleChargingPower:0}]},'dc');
  assert.equal(dc.records[0].discharged_kwh,null);
  const html=nativeHistoryPage({total:51,pages:2},1);
  assert.match(html,/Page 1 of 2/);assert.match(html,/data-native-config-page="2"/);assert.match(html,/data-native-config-page="0" disabled/);
});

test('native network details keep working connection diagnostics and preheating keeps disabled saved windows',()=>{
  const network=renderPreset('network',{...ctx,id:'EC',inventory:[{id:'EC',type:'inverter'}],plantConfiguration:{section:'network',route:'network',id:'EC',value:{ipAddress:'192.0.2.5'}}},{title:'Network',body:'Existing Modbus diagnostics'});
  assert.match(network.body,/192.0.2.5/);assert.match(network.body,/Existing Modbus diagnostics/);
  const heat=renderPreset('battery_preheating',{...ctx,plantConfiguration:{section:'preheating',route:'battery_preheating',value:{packPreheatingSwitch:0,packPreheatingVOList:[{startTime:60,duration:60,periodConfig:[1,7],chargingPower:'',dischargePower:''}]}}});
  assert.match(heat.body,/Disabled/);assert.match(heat.body,/01:00/);assert.match(heat.body,/60 minutes/);assert.match(heat.body,/Mon, Sun/);
});
