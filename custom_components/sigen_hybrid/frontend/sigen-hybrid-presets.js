/* SPDX-License-Identifier: GPL-3.0-only
 * Native presets are observations, never implicitly imported HA automations.
 */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const row=(title,route,id,detail='')=>`<button type="button" class="settings-row native-preset-row" data-detail="${esc(route)}"${id==null?'':` data-id="${esc(id)}"`}><span>${esc(title)}</span><span class="settings-row-value">${esc(detail)}</span></button>`;
export const PRESET_STYLE='.native-preset-row{flex-wrap:wrap;gap:8px 16px}.native-preset-row>span{min-width:0;overflow-wrap:anywhere}.native-preset-row .settings-row-value{white-space:normal;flex:1 1 55%;text-align:right}.native-preset-document{min-width:0}.native-preset-document .detail-meta{grid-template-columns:minmax(0,1fr) minmax(0,2fr)}.native-preset-document .detail-meta>dd{min-width:0}.native-preset-document .detail-meta .detail-meta{grid-template-columns:minmax(0,1fr);margin:0;border-radius:8px}.native-preset-document .detail-meta .detail-meta>dt{padding-bottom:3px}.native-preset-document .detail-meta .detail-meta>dd{padding-top:3px}';
const group=body=>`<section class="settings-group">${body}</section>`;
const note=value=>`<p class="settings-note">${esc(value)}</p>`;
const titles={strategies:'Personal strategies',profiles:'Operating profiles',profile:'Plant operating profile',tariffs:'Plant tariff plan',charger_schedules:'Plant charging schedules',charger_records:'Charging records',network:'Network',preheating:'Preheating schedule',indicators:'Indicator lights',energy_profile:'Plant configuration'};
export const PRESET_ROUTES=Object.freeze({strategies:'strategies',plant_strategy:'strategies',plant_profiles:'profiles',plant_profile:'profile',tariffs:'tariffs',plant_tariffs:'tariffs',charger_schedules:'charger_schedules',plant_charger_schedule:'charger_schedules',charger_records:'charger_records',network:'network',ac_connectivity:'network',ac_ethernet:'network',ac_wlan:'network',ac_cellular:'network',battery_preheating:'preheating',indicator_settings:'indicators',charging_source_priority:'energy_profile',grid_automation:'energy_profile',battery_automation:'energy_profile',energy_profile:'energy_profile',ac_more:'charger_options',ac_load_management:'charger_load_management',ac_output_mode:'charger_output',ac_offgrid_charging:'charger_offgrid',charger_ocpp:'charger_ocpp',charger_cards:'charger_cards',backup_history:'backup_history',backup_events:'backup_events',energy_saving:'energy_saving',aggregator_allocation:'aggregator_allocation',service_provider:'service_provider',system_about:'service_provider',solar_source_priority:'solar_priority',surplus_pv_priority:'solar_priority',charging_mode:'charger_mode'});
const acOnly=new Set(['charger_options','charger_load_management','charger_output','charger_offgrid']);
const chargerSections=new Set(['charger_schedules','charger_records','charger_ocpp','charger_cards','charger_auth','charger_mode',...acOnly]);
function device(ctx){return (ctx.inventory??[]).find(item=>[item.id,item.serial,item.serial_number,item.serialNumber].some(value=>value!=null&&String(value)===String(ctx.id)));}
export function presetTarget(route,ctx={}){
  const section=PRESET_ROUTES[route];if(!section)return null;
  // Editable native settings use their normal revision-checked reader. If a
  // new provider schema cannot be edited, retain a bounded read-only view.
  if(['solar_source_priority','surplus_pv_priority','charging_mode'].includes(route)&&!ctx.ownerConfiguration?.error)return null;
  const target={section};
  if(chargerSections.has(section)||section==='network'){
    let selected=device(ctx);
    if(!selected&&ctx.id!=null&&ctx.id!=='')return null;
    const kinds=section==='network'?['inverter','ac']:acOnly.has(section)?['ac']:['ac','dc'];
    if(!selected){let rows=(ctx.inventory??[]).filter(item=>kinds.includes(item.type)&&item.installed!==false);if(section==='network'&&rows.filter(item=>item.type==='inverter').length===1)rows=rows.filter(item=>item.type==='inverter');if(rows.length===1)selected=rows[0];}
    if(!selected||selected.installed===false||!kinds.includes(selected.type))return null;
    target.serial=selected.serial??selected.serial_number??selected.serialNumber??selected.id;
  }
  if(section==='profile'){const id=Number(ctx.id);if(!Number.isSafeInteger(id)||id<=0)return null;target.profile_id=id;}
  return target;
}
const labels={ruleStatus:'Status',ruleCondition:'Condition',ruleEffect:'Action',ruleName:'Name',personalizationRuleName:'Name',customDisplayName:'Display name',priority:'Priority',name:'Name',startTime:'From',endTime:'Until',whichDay:'Days',isNextDay:'Continues next day',chargeMode:'Charging mode',open:'Enabled',chargeSOC:'Charging cut-off (%)',dischargeSOC:'Discharging cut-off (%)',backupSOC:'Backup reserve (%)',batteryMaxChargingPower:'Battery charging limit (kW)',batteryMaxDischargingPower:'Battery discharging limit (kW)',powerLimit:'Solar limit (kW)',maxBuyPower:'Import limit (kW)',maxSellPower:'Export limit (kW)',buyPrice:'Buying price',sellPrice:'Selling price',currencyCode:'Currency',planName:'Plan',providerName:'Provider',activeStatus:'Active status',batteryGlobalActive:'Battery automation enabled',gridGlobalActive:'Grid automation enabled',ruleConditionType:'Condition type'};
const fieldLabel=key=>labels[key]??key.replace(/([a-z\d])([A-Z])/g,'$1 $2').replaceAll('_',' ').replace(/^./,s=>s.toUpperCase());
const hidden=new Set(['stationId','profileId','personalizationRuleId']);
export function nativeFields(value,depth=0){
  if(depth>12)return note('Additional details could not be displayed.');
  if(value===null||value===undefined)return '<span>—</span>';
  if(typeof value==='boolean')return esc(value?'Enabled':'Disabled');
  if(typeof value!=='object')return esc(String(value)==='4294967.295'?'System maximum':value);
  if(Array.isArray(value))return value.length?value.map(item=>`<div class="detail-section">${nativeFields(item,depth+1)}</div>`).join(''):note('None configured');
  const entries=Object.entries(value).filter(([key])=>!hidden.has(key)&&!['__proto__','constructor','prototype'].includes(key)&&!/password|passwd|secret|token|credential|authorization|privatekey|certificate/i.test(key));
  return entries.length?`<dl class="detail-meta">${entries.map(([key,item])=>`<dt>${esc(fieldLabel(key))}</dt><dd>${nativeFields(item,depth+1)}</dd>`).join('')}</dl>`:note('No additional settings returned');
}
const heading=title=>`<h3 class="detail-section">${esc(title)}</h3>`;
const weekdays=days=>Array.isArray(days)?days.map(day=>['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][Number(day)-1]??String(day)).join(', '):days;
const minuteTime=value=>Number.isInteger(value)&&value>=0&&value<1440?`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`:value;
export function renderPlantTariffs(value){
  const plan=object(value?.plan),tariffs=object(plan.buySellTariff),currency=object(value?.currency);
  const unit=currency.currencyMinName||currency.areaCurrencyMinName||currency.currencyCode||currency.areaCurrencyCode||'';
  const rate=number=>`${String(number??'—')} ${unit}/kWh`;
  const periods=items=>(items??[]).map(period=>group((period.monthRange?heading(`Months ${period.monthRange}`):'')+(period.weekPrices??[]).map(week=>
    `<div class="detail-section">${week.weekRange?note(`Weekdays ${week.weekRange}`):''}<dl class="detail-meta">${(week.timeRange??[]).map(item=>`<dt>${esc(item.timeRange??'All day')}</dt><dd>${esc(rate(item.price))}</dd>`).join('')}</dl></div>`).join(''))).join('');
  const side=(title,item)=>{
    const config=object(item?.staticConfig),dated=Array.isArray(config.pricePeriods)?config.pricePeriods:[];
    const prices=dated.length?dated.map(period=>`${period.startDate?heading(`From ${period.startDate}`):''}${periods(period.combinedPrices)}`).join(''):periods(config.combinedPrices);
    return heading(title)+nativeFields({providerName:config.providerName??null,planName:config.planName??null})+(prices||nativeFields(item));
  };
  if(!Object.keys(tariffs).length)return nativeFields(value);
  return nativeFields({currencyCode:currency.currencyCode??currency.areaCurrencyCode??null})+side('Buying',tariffs.buyTariff)+side('Selling',tariffs.sellTariff)+`<details class="detail-section"><summary>Taxes and fees</summary>${nativeFields(value?.taxes_and_fees)}</details>`;
}
function preheating(value){
  const data=object(value),windows=Array.isArray(data.packPreheatingVOList)?data.packPreheatingVOList:[];
  return nativeFields({enabled:data.packPreheatingSwitch===0?false:data.packPreheatingSwitch===1?true:null,mode:data.preheatingMode??null})+
    windows.map(item=>group(nativeFields({startTime:minuteTime(item.startTime),duration:item.duration==null?null:`${item.duration} minutes`,days:weekdays(item.periodConfig),...(item.chargingPower!==''?{chargingPower:item.chargingPower}:{}),...(item.dischargePower!==''?{dischargePower:item.dischargePower}:{})}))).join('');
}
export function nativeHistoryPage(value,page=1){
  const document=object(value?.backupHistoryDetailVOIpage??value),pages=Number(document.pages),total=Number(document.total);
  const count=Number.isSafeInteger(pages)&&pages>=0?Math.max(1,pages):Number.isSafeInteger(total)&&total>=0?Math.max(1,Math.ceil(total/50)):1;
  if(count<=1)return '';
  return `<div class="settings-actions native-history-pages"><button type="button" class="settings-secondary" data-native-config-page="${page-1}"${page<=1?' disabled':''}>Previous</button><span>Page ${esc(page)} of ${esc(count)}</span><button type="button" class="settings-secondary" data-native-config-page="${page+1}"${page>=count?' disabled':''}>Next</button></div>`;
}
export function normalizeChargingRecords(value,kind){
  if(!Array.isArray(value?.records))return null;
  const timestamp=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<8640000000000?new Date(value*1000).toISOString():null;
  const records=value.records.map(item=>({
    started_at:timestamp(item.chargingStartTime),ended_at:timestamp(item.chargingEndTime),
    charged_kwh:typeof item.singleChargingPower==='number'&&item.singleChargingPower>=0?item.singleChargingPower:null,
    discharged_kwh:typeof item.singleDischargeEnergy==='number'&&item.singleDischargeEnergy>=0?item.singleDischargeEnergy:kind==='ac'?0:null,
  }));
  return {available:true,complete:Number(value.total)===records.length,records};
}
function source(ctx,target){const state=ctx.plantConfiguration;if(!state||state.section!==target.section||state.route!==ctx.route||String(state.id??'')!==String(ctx.id??''))return {loading:true};return state;}
export function renderPreset(route,ctx={},base){
  if(!ctx.plantConfiguration&&ctx.state?.('control_status')?.attributes?.control_api_version!==1)return null;
  const target=presetTarget(route,ctx);if(!target)return null;
  const state=source({...ctx,route},target),value=state.value;
  const empty=state.loading?note('Reading plant configuration…'):state.error?note(state.error):value===undefined?note('Plant configuration could not be read.'):null;
  if(route==='strategies'){
    const rules=Array.isArray(value?.rules)?value.rules:null;
    const native=empty??(rules?.length?group(rules.map((item,index)=>row(item.customDisplayName||item.personalizationRuleName||`Preference ${index+1}`,'plant_strategy',String(item.personalizationRuleId),[item.ruleCondition,item.ruleEffect].filter(Boolean).join(' · '))).join('')):rules?note('No personal strategies in this operating mode.'):note('The plant strategy list could not be read.'));
    const tc=base?.body??'';
    return {title:'Personal strategies',body:heading('Sigenergy plant strategies')+native+heading('Home Assistant schedules')+tc};
  }
  if(route==='plant_strategy'){
    const item=value?.rules?.find(item=>String(item.personalizationRuleId)===String(ctx.id));
    const details=item?{name:item.customDisplayName||item.personalizationRuleName,ruleCondition:item.ruleCondition,ruleEffect:item.ruleEffect,priority:item.priority}:null;
    return {title:item?.customDisplayName||item?.personalizationRuleName||'Plant personal strategy',body:empty??(details?nativeFields(details):note('This plant strategy is no longer available.'))};
  }
  if(route==='plant_profiles')return {title:titles.profiles,body:empty??(value?.profiles?.length?group(value.profiles.map(item=>row(item.name||'Operating profile','plant_profile',item.profileId)).join('')):note('No custom operating profiles configured.'))};
  if(route==='charger_schedules'){
    const schedules=Array.isArray(value)?value:null;
    const native=empty??(schedules?.length?schedules.map(item=>group(nativeFields(item))).join(''):schedules?note('No plant charging schedules.'):note('The plant schedule list could not be read.'));
    return {title:'Charging schedules',body:heading('Sigenergy plant schedules')+native+heading('Home Assistant drafts')+(base?.body??'')};
  }
  if(route==='tariffs')return {title:base?.title??'Tariff plan',body:heading('Sigenergy tariff plan')+(empty??renderPlantTariffs(value))+heading('Home Assistant tariffs')+(base?.body??'')};
  if(route==='system_about')return {...base,body:(base?.body??'')+heading('Service provider')+(empty??nativeFields(value))};
  if(route==='network')return {title:base?.title??'Network',body:(empty??nativeFields(value))+(base?.body??'')};
  if(route==='ac_more'){
    const item=device(ctx),parameters=object(value?.parameters);
    const updated=item?{...item,model:parameters.deviceModel??item.model,software_version:parameters.acevseFirmwareVersion??item.software_version,rated_power_kw:parameters.ratedPower??item.rated_power_kw,parameters:{...item.parameters,communication_status:parameters.communicateStatus===2?'Online':parameters.communicateStatus}}:null;
    const model=updated&&ctx.renderBase?ctx.renderBase({...ctx,inventory:ctx.inventory.map(row=>row===item?updated:row)}):base;
    return {...model,body:(model?.body??'')+heading('Current charger configuration')+(empty??nativeFields(value?.settings??value))};
  }
  if(route==='ac_connectivity')return {title:'Connectivity',body:(empty??nativeFields(value))+group(row('Ethernet','ac_ethernet',ctx.id)+row('WLAN','ac_wlan',ctx.id)+row('Cellular','ac_cellular',ctx.id))};
  if(['ac_ethernet','ac_wlan','ac_cellular'].includes(route)){
    const pattern=route==='ac_ethernet'?/ethernet|fe|ipAddress|subnetMask|gateWay/i:route==='ac_wlan'?/wifi|wlan/i:/cellular|sim/i;
    return {title:base?.title??'Network',body:empty??nativeFields(Object.fromEntries(Object.entries(object(value)).filter(([key])=>pattern.test(key))))};
  }
  if(route==='charger_records'){
    if(empty)return {title:'Charging records',body:empty};
    const selected=device(ctx),data=normalizeChargingRecords(value,selected?.type),page=state.page??1;
    if(data&&ctx.renderBase){
      const updated={...selected,charging_records:data},model=ctx.renderBase({...ctx,inventory:ctx.inventory.map(item=>item===selected?updated:item)});
      const unknown=data.records.some(item=>!item.started_at);
      return {...model,body:model.body+nativeHistoryPage(value,page)+(unknown?`<details class="detail-section"><summary>Additional native record details</summary>${nativeFields(value.records)}</details>`:'')};
    }
    return {title:'Charging records',body:(data?(data.records.length?value.records.map(item=>group(nativeFields(item))).join(''):note('No charging records.')):note('Charging records could not be read.'))+nativeHistoryPage(value,page)};
  }
  if(['backup_history','backup_events'].includes(route))return {title:base?.title??'Backup history',body:empty??(nativeFields(value)+nativeHistoryPage(value,state.page??1))};
  if(route==='battery_preheating')return {title:base?.title??'Battery preheating',body:empty??preheating(value)};
  if(route==='indicator_settings')return {title:'Indicator lights',body:empty??(heading('Front')+nativeFields(value?.front)+heading('LED strips')+nativeFields(value?.strips))};
  if(route==='energy_profile')return {title:base?.title??'My Energy Profile',body:(base?.body??'')+group(row('Plant operating profiles','plant_profiles'))+`<details class="detail-section"><summary>Current plant configuration</summary>${empty??nativeFields(value)}</details>`};
  const selected={charging_source_priority:value?.batteryAutomationGroupVOList,grid_automation:{enabled:value?.gridGlobalActive,groups:value?.gridAutomationGroupVOList},battery_automation:{enabled:value?.batteryGlobalActive,groups:value?.batteryAutomationGroupVOList}};
  return {title:base?.title??titles[target.section],body:empty??nativeFields(Object.hasOwn(selected,route)?selected[route]:value)};
}
