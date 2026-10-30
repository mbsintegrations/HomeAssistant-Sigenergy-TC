/* SPDX-License-Identifier: GPL-3.0-only */
import { renderDeviceDetail, solarStringSeries, DETAIL_STYLE } from './sigen-hybrid-details.js?v=0.1.0';
import { renderSettingsDetail, collectSettings, SETTINGS_STYLE, SETTINGS_ROUTES, CHART_CHOICES, DEFAULT_CHART_SELECTION, DISPLAY_MODULES, DISPLAY_PRESETS, HOMEPAGE_APPEARANCES, HOMEPAGE_BACKGROUNDS, homepageBackground, displayDefaults, encodeChargerScheduleId, decodeChargerScheduleId, bindTariffEditor, bindStrategyEditor, OPERATING_MODES, observedOperatingMode, renderOverviewModeControl, strategyExportEligibility } from './sigen-hybrid-settings.js?v=0.1.0';
import { periodRange, dateAt, shiftDate, toCSV, preserveChartScroll } from './sigen-hybrid-charts.js?v=0.1.0';
import { renderSummaryWidget, renderSummaryDetail, WIDGET_ROUTES, WIDGET_STYLE } from './sigen-hybrid-widgets.js?v=0.1.0';
import { ENERGY_ROUTES, renderEnergyProfile, ENERGY_STYLE } from './sigen-hybrid-energy.js?v=0.1.0';
import { renderChargingEnergy, renderTodayEnergy, renderBatteryLevel, renderMobilePower, renderChargerControls } from './sigen-hybrid-overview.js?v=0.1.0';
import { modeChoices, selectedMode, nativeModeChoices } from './sigen-hybrid-settings.js?v=0.1.0';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);

export const CARD_PRESETS=Object.freeze([
 ['overview','Full dashboard','Dashboard'],['photo','Photo house','Scenes'],['house','House','Scenes'],['flow','Simple energy flow','Scenes'],
 ['power_summary','Live power tiles','Summaries'],['energy_today',"Today's energy",'Summaries'],['energy_summary','Solar, consumption & battery rings','Summaries'],['battery','Battery & optional controls','Devices'],['solar','Solar production','Devices'],['grid','Grid import / export','Devices'],['ac','AC charger','Devices'],['dc','DC charger','Devices'],['devices','Device overview','Devices'],['optimizers','Panel optimizers','Devices'],
 ['forecast_summary','Solar forecast summary','Forecast'],['controls','Battery & charger controls','Controls'],['quick_controls','Compact battery controls','Controls'],['mode_control','Operating mode & strategies','Controls'],['connections_card','Connection status','System'],['statistics','Energy flow breakdown','Energy'],['production','Solar energy totals','Energy'],['consumption','Consumption totals','Energy'],['energy_value','Energy value','Energy'],['chart','Individual history chart','Charts']
]);
export const CARD_CHART_CHOICES=CHART_CHOICES;
export function presetCardConfiguration(base,key){
 const chart=key.startsWith('chart:')?key.slice(6):null,view=chart?'chart':key,preset=CARD_PRESETS.find(([id])=>id===view);
 if(!preset||chart&&!CHART_CHOICES.some(([id])=>id===chart))throw new Error('Choose a supported card');
 const card={...base,type:'custom:sigen-hybrid-card',view,title:chart?CHART_CHOICES.find(([id])=>id===chart)[1]:preset[1],show_preview_controls:false};
 delete card.snapshot_at;delete card.embed_mode;delete card.embedded;
 if(chart)card.chart_kind=chart;
 if(view!=='overview')card.card_layout='compact';else delete card.card_layout;
 return card;
}
const sankeyGeometry=new WeakMap();
export function fitSankeyWidth(svg){
  const bounds=svg.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
  let original=sankeyGeometry.get(svg);
  if(!original){original=[...svg.querySelectorAll('path[d],rect,text')].map(node=>({node,d:node.getAttribute('d'),x:node.getAttribute('x'),width:node.tagName.toLowerCase()==='rect'?node.getAttribute('width'):null}));sankeyGeometry.set(svg,original);}
  const width=480*bounds.width/bounds.height,factor=width/700;
  svg.setAttribute('viewBox',`0 0 ${width} 480`);
  for(const {node,d,x,width:box} of original){
    if(d){let index=0;node.setAttribute('d',d.replace(/-?\d+(?:\.\d+)?/g,value=>String(index++%2===0?Number(value)*factor:Number(value))));}
    if(x!==null)node.setAttribute('x',String(Number(x)*factor));
    if(Number(box)===120)node.setAttribute('width',String(120*factor));
  }
}
const DEVICE_ROUTES = new Set(['solar','load','battery','battery_module','inverter','gateway','grid','ac','dc','optimizer','strings','devices','forecast','weather','battery_energy','plant','alerts','alert_history','alert_detail','system_about','software_update','warranty','warranty_download','care','sigen_care','diagnosis','diagnosis_history','diagnosis_detail','modbus_server','support_history','service','messages','message_detail']);
const CHARTS = {
  power:[['solar_power','Solar','#efc900'],['battery_power','Battery','#26c9c8',-1],['grid_power','Grid','#6694ff'],['home_power','Load','#a45bf0',-1],['ac_power','EVAC','#b46767',-1],['dc_power','EVDC','#d29420',-1]],
  solar:[['solar_power','Solar','#efc900']], load:[['home_power','Load','#a45bf0']],
  battery:[['battery_power','Battery','#26c9c8',-1]], grid:[['grid_power','Grid','#6694ff']],
  ac:[['ac_power','AC charger','#b46767']],dc:[['dc_power','DC charger','#d29420']],soc:[['battery_soc','Battery SOC','#26c9c8']],
  price:[['buy_price','Buying price','#efc900'],['sell_price','Selling price','#f79a53'],['battery_soc','Battery SOC','#26c9c8']],
  battery_temperature:[['battery_temperature','Battery temperature','#26c9c8']],
  battery_soh:[['battery_soh','Battery state of health','#26c9c8']],
  inverter_power:[['inverter_power','Inverter output','#6694ff']],
  inverter_temperature:[['inverter_temperature','Inverter temperature','#f79a53']],
  grid_frequency:[['grid_frequency','Grid frequency','#6694ff']],
  grid_voltage:['l1','l2','l3'].map((phase,i)=>[`grid_${phase}_voltage`,phase.toUpperCase(),['#6694ff','#26c9c8','#a45bf0'][i]]),
  grid_current:['l1','l2','l3'].map((phase,i)=>[`grid_${phase}_current`,phase.toUpperCase(),['#6694ff','#26c9c8','#a45bf0'][i]]),
  grid_reactive:[['grid_total_reactive_power','Total reactive power','#6694ff'],...['l1','l2','l3'].map((phase,i)=>[`grid_${phase}_reactive_power`,phase.toUpperCase(),['#6694ff','#26c9c8','#a45bf0'][i]])],
  pv_voltage:[['pv1_voltage','String 1','#efc900'],['pv2_voltage','String 2','#26c9c8']],
  pv_current:[['pv1_current','String 1','#efc900'],['pv2_current','String 2','#26c9c8']],
  dc_voltage:[['dc_voltage','DC charger voltage','#d29420']],
  dc_current:[['dc_current','DC charger current','#d29420']],
  dc_soc:[['dc_vehicle_soc','Vehicle SOC','#d29420']],
  dc_metrics:[['dc_power','DC charging power','#d29420'],['dc_voltage','Voltage','#6694ff'],['dc_current','Current','#26c9c8']],
  pv_metrics:[['pv1_voltage','String 1 voltage','#efc900'],['pv2_voltage','String 2 voltage','#f79a53'],['pv1_current','String 1 current','#26c9c8'],['pv2_current','String 2 current','#6694ff']],
};
export const CHART_CATALOG=CHART_CHOICES;
const ENGINEERING_UNITS={temperature:{'°C':['°C',1],C:['°C',1]},voltage:{V:['V',1],mV:['V',.001],kV:['V',1000]},current:{A:['A',1],mA:['A',.001]},frequency:{Hz:['Hz',1],kHz:['Hz',1000]},reactive:{var:['kVar',.001],Var:['kVar',.001],kvar:['kVar',1],kVar:['kVar',1],Mvar:['kVar',1000],MVar:['kVar',1000]}};
export const CHART_GROUPS=Object.freeze([
  ['System overview',['power']],
  ['Solar & inverter',['solar','pv_metrics','inverter_power','inverter_temperature','forecast','strings','pv_voltage','pv_current']],
  ['Home consumption',['load']],
  ['Battery',['battery','soc','battery_temperature','battery_soh']],
  ['Grid',['grid','grid_voltage','grid_current','grid_frequency','grid_reactive']],
  ['Chargers',['ac','dc','dc_metrics','dc_voltage','dc_current','dc_soc']],
  ['Tariffs & battery SOC',['price']],
].map(([label,kinds])=>Object.freeze([label,Object.freeze(kinds)])));
function engineeringUnit(key,unit){
  if(['battery_soc','battery_soh','dc_vehicle_soc'].includes(key))return unit==='%'?['%',1]:null;
  const group=key.endsWith('_reactive_power')?'reactive':key.endsWith('_temperature')?'temperature':key.endsWith('_voltage')?'voltage':key.endsWith('_current')?'current':key.endsWith('_frequency')?'frequency':null;
  return group?(ENGINEERING_UNITS[group][unit]??null):null;
}
export function availableCharts(card){
  const saved=card._detailContext?.().interfaceOptions?.chart_settings;
  let selection=Array.isArray(card._config?.chart_selection)?card._config.chart_selection:DEFAULT_CHART_SELECTION;
  if(saved?.route==='chart_settings'&&saved.local_only===true){try{selection=collectSettings('chart_settings',saved).selected;}catch{}}
  return CHART_CATALOG.filter(([kind])=>selection.includes(kind)).filter(([kind])=>kind==='strings'?solarStringSeries({inventory:card._config?.devices,entities:card._entities}).length>0:kind==='forecast'?historySeries(card,'forecast').some(line=>line.points.length):kind==='pv_metrics'?CHARTS.pv_metrics.some(([key])=>card._entities[key])||solarStringSeries({inventory:card._config?.devices,entities:card._entities}).length>0:CHARTS[kind]?.some(([key])=>card._entities[key])||Boolean(card._config?.config_entry)&&['power','solar','load','battery','grid','soc','price','ac','dc','dc_metrics'].includes(kind));
}
export function mergeHistorySeries(local=[],cloud=[],{binMs=300000}={}){
  const result=new Map();
  for(const line of [...cloud,...local]){
    const identity=`${line.key}:${line.unit}`,previous=result.get(identity),points=new Map((previous?.points??[]).map(point=>[Math.floor(point.time/binMs),{...point}]));
    for(const point of line.points??[]){if(!Number.isFinite(point.time))continue;const bin=Math.floor(point.time/binMs),known=points.get(bin);if(Number.isFinite(point.value)||!known||known.value===null)points.set(bin,{...point});}
    result.set(identity,{...previous,...line,points:[...points.values()].sort((a,b)=>a.time-b.time)});
  }
  const lines=[...result.values()],recorded=line=>line.points.some(point=>Number.isFinite(point.time)&&Number.isFinite(point.value));
  const recordedKeys=new Set(lines.filter(recorded).map(line=>line.key));
  // An unmapped native rate has no authoritative currency. Its empty legend
  // must not duplicate a measured Cloud rate with an actual currency unit.
  return lines.filter(line=>recorded(line)||!recordedKeys.has(line.key));
}
const detailHistoryCache = new Map();
const cloudHistoryCache = new Map();
const historyConnections=new WeakMap();let historyConnectionSerial=0;
function historyConnectionKey(card){const connection=card._hass?.connection??card._hass;if(!connection||typeof connection!=='object')return 'offline';if(!historyConnections.has(connection))historyConnections.set(connection,++historyConnectionSerial);return historyConnections.get(connection);}
let draftSerial = 0;
const SEARCH_CATEGORIES=[['all','All'],['alerts','Alerts'],['functions','Function settings'],['help','Help resources'],['forum','Forum']];
const SEARCH_FUNCTIONS=[['settings','Settings'],['display_settings','Homepage appearance'],['mode','Operating mode'],['tariffs','Buying & selling tariffs'],['strategies','Personal strategies'],['priority','Battery discharge priority'],['vehicles','My vehicles'],['safety','Safety & owner limits'],['forecast_settings','Solar forecast settings'],['ai_settings','AI connection settings'],['ai','Energy assistant'],['network','Network'],['maintenance','Maintenance'],['add_device','Add system device'],['energy_value','Energy value'],['environment','Environmental benefits'],['revenue_calendar','Revenue calendar'],['diagnosis','System diagnosis'],['software_update','Software update'],['warranty','Warranty'],['care','Care services'],['system_settings','System settings'],['system_details','System details'],['app_settings','App preferences'],['indicator_settings','Indicator lights'],['devices','System devices'],['plant','Plant information'],['weather','Weather'],['battery_energy','Battery energy'],['data_download','Data download'],['system_share','System sharing'],['modbus_server','Modbus server'],['support_history','Support history'],['service','Service'],['messages','Messages'],['ac_more','AC charger settings'],['dc_more','DC charger settings']];
const SEARCH_RESOURCES=[['Learning centre','https://sigenergy.com/en/support/learn'],['Download centre','https://sigenergy.com/en/support/download-center'],['Frequently asked questions','https://sigenergy.com/en/faqs'],['Warranty information','https://sigenergy.com/en/support/warranty'],['Sigen Care','https://sigenergy.com/en/support/sigencare'],['mySigen app','https://sigenergy.com/en/products/mysigen-app']];
SEARCH_FUNCTIONS.push(...ENERGY_ROUTES.map(route=>[route,renderEnergyProfile(route).title]));
SEARCH_FUNCTIONS.push(['charging_energy','Charging energy today']);
export function savedDisplaySettings(ctx={}){
  const saved=ctx.interfaceOptions?.display_settings;
  if(!saved||saved.route!=='display_settings'||saved.local_only!==true)return null;
  try{return collectSettings('display_settings',saved,ctx);}catch{return null;}
}
export function moveDisplayModule(order,key,position){
  const keys=DISPLAY_MODULES.map(item=>item.key);
  if(!Array.isArray(order)||order.length!==keys.length||new Set(order).size!==keys.length||order.some(item=>!keys.includes(item))||!order.includes(key)||!Number.isInteger(position))return null;
  const result=order.filter(item=>item!==key);result.splice(Math.max(0,Math.min(result.length,position)),0,key);return result;
}
export function searchCatalogue(ctx={}){
  const entries=SEARCH_FUNCTIONS.filter(([route])=>SETTINGS_ROUTES.includes(route)||ENERGY_ROUTES.includes(route)||DEVICE_ROUTES.has(route)||['system_share','data_download'].includes(route)).map(([route,label])=>({key:`route:${route}`,category:'functions',label,route}));
  entries.push({key:'help:about',category:'help',label:'About this integration',route:'about'},{key:'help:connections',category:'help',label:'Accounts & connections',route:'connections'});
  entries.push(...SEARCH_RESOURCES.map(([label,href])=>({key:`help:${href}`,category:'help',label,href,subtitle:'Sigenergy'})));
  const kinds={battery_system:'battery',batterysystem:'battery',battery_module:'battery_module',batterymodule:'battery_module',battery:'battery_module',inverter:'inverter',energycontroller:'inverter',gateway:'gateway',energygateway:'gateway',solar:'solar',pv:'solar',string:'strings',pvstring:'strings',ac:'ac',accharger:'ac',dc:'dc',dccharger:'dc'};
  for(const [index,item] of (Array.isArray(ctx.inventory)?ctx.inventory:[]).entries()){
    const type=String(item?.type??item?.kind??'').toLowerCase(),normalized=type.replace(/[ _-]/g,''),route=Object.hasOwn(kinds,type)?kinds[type]:Object.hasOwn(kinds,normalized)?kinds[normalized]:null;
    if(!route)continue;
    const id=item.id??item.serial??item.serial_number??item.serialNumber;
    entries.push({key:`device:${id??index}`,category:'functions',label:String(item.name??item.model??type),subtitle:item.model?String(item.model):'Device',route,...(id!==undefined&&id!==null?{id:String(id)}:{})});
  }
  for(const [index,item] of (Array.isArray(ctx.optimizers)?ctx.optimizers:[]).entries()){
    if(!item||typeof item.power!=='string'||!/^sensor\.[a-z0-9_]+$/.test(item.power))continue;
    let reading;try{reading=ctx.state?.(item.power);}catch{}if(!reading)continue;
    entries.push({key:`panel:${item.id??item.power}`,category:'functions',label:String(item.name??`Panel ${index+1}`),subtitle:String(item.string??'Panel monitoring'),route:'optimizer',id:String(item.id??item.power)});
  }
  const seen=new Set();
  for(const [key,id] of Object.entries(ctx.entities??{})){
    if(typeof id!=='string'||!/^(sensor|binary_sensor|weather)\.[a-z0-9_]+$/.test(id)||seen.has(id))continue;
    let reading;try{reading=ctx.state?.(key);}catch{}
    if(!reading)continue;seen.add(id);
    const unit=reading.attributes?.unit_of_measurement??'';
    entries.push({key:`entity:${id}`,category:'functions',label:String(reading.attributes?.friendly_name??key.replaceAll('_',' ')),subtitle:[reading.state,unit].filter(value=>value!==undefined&&value!=='').join(' '),terms:`${key} ${id}`,route:'sensor',id:key});
  }
  const alerts=Array.isArray(ctx.config?.alerts_active)?ctx.config.alerts_active:Array.isArray(ctx.config?.alerts)?ctx.config.alerts:[];
  for(const [index,alert] of alerts.entries()){
    const label=alert?.title??alert?.name??alert?.code;if(label===undefined||label===null)continue;
    entries.push({key:`alert:${index}`,category:'alerts',label:String(label),subtitle:String(alert.message??alert.severity??''),route:'alerts'});
  }
  return entries;
}
export function searchMatches(entries,query='',category='all'){
  const text=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const terms=text(query).trim().split(/\s+/).filter(Boolean);
  return (Array.isArray(entries)?entries:[]).filter(item=>(category==='all'||item.category===category)&&terms.every(term=>text(`${item.label} ${item.subtitle??''} ${item.terms??''}`).includes(term))).slice(0,80);
}
function searchRows(ctx,query,category){
  const found=searchMatches(searchCatalogue(ctx),query,category);
  return found.length?found.map(item=>{const content=`<span><strong>${escape(item.label)}</strong>${item.subtitle?`<small>${escape(item.subtitle)}</small>`:''}</span><span aria-hidden="true">${item.href?'':'›'}</span>`;return item.href?`<a class="search-result" href="${escape(item.href)}" target="_blank" rel="noopener noreferrer">${content}</a>`:`<button type="button" class="search-result" data-detail="${escape(item.route)}"${item.id===undefined?'':` data-id="${escape(item.id)}"`}>${content}</button>`;}).join(''):'<p class="detail-empty">No results</p>';
}
function searchPage(ctx,selection={}){
  const query=String(selection.query??'').slice(0,160),category=SEARCH_CATEGORIES.some(([key])=>key===selection.category)?selection.category:'all';
  return {title:'Search',body:`<section class="detail-search"><label class="search-input"><span class="sr-only">Search your system</span><input type="search" data-search-input value="${escape(query)}" maxlength="160" placeholder="Search devices, metrics and settings"></label><div class="search-categories">${SEARCH_CATEGORIES.map(([key,label])=>`<button type="button" data-search-category="${key}" aria-pressed="${key===category}">${label}</button>`).join('')}</div><button type="button" class="search-assistant" data-detail="ai">Energy assistant </button><div class="search-results" aria-live="polite">${searchRows(ctx,query,category)}</div></section>`};
}
export function withServiceNavigation(content,active='overview'){
  return content.replace(/<nav\b([^>]*)>([\s\S]*?)<\/nav>/,(_,attributes,buttons)=>{
    const classes=/\bclass="([^"]*)"/.exec(attributes),className=[classes?.[1],'energy-tab-strip'].filter(Boolean).join(' ');
    const attrs=classes?attributes.replace(classes[0],`class="${className}"`):attributes+` class="${className}"`;
    const extra=[['settings','Settings']].filter(([route])=>!buttons.includes(`data-tab="${route}"`)).map(([route,label])=>`<button type="button" data-tab="${route}" aria-pressed="${active===route}">${label}</button>`).join('');
    return `<nav${attrs}>${buttons}${extra}</nav>`;
  });
}
// A charger's own lifetime may predate this plant. Only aligned plant counters
// belong in the plant-wide lifetime balance.
const ENERGY_COUNTERS={solar_today:'solar_lifetime',home_today:'home_lifetime',battery_charge_today:'battery_charge_lifetime',battery_discharge_today:'battery_discharge_lifetime',grid_import_today:'grid_import_lifetime',grid_export_today:'grid_export_lifetime',ac_today:'ac_plant_lifetime',dc_today:'dc_plant_lifetime',dc_discharge_today:'dc_discharge_lifetime'};
export function statisticsValues(card,period='day',date){
  const timezone=card._config?.timezone??card._hass?.config?.time_zone??'UTC',today=dateAt(card._now(),timezone),selectedDate=date??today;
  let periodDate=selectedDate;
  if(period==='week'){try{periodDate=dateAt(periodRange({period:'week',date:selectedDate,timezone,weekStart:card._config?.week_start??card._config?.weekStart??1}).start,timezone);}catch{periodDate='';}}
  const provided=card._config?.energy_periods?.[period]?.[periodDate];
  return Object.fromEntries(Object.entries(ENERGY_COUNTERS).map(([key,lifetime])=>{
    let value=null;
    if(period==='lifetime')value=card._value(lifetime,'energy');
    else if(period==='day'&&selectedDate===today)value=card._value(key,'energy');
    else if(provided&&typeof provided==='object')value=numeric(provided[key]);
    return [key,value!==null&&Number.isFinite(value)&&value>=0?value:null];
  }));
}
const chartTitle = key => ({power:'Power Metrics Chart',solar:'Solar Production & Forecast',strings:'PV Strings',load:'Load',battery:'Battery Discharge & Charge',grid:'Grid Imported / Exported',soc:'Battery SOC',price:'Battery SOC & Price Trend',forecast:'Solar Forecast',ac:'AC Charger',dc:'DC Charging Power',dc_voltage:'DC Voltage',dc_current:'DC Current',dc_soc:'Vehicle SOC',optimizer:'Panel Power'}[key] ?? CHART_CATALOG.find(([kind])=>kind===key)?.[1] ?? 'History');
const epoch = value => typeof value === 'number' ? (value < 1e11 ? value * 1000 : value) : Date.parse(value);
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
export function refreshedChartData(previous, fresh, kind) {
  if(!previous)return fresh;
  const selected=previous.period!=='day'||previous.date!==fresh.date;
  const futureForecast=kind==='forecast'&&previous.period==='day'&&previous.date>=fresh.date;
  return {...fresh,...previous,title:fresh.title,series:selected&&!futureForecast?previous.series:fresh.series,
    now:fresh.now,load:fresh.load,sunrise:fresh.sunrise,sunset:fresh.sunset,maxFuture:fresh.maxFuture};
}
const qty = (card,key,n) => {
  const state=card._state(key),unit=state?.attributes?.unit_of_measurement;
  if (!Number.isFinite(n)) return null;
  const engineering=engineeringUnit(key,unit);
  if(engineering)return n*engineering[1];
  if(['battery_soc','battery_soh','dc_vehicle_soc'].includes(key)||/_(temperature|voltage|current|frequency|reactive_power)$/.test(key))return null;
  if(key.endsWith('_price'))return /^(EUR|USD|GBP|€|\$|£)\/kWh$/.test(unit??'')?n:/^(c|ct|cent|cents|p)\/kWh$/.test(unit??'')?n/100:null;
  return unit==='kW'?n:unit==='W'?n/1000:unit==='MW'?n*1000:null;
};
export function routeForEntity(key) {
  if (/^(solar|pv)_/.test(key)) return 'solar';
  if (/^(home|load)_/.test(key)) return 'load';
  if (/^battery_/.test(key)) return 'battery';
  if (/^grid_/.test(key)) return 'grid';
  if (/^ac_/.test(key)) return 'ac';
  if (/^dc_/.test(key)) return 'dc';
  if (/forecast/.test(key)) return 'forecast';
  if (/mode/.test(key)) return 'mode';
  if (/price|tariff/.test(key)) return 'tariffs';
  if(key==='export_permitted')return 'safety';
  return 'sensor';
}
export function historySeries(card, kind, rows=card._history) {
  if(kind==='pv_metrics')return [...historySeries(card,'strings',rows),...historySeries(card,'pv_voltage',rows),...historySeries(card,'pv_current',rows)].map(line=>({...line,label:line.label+' ('+line.unit+')'}));
  const configuredStart=Date.parse(card._config?.history_start??''),inRecording=time=>!Number.isFinite(configuredStart)||time>=configuredStart;
  if(kind==='forecast'){const source=card._state('forecast_today');if(card._scopedHistory||!source||['unknown','unavailable'].includes(source.state)||source.attributes?.available===false)return [];return [{key:'forecast',label:'Forecast',color:'#92a0b1',forecast:true,dash:'6 5',unit:'kW',points:(source.attributes?.series??card._config?.forecast_series??[]).map(p=>({time:epoch(p.start),value:numeric(p.power_kw)})).filter(p=>Number.isFinite(p.time))}];}
  if(kind==='strings')return solarStringSeries({inventory:card._config?.devices,entities:card._entities}).map((source,index)=>{
    const factor=({W:.001,kW:1,MW:1000})[card._hass?.states[source.entity_id]?.attributes?.unit_of_measurement];
    const points=factor===undefined?[]:(rows?.[source.entity_id]??[]).map(row=>{const raw=numeric(row.mean??row.state),value=raw===null?null:raw*factor;return {time:epoch(row.start??row.last_changed),value:value!==null&&Number.isFinite(value)?value:null};}).filter(point=>Number.isFinite(point.time)&&inRecording(point.time));
    return {key:`string:${source.entity_id}`,label:source.name,color:['#efc900','#26c9c8','#6694ff','#a45bf0'][index%4],unit:'kW',points};
  });
  const definitions=kind==='optimizer' ? [['__optimizer','Panel power','#26c9c8']] : Object.hasOwn(CHARTS,kind)?CHARTS[kind]:CHARTS.power;
  const series=definitions.filter(([key])=>key==='__optimizer'||card._entities[key]).map(([key,label,color,sign=1])=>{
    const module=(card._config?.optimizers??[]).find((m,index)=>String(m.id??index)===String(card._detailId)||m.power===card._detailId);
    const id=key==='__optimizer'?(module?.power??card._detailId):card._entities[key];
    const rawMoney=card._state(key)?.attributes?.currency??card._state(key)?.attributes?.unit_of_measurement?.split('/')[0];
    const money=/^(c|ct|cent|cents|p)$/.test(rawMoney??'')?(card._hass?.config?.currency??card._config?.currency??'Currency'):rawMoney;
    const unit=engineeringUnit(key,card._state(key)?.attributes?.unit_of_measurement)?.[0]??(key.endsWith('_price')?(({ '€':'EUR','$':'USD','£':'GBP' }[money]??money??'Currency')+'/kWh'):'kW');
    const factor=key==='__optimizer'?({W:.001,kW:1,MW:1000}[card._hass?.states[id]?.attributes?.unit_of_measurement]):null;
    const knownUnit=key==='__optimizer'?factor!==undefined:qty(card,key,0)!==null;
    const points=knownUnit?(rows?.[id]??[]).map(r=>{const n=numeric(r.mean??r.state),value=n===null?null:key==='__optimizer'?n*factor:qty(card,key,n);return {time:epoch(r.start??r.last_changed),value:value===null||!Number.isFinite(value)?null:value*sign};}).filter(p=>Number.isFinite(p.time)&&inRecording(p.time)):[];
    return {key,label,color,unit,points};
  });
  if(['solar','power'].includes(kind)&&!card._scopedHistory)series.push(...historySeries(card,'forecast',rows));
  return series;
}
const link = (route,label,id='') => `<button type="button" class="detail-link" data-detail="${escape(route)}"${id?` data-id="${escape(id)}"`:''}><span>${escape(label)}</span><span aria-hidden="true">›</span></button>`;
const totals = card => [['Solar','solar_today','solar'],['Consumption','home_today','load'],['Battery charged','battery_charge_today','battery'],['Battery discharged','battery_discharge_today','battery'],['Imported','grid_import_today','grid'],['Exported','grid_export_today','grid']].filter(([,key])=>card._has(key)).map(([label,key,route])=>`<button class="detail-total" data-detail="${route}"><small>${label}</small><strong>${card._value(key,'energy')===null?'—':escape(card._value(key,'energy').toLocaleString(undefined,{maximumFractionDigits:2})+' kWh')}</strong></button>`).join('');
const NAV_STYLE=`
.chart-catalog{display:block!important;overflow-anchor:none}.chart-category{margin:22px 0}.chart-category>h2{margin:0 0 13px;font-size:20px}.chart-category-panels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.chart-category-panels>.panel{margin:0;min-width:0}.chart-category-panels>.chart-catalog-panel:last-child:nth-child(odd){grid-column:1/-1}.chart-catalog sigen-history-chart{--sigen-chart-legend-height:64px}.chart-catalog-panel>h3{min-height:38px;margin:0 0 10px;font-size:15px}@container(max-width:800px){.chart-category-panels{grid-template-columns:minmax(0,1fr)}}.overview-preview-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:9px 18px;margin:0 0 16px;padding:1px 0}.overview-preview-group{display:flex;align-items:center;flex-wrap:wrap;gap:5px;min-width:0}.overview-preview-group>span{color:var(--muted,#657a99);font-size:11px;margin-right:3px}.overview-preview-group button,.overview-preview-reset{border:1px solid var(--line,#dbe5ef);border-radius:999px;background:var(--surface,#fff);color:inherit;min-height:32px;padding:6px 11px;font:inherit;font-size:11px;white-space:nowrap;cursor:pointer}.overview-preview-group button[aria-pressed=true]{background:#25bfc526;border-color:#25bfc5;color:var(--ink,#1e2b43)}.overview-preview-reset{color:var(--muted,#657a99)}.overview-preview-group button:focus-visible,.overview-preview-reset:focus-visible{outline:2px solid #25bfc5;outline-offset:2px}@container(max-width:500px){.overview-preview-toolbar{gap:8px;margin-bottom:13px}.overview-preview-group{flex:1 1 100%;gap:4px}.overview-preview-group>span{min-width:70px}.overview-preview-group button,.overview-preview-reset{min-height:36px;padding:7px 10px}.overview-preview-reset{margin-left:77px}}
.sigen-detail .detail-toolbar{align-items:center}@media(max-width:650px){:host .detail-toolbar{display:grid;grid-template-columns:38px minmax(0,1fr) 38px;gap:8px}:host .detail-toolbar input{min-width:0;width:100%}:host .detail-toolbar select{grid-column:1/-1;width:100%}}
.portal-equipment{pointer-events:none}.portal-equipment image{pointer-events:none!important}.portal-equipment-hit[data-detail]{pointer-events:all;fill:transparent;cursor:pointer}.sigen-detail{--ink:#1e2b43;--muted:#657a99;--surface:#fff;--line:#dce7ee;container-type:inline-size}.sigen-detail.night{--ink:#edf4ff}.portal-scene [data-detail]{cursor:pointer}.navigation-actions{flex-shrink:0}header:has(>.navigation-actions){flex-wrap:wrap}
.navigation-actions{display:flex;gap:8px;flex-wrap:wrap}.navigation-actions .detail-link{border-radius:16px;min-width:0;min-height:44px;flex:1 1 100%}.navigation-actions button,.detail-icon{border:1px solid var(--line,#dbe5ef);border-radius:50%;background:var(--surface,#fff);color:inherit;min-width:38px;min-height:38px;cursor:pointer}.detail-link{width:100%;display:flex;align-items:center;justify-content:space-between;text-align:left;border:0;border-radius:16px;background:var(--surface,#fff);color:inherit;padding:17px 20px;margin:8px 0;font:inherit;cursor:pointer}.detail-link:hover{box-shadow:0 4px 15px #168fa51c}.detail-launch{border:0;background:transparent;color:inherit;cursor:pointer;padding:4px 8px;font:inherit}.sigen-detail{width:min(1120px,calc(100vw - 36px));max-width:1120px;max-height:calc(100dvh - 36px);padding:0;border:1px solid #dbe7ef;border-radius:28px;background:var(--sigen-detail-bg,#edf4fa);color:var(--sigen-detail-ink,#1e2b43);box-shadow:0 22px 100px #122b5140;overflow:auto;font:14px system-ui,sans-serif}.sigen-detail.night{--sigen-detail-bg:#222d3a;--sigen-detail-ink:#edf4ff;--surface:#2c3949;--line:#405164;--muted:#a8b8ce}.sigen-detail::backdrop{background:#10273b77;backdrop-filter:blur(5px)}.sigen-detail .detail-header{position:sticky;top:0;z-index:5;display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:16px;padding:18px 24px;background:var(--sigen-detail-bg,#edf4fa);border-bottom:1px solid var(--line,#dce7ee)}.detail-heading{flex:1;min-width:0;text-align:center}.detail-heading h2{margin:0;font-size:19px}.detail-heading p{margin:5px 0 0;color:var(--muted,#70839d);font-size:12px}.sigen-detail .detail-body{padding:24px;min-height:220px}.detail-total-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.detail-total{border:0;border-radius:18px;background:var(--surface,#fff);padding:20px;text-align:left;color:inherit;cursor:pointer}.detail-total small,.detail-total strong{display:block}.detail-total strong{font-size:23px;margin-top:8px}.detail-total small{color:var(--muted,#70839d)}.detail-save-notice{position:sticky;bottom:0;background:#d6faf3;color:#11615a;padding:12px 22px;border-radius:14px;margin:12px}.detail-confirm{padding:28px;text-align:center;background:var(--surface,#fff);border-radius:20px}.detail-confirm button{margin:8px;padding:12px 18px;border:0;border-radius:12px;background:#0bbdc8;color:#092f38;font:inherit}.detail-toolbar{display:flex;justify-content:space-between;gap:12px;margin-bottom:18px}.detail-toolbar select,.detail-toolbar input{border:1px solid #b8cad9;padding:10px;border-radius:12px;background:var(--surface,#fff);color:inherit}.detail-section{margin:20px 0}.detail-meta{display:grid;grid-template-columns:minmax(140px,1fr) 2fr;gap:1px;background:var(--line,#dbe5ef);border-radius:16px;overflow:hidden}.detail-meta>*{padding:14px;background:var(--surface,#fff);margin:0;overflow-wrap:anywhere}.detail-meta dt{color:var(--muted,#70839d)}[data-detail],[data-entity]{touch-action:manipulation}.flow g[role=button]:focus-visible,.portal-scene g[role=button]:focus-visible{outline:3px solid #00bbc9}
@media(max-width:650px){.sigen-detail{width:100%;max-width:100%;max-height:96dvh;border-radius:24px 24px 0 0;margin:auto 0 0}.sigen-detail .detail-body{padding:16px}.sigen-detail .detail-header{padding:15px 12px}.detail-heading h2{font-size:17px}.detail-total-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.detail-total{padding:16px}.detail-meta{grid-template-columns:1fr 1.15fr}.detail-heading p{font-size:11px}}
`;
const HOME_STYLE=`
.chart-catalog,.chart-summary-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:18px}.chart-catalog>.panel,.chart-summary-grid>.panel{min-width:0;margin:0}.chart-summary-grid{margin-top:18px}.chart-catalog-panel>h2{font-size:18px;margin:0 0 10px}@container(min-width:1050px){.chart-catalog{grid-template-columns:repeat(2,minmax(0,1fr))}.chart-catalog-panel[data-chart-panel="power"]{grid-column:1/-1}.chart-summary-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
.energy-tab-strip{overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin}.energy-tab-strip>button{flex:0 0 auto;white-space:nowrap}.navigation-actions{position:relative}.home-menu{position:absolute;right:0;top:calc(100% + 8px);z-index:20;display:grid;min-width:190px;padding:7px;border:1px solid var(--line,#dce6ee);border-radius:16px;background:var(--sigen-menu-bg,#f7fbff);box-shadow:0 14px 40px #13284026}.home-menu[hidden]{display:none}.night .home-menu{--sigen-menu-bg:#283647}.navigation-actions .home-menu button{width:100%;border:0;border-radius:10px;background:transparent;padding:12px 15px;text-align:left;font:inherit}.home-menu button:hover{background:#20bfc518}.search-input{display:block}.detail-search .sr-only{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}.search-input input{width:100%;box-sizing:border-box;padding:15px 17px;border:1px solid var(--line,#dce6ee);border-radius:16px;background:var(--surface,#fff);color:inherit;font:inherit}.search-categories{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.search-categories button,.search-assistant{border:1px solid var(--line,#dce6ee);border-radius:18px;background:var(--surface,#fff);color:inherit;font:inherit;padding:10px 14px;cursor:pointer}.search-categories button[aria-pressed=true]{background:#25bfc526;border-color:#25bfc5}.search-assistant{display:flex;align-items:center;justify-content:space-between;width:100%;margin:10px 0 18px}.search-results{display:grid;gap:7px}.search-result{display:flex;justify-content:space-between;align-items:center;gap:15px;text-align:left;width:100%;border:1px solid var(--line,#dce6ee);border-radius:14px;background:var(--surface,#fff);color:inherit;padding:13px 16px;font:inherit;cursor:pointer}.search-result{text-decoration:none}.search-result strong,.search-result small{display:block;overflow-wrap:anywhere}.search-result strong{font-size:14px;font-weight:500}.search-result small{font-size:11px;color:var(--muted,#657a99);margin-top:5px}.search-result>span:last-child{font-size:24px;color:var(--muted,#657a99)}.custom-home-hero{margin:auto}.saved-energy-layout .extended-current_mode_battery>.panel{height:auto}.saved-energy-layout .extended-manual_controls,.saved-energy-layout .extended-forecast,.saved-energy-layout .extended-current_mode_battery{align-self:start}.immersive-weather{position:relative;isolation:isolate}.immersive-weather::before{content:'';position:absolute;inset:2%;z-index:-1;border-radius:28px;pointer-events:none;opacity:.13;background:radial-gradient(ellipse at 70% 20%,#a8bacd,transparent 65%);animation:weather-drift 18s ease-in-out infinite alternate}.weather-sunny::before{background:radial-gradient(ellipse at 70% 10%,#fce7a3,transparent 60%)}.weather-fog::before{background:linear-gradient(150deg,transparent,#b7c6d7,transparent);opacity:.18}.weather-rainy::before{background:repeating-linear-gradient(110deg,transparent 0,transparent 35px,#5c92b3 36px,transparent 38px);background-size:70px 100px;animation:weather-rain 2.3s linear infinite}.weather-snowy::before{background:radial-gradient(circle,#d5edf7 2px,transparent 3px);background-size:60px 65px;animation:weather-rain 10s linear infinite}.weather-thunder::before{background:radial-gradient(ellipse at 50% 25%,#b0a2dc,transparent 65%);animation:weather-drift 7s ease-in-out infinite alternate}@keyframes weather-drift{to{transform:translateX(-2%)}}@keyframes weather-rain{to{background-position:20px 100px}}@media(prefers-reduced-motion:reduce){.immersive-weather::before{animation:none}}
`;


const COMPACT_HEADER_STYLE=`
.forecast-source-badges{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end}.forecast-source-badges .badge{font-size:11px;padding:4px 7px}.forecast-source-badges .badge[data-available=false]{opacity:.5}.section-title:has(.forecast-source-badges){flex-wrap:wrap}
.forecast-source strong,.forecast-source small{display:block}.forecast-source small{margin-top:5px;font-size:12px;color:var(--muted)}.forecast-provider-links{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.forecast-provider-links a{padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink);text-decoration:none}
[data-card-detail]{cursor:pointer}h2[data-detail]:focus-visible{outline:2px solid #20c5c9;outline-offset:5px;border-radius:4px}
ha-card>header.compact-app-header{padding:14px 24px 6px;gap:12px;flex-wrap:nowrap}
.compact-app-header h1{margin-bottom:0}
.primary-navigation{display:grid;grid-template-columns:minmax(max-content,1fr) auto minmax(0,1fr);align-items:center;gap:12px;margin:0 0 14px;padding:4px 0 10px;border-bottom:1px solid var(--line);min-width:0}
.primary-navigation>nav{display:flex;gap:4px;margin:0;padding:0;border:0;min-width:0;overflow-x:auto;scrollbar-width:none}
.primary-navigation>.badges{display:flex;justify-content:center;flex-wrap:nowrap;gap:6px;margin:0}
.primary-navigation>.connection-strip{justify-self:end;justify-content:flex-end;flex-wrap:nowrap;margin:0}
@container sigen-card (max-width:1000px){
 .primary-navigation{grid-template-columns:minmax(0,1fr) auto;gap:6px 10px}
 .primary-navigation>nav{grid-column:1/-1;grid-row:2}
 .primary-navigation>.badges{justify-content:flex-start;grid-row:1}
 .primary-navigation>.connection-strip{grid-row:1}
}
@container sigen-card (max-width:500px){
 ha-card>header.compact-app-header{padding:12px 14px 4px}
 .primary-navigation{gap:4px;margin-bottom:10px;padding-bottom:6px}
 .primary-navigation>.badges{gap:4px}
 .primary-navigation .badge{padding:6px 8px;font-size:10px;min-height:40px}
 .primary-navigation>.connection-strip{gap:4px}
 .primary-navigation .connection-indicator{font-size:10px;padding:4px 7px;min-height:40px}
}
`;

const VIEWPORT_STYLE=`
ha-card{--sigen-chart-control-bg:#edf4fa;--sigen-chart-control-fg:#1e2b43;--sigen-chart-color-scheme:light}ha-card.night{--sigen-chart-control-bg:#2c3949;--sigen-chart-control-fg:#edf4ff;--sigen-chart-color-scheme:dark}

@container sigen-card (min-width:900px){
ha-card:has(main[data-view=overview]>.compact-overview){height:calc(100dvh - 56px);display:grid;grid-template-rows:auto minmax(0,1fr)}
main:has(>.compact-overview){min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);align-content:stretch}
main:has(>.compact-overview):has(>.overview-preview-toolbar){grid-template-rows:auto auto minmax(0,1fr)}

ha-card:has(main[data-view=overview]>.compact-overview)>header{padding-top:12px;padding-bottom:10px}
ha-card:has(main[data-view=overview]>.compact-overview)>header h1{line-height:1.2}
main:has(>.compact-overview)>.energy-tab-strip{padding-bottom:6px;margin-bottom:8px}
main:has(>.compact-overview)>.overview-preview-toolbar{margin-bottom:8px}
.compact-overview{height:100%;min-height:0;grid-template-rows:minmax(0,1fr) auto;row-gap:12px}
.compact-overview>.hero,.compact-overview>.overview-sidebar{min-height:0;row-gap:12px}
.compact-overview .main-display-stage{position:relative;height:100%;min-height:0;aspect-ratio:auto;align-self:stretch}
.compact-overview .main-display-stage>.sigen-photo-scene,.compact-overview .main-display-stage>.scene-wrap,.compact-overview .main-display-stage[data-display=flow]>.flow{position:absolute;inset:0;width:100%;height:100%;margin:0}
.compact-overview .main-display-stage .sigen-photo-frame{height:100%;aspect-ratio:auto}
.compact-overview .main-display-stage>.scene-wrap:has(>.house-layout){container-type:size;display:grid;place-items:center}
.compact-overview .main-display-stage .house-layout{width:min(100cqw,calc(100cqh * 1.18));height:min(100cqh,calc(100cqw / 1.18));aspect-ratio:1.18}
.compact-overview .overview-summary-stack{height:100%;min-height:0;grid-template-rows:auto minmax(0,1fr) auto;gap:10px}
.compact-overview .overview-side-module{min-height:0}
.compact-overview .overview-side-module>.panel{padding:12px;min-height:0}
.compact-overview .overview-side-module .section-title{margin-bottom:10px}
.compact-overview .overview-side-module h2{font-size:17px;margin-bottom:10px;line-height:1.2}
.compact-overview .overview-today-energy{height:100%;display:flex;flex-direction:column}
.compact-overview .overview-energy-metrics{flex:1;gap:8px;grid-template-rows:repeat(3,minmax(0,1fr))}
.compact-overview .overview-energy-metric{min-height:60px;padding:9px 11px}
.compact-overview .overview-energy-metric strong{font-size:23px}
.compact-overview .overview-summary-ring{max-width:84px;padding:6px}
.compact-overview .overview-circle-button{gap:5px}
.compact-overview .overview-circle-label{min-height:24px}
.compact-overview .overview-circle-panel .overview-circle-storage{margin-top:7px}
.compact-overview .overview-primary-controls>.panel{padding:12px}
.compact-overview .instant-manual-panel>.section-title{margin-bottom:10px}
.compact-overview .overview-charger-controls{margin-top:10px;padding-top:10px}
.compact-overview .overview-sidebar .overview-device-links{grid-template-rows:repeat(3,minmax(44px,1fr))}
}
@media(max-height:900px){@container sigen-card (min-width:900px){
ha-card:has(main[data-view=overview]>.compact-overview)>header{padding:8px 18px 6px}
ha-card:has(main[data-view=overview]>.compact-overview)>header h1{font-size:22px;line-height:1.2}
ha-card:has(main[data-view=overview]>.compact-overview)>header .eyebrow{font-size:9px;line-height:1.2}
ha-card:has(main[data-view=overview]>.compact-overview)>header .connection-strip{margin-top:4px}
ha-card:has(main[data-view=overview]>.compact-overview)>header .connection-indicator{min-height:20px;padding:2px 7px}
ha-card:has(main[data-view=overview]>.compact-overview)>main{padding:0 18px 12px}
main:has(>.compact-overview)>.energy-tab-strip{padding-bottom:5px;margin-bottom:6px}
main:has(>.compact-overview)>.energy-tab-strip button{padding:7px 10px;min-height:30px;font-size:12px}
main:has(>.compact-overview)>.overview-preview-toolbar{gap:6px 12px;margin-bottom:8px}
main:has(>.compact-overview)>.overview-preview-toolbar button{min-height:26px;padding:4px 8px;font-size:11px}
.compact-overview .overview-side-module>.panel{padding:8px}
.compact-overview .overview-side-module h2{font-size:15px;margin-bottom:6px}
.compact-overview .overview-side-module .section-title{margin-bottom:6px}
.compact-overview .overview-side-module .mini-grid{gap:6px}
.compact-overview .overview-side-module .tile{padding:7px;min-height:42px}
.compact-overview .overview-side-module .tile strong{font-size:17px}
.compact-overview .overview-side-module .tile small{font-size:10px}
.compact-overview .overview-summary-stack{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:auto minmax(0,1fr);gap:8px}
.compact-overview .overview-summary-stack>.overview-side-module:first-child{grid-column:1;grid-row:1}
.compact-overview .overview-summary-stack>.overview-side-module:nth-child(2){grid-column:1/-1;grid-row:2}
.compact-overview .overview-summary-stack>.overview-side-module:nth-child(3){grid-column:2;grid-row:1}
.compact-overview .overview-summary-stack>.overview-side-module:first-child>.panel{padding:6px}
.compact-overview .overview-summary-stack>.overview-side-module:first-child .section-title{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px;margin-bottom:4px}
.compact-overview .overview-summary-stack>.overview-side-module:first-child h2{font-size:13px;margin:0}
.compact-overview .overview-summary-stack>.overview-side-module:first-child .detail-launch{grid-column:2;grid-row:1;min-height:20px;padding:0 3px;line-height:1.2}
.compact-overview .overview-summary-stack>.overview-side-module:first-child .badge{grid-column:1/-1;grid-row:2;justify-self:start;font-size:9px;padding:1px 5px;line-height:1.2}
.compact-overview .overview-summary-stack>.overview-side-module:first-child .mini-grid{grid-template-columns:minmax(0,1fr)}
.compact-overview .overview-summary-stack>.overview-side-module:first-child .tile{min-height:0;padding:3px;gap:5px}
.compact-overview .overview-summary-stack>.overview-side-module:first-child .tile>span{display:grid;gap:1px}
.compact-overview .overview-summary-stack>.overview-side-module:first-child .tile strong{font-size:15px;line-height:1.15;margin:0}
.compact-overview .overview-summary-stack>.overview-side-module:first-child .tile small{font-size:10px;line-height:1.1;margin:0}
.compact-overview .overview-summary-stack .overview-circle-grid{gap:4px}
.compact-overview .overview-summary-stack .overview-circle-panel{height:100%;display:flex;flex-direction:column;justify-content:center}
.compact-overview .overview-summary-stack .overview-circle-label{font-size:9px;min-height:24px}
.compact-overview .overview-summary-stack .overview-summary-ring{padding:4px}
.compact-overview .overview-summary-stack .overview-ring-centre small{font-size:7px}
.compact-overview .overview-energy-metric{min-height:42px;padding:5px 7px}
.compact-overview .overview-energy-metric small{font-size:10px;line-height:1.15;margin-bottom:3px}
.compact-overview .overview-energy-metric strong{font-size:16px}
.compact-overview .overview-energy-metrics{gap:6px}
.compact-overview .overview-summary-ring{max-width:62px;padding:5px}
.compact-overview .overview-circle-label{min-height:15px;font-size:10px}
.compact-overview .overview-circle-panel .overview-circle-storage{font-size:10px;margin-top:4px}
.compact-overview .overview-primary-controls>.panel{padding:9px}
.compact-overview .instant-manual-panel>.section-title{margin-bottom:6px}
.compact-overview .instant-manual-panel h2{font-size:15px}
.compact-overview .control-buttons button{min-height:32px;padding:6px 8px;font-size:11px}
.compact-overview .overview-charger-controls{margin-top:7px;padding-top:7px;gap:10px}
.compact-overview .overview-charger-heading{padding-bottom:5px;font-size:11px}
.compact-overview .overview-mode-control{padding:6px 10px}
}}
`;

export const PERSONAL_SETTINGS=new Set(['display_settings','chart_settings','app_settings']);
export function mergeInterfacePreferences(local={},shared={}) {
  const result={...local};
  if(shared&&typeof shared==='object'&&!Array.isArray(shared))for(const [route,value] of Object.entries(shared))if(SETTINGS_ROUTES.includes(route)&&!PERSONAL_SETTINGS.has(route)&&!['__proto__','constructor','prototype'].includes(route))result[route]=value;
  return result;
}
export function dashboardEmbedTargets(config={}) {
  const result=[];
  const visit=(cards,path,view)=>{if(!Array.isArray(cards))return;cards.forEach((card,index)=>{const at=[...path,index];if(card?.type==='custom:taba7-dashboard-shell'&&Array.isArray(card.pages))card.pages.forEach((page,p)=>result.push({key:`shell:${at.join('.')}:${p}`,kind:'shell',path:at,page:p,label:`${view} → ${page.name??`Menu ${p+1}`}`,replaces:Boolean(page.card)}));if(Array.isArray(card?.cards))visit(card.cards,[...at,'cards'],view);});};
  (config.views??[]).forEach((view,index)=>{result.push({key:`view:${index}`,kind:'view',index,label:view.title??view.path??`Page ${index+1}`});visit(view.cards,['views',index,'cards'],view.title??view.path??'Page');(view.sections??[]).forEach((section,s)=>visit(section.cards,['views',index,'sections',s,'cards'],view.title??view.path??'Page'));});
  return result;
}
export function embedDashboardCard(original,targetKey,card,name='Solar') {
  if(!original||typeof original!=='object'||!Array.isArray(original.views)||original.strategy)throw new Error('Choose an editable dashboard.');
  const config=JSON.parse(JSON.stringify(original)),copy=JSON.parse(JSON.stringify(card));
  if(copy.type!=='custom:sigen-hybrid-card')throw new Error('Invalid Sigenergy TC card.');
  if(targetKey==='new'){
    const title=String(name).trim();if(!title||title.length>60)throw new Error('Enter a page name of up to 60 characters.');
    const base=title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'sigenergy-tc';let path=base,n=1;
    while(config.views.some(v=>v.path===path))path=`${base}-${++n}`;
    delete copy.embedded;delete copy.embed_mode;config.views.push({title,path,type:'panel',cards:[copy]});return {config,path};
  }
  const target=dashboardEmbedTargets(config).find(t=>t.key===targetKey);if(!target)throw new Error('The destination changed. Choose it again.');
  copy.embedded=true;
  if(target.kind==='shell'){
    let shell=config;for(const key of target.path)shell=shell[key];copy.embed_mode='shell';shell.pages[target.page].card=copy;return {config,path:config.views[target.path[1]].path,shell:true};
  }
  const view=config.views[target.index];copy.embed_mode='card';
  if(view.type==='sections'||Array.isArray(view.sections)){view.sections??=[];view.sections.push({type:'grid',cards:[{...copy,grid_options:{columns:'full',rows:'auto'}}]});}
  else if(view.type==='panel'&&view.cards?.length){view.cards=[{type:'vertical-stack',cards:[...view.cards,copy]}];}
  else{view.cards??=[];view.cards.push(copy);}
  return {config,path:view.path};
}

const UX_STYLE=`
.sigen-detail{--ink:var(--sigen-detail-ink,#1e2b43);--surface:#f8fcfe;--line:#dce7ee;--muted:#657a99}.sigen-detail.night{--surface:#2c3949;--line:#405164;--muted:#a8b8ce}
.mobile-power-grid{display:none}ha-card.night{--sigen-navigation-bg:#22303f}ha-card:not(.night){--sigen-navigation-bg:#edf4fa}
ha-card.embedded-shell{--sigen-sticky-offset:0px;border-radius:16px!important;height:var(--sigen-embedded-height,100%)!important;min-height:0!important}ha-card.embedded-shell>main{min-height:0}ha-card.embedded-shell{overflow:auto}ha-card.embedded-card{--sigen-sticky-offset:0px}
@container sigen-card (max-width:949px){ha-card.embedded-shell{height:auto!important;overflow:visible!important}}

.settings-home{max-width:1120px;margin:0 auto;padding:12px 0 24px}.settings-home-title{margin:0 0 18px;font-size:22px}.settings-home-tools{display:flex;gap:12px;margin-bottom:18px}.settings-home-tools button{min-height:44px;flex:1;margin:0}.settings-home-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.settings-home-tile{min-height:98px;display:flex;align-items:center;justify-content:space-between;gap:16px;border:1px solid var(--line);border-radius:18px;padding:18px 20px;background:var(--surface);color:var(--ink);font:inherit;text-align:left;cursor:pointer}.settings-home-tile strong{display:block;font-size:16px}.settings-home-tile small{display:block;font-size:13px;line-height:1.4;color:var(--muted);margin-top:5px}.settings-section-title{font-size:16px;margin:18px 0 10px}.settings-group{background:var(--surface)!important;border:1px solid var(--line)}.settings-row{min-height:56px!important;padding:14px 18px!important;font-size:14px}.settings-field input,.settings-field select,.settings-field textarea,.settings-check{background:var(--surface)!important;color:var(--ink)!important}.settings-field select option{background:var(--sigen-detail-bg,#edf4fa);color:var(--ink)}.settings-page{color:var(--ink)}.settings-metrics{gap:12px}.settings-page .settings-note a{color:var(--ink)}.settings-page .settings-note{font-size:13px}.settings-actions button,.detail-icon,.dialog-close{min-height:44px!important;min-width:44px!important}.sigen-detail .detail-header{padding:12px 18px}.sigen-detail .detail-body{padding:20px}.sigen-detail .detail-heading h2{font-size:20px}.sigen-detail,.sigen-manual-dialog{color-scheme:light}.sigen-detail.night,.sigen-manual-dialog.night{color-scheme:dark}.sigen-detail.night{--ink:#edf4ff}.sigen-manual-dialog label{font-size:15px}.sigen-manual-dialog input,.sigen-manual-dialog select{min-height:46px;font-size:15px}.navigation-actions button{min-width:44px;min-height:44px;font-size:20px}.connection-indicator,.badges .badge{position:relative}.connection-indicator::after,.badges .badge::after{content:'';position:absolute;inset:-9px 0;min-height:44px}.energy-tab-strip>button{min-height:44px;font-size:14px}.overview-primary-controls .control-buttons button{font-size:14px!important;min-height:44px!important}.overview-summary-ring .overview-ring-centre strong{font-size:clamp(15px,4.3cqi,22px)}.overview-ring-centre small{font-size:11px!important}.overview-circle-label{font-size:12px!important;line-height:1.3}.overview-mode-control{font-size:14px;min-height:48px}.overview-mode-control select{font-size:14px;min-height:32px}.overview-device-links>button{font-size:14px;min-height:48px}.overview-charger-heading{font-size:13px!important}
.sigen-photo-frame{container-type:size}.sigen-photo-plane{left:50%!important;top:50%!important;width:max(100cqw,calc(100cqh * 2.490342))!important;height:auto!important;aspect-ratio:1676/673;transform:translate(-50%,-50%)}.compact-overview .main-display-stage[data-display=photo]{max-height:calc(100cqw / 1.8);align-self:center}.compact-overview .main-display-stage[data-display=flow]{max-height:calc(100cqw / 1.6);align-self:center}.compact-overview .overview-side-module[data-display-module=current_mode_battery]{min-width:0}.compact-overview .overview-circle-grid{gap:10px}.compact-overview .overview-ring-centre small{font-size:10px!important}.compact-overview .overview-summary-ring{min-width:0}
.chart-category-jumps{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 20px}.chart-category-jumps button{color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:999px;min-height:44px;padding:10px 14px;text-decoration:none;font-size:13px}.chart-category{scroll-margin-top:100px}.chart-toolbar-global{position:sticky;top:var(--sigen-sticky-offset,56px);z-index:8;display:flex;align-items:center;gap:8px;padding:10px;background:var(--sigen-navigation-bg,#edf4fa);border:1px solid var(--line);border-radius:14px;margin:0 0 14px}.chart-toolbar-global input,.chart-toolbar-global select,.chart-toolbar-global button{min-height:44px;min-width:44px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font:inherit;padding:8px}.chart-toolbar-global input{flex:1;min-width:0}.chart-toolbar-global select{max-width:135px}.chart-toolbar-global select option{background:var(--sigen-detail-bg);color:var(--ink)}.chart-toolbar-global span{font-size:13px;color:var(--muted)}.chart-category-jumps .chart-customize{margin-inline-start:auto}
@container sigen-card (min-width:1900px){.compact-overview{grid-template-columns:minmax(0,1fr) clamp(380px,23cqw,540px)}.overview-side-module h2{font-size:20px!important}.overview-energy-metric strong{font-size:23px!important}.overview-energy-metric small{font-size:14px!important}.overview-summary-ring{max-width:110px!important}.overview-circle-label{font-size:14px!important}.overview-ring-centre small{font-size:12px!important}}
@container sigen-card (min-width:651px) and (max-width:949px){ha-card:has(main[data-view=overview]>.compact-overview){height:auto!important;display:block!important}main:has(>.compact-overview){display:block!important}.compact-overview{display:grid!important;grid-template-columns:minmax(0,1fr)!important;height:auto!important;gap:18px}.compact-overview>.hero{display:grid!important;grid-column:1!important;grid-row:auto!important;grid-template-rows:auto auto!important;gap:16px}.compact-overview .main-display-stage{position:relative;height:auto!important;aspect-ratio:2/1;max-height:420px!important}.compact-overview>.overview-sidebar{display:grid!important;grid-column:1!important;grid-row:auto!important;grid-template-rows:auto auto!important;gap:16px}.compact-overview .overview-summary-stack{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;height:auto}.compact-overview .overview-side-module[data-display-module=current_mode_battery]{grid-column:1/-1}.compact-overview .overview-summary-ring{max-width:100px!important}.compact-overview .overview-ring-centre small{font-size:12px!important}.compact-overview .overview-device-links{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:auto!important}.compact-overview .overview-side-module>.panel{height:100%;padding:16px!important}}
@container sigen-card (max-width:650px){ha-card{border-radius:18px!important}ha-card>header{display:block!important;padding:12px 14px 8px!important;position:relative}ha-card>header>div:first-child{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}ha-card>header .eyebrow{display:none}ha-card>header h1{font-size:21px!important;line-height:1.2;letter-spacing:-.03em;margin:0;min-width:0}ha-card>header .connection-strip{margin:0;gap:3px;flex-wrap:nowrap}.connection-indicator{font-size:10px!important;min-height:44px!important;padding:5px!important;border:0!important;background:transparent!important}.connection-indicator::after,.badges .badge::after{display:none}.badges{display:flex!important;gap:8px!important;justify-content:flex-start!important;margin:0!important}.badges .badge{min-height:44px!important;font-size:12px!important;padding:8px 12px!important}.navigation-actions{display:none!important}ha-card>main{padding:0 10px 18px!important}.energy-tab-strip{display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr));gap:2px!important;overflow:visible!important;position:sticky;top:var(--sigen-sticky-offset,56px);z-index:9;background:var(--sigen-navigation-bg,#edf4fa);margin:0 -2px 12px!important;padding:4px 0 8px!important;border-bottom:1px solid var(--line)}.energy-tab-strip>button{font-size:12px!important;min-height:44px!important;padding:8px 2px!important;white-space:nowrap;min-width:0;border-radius:12px!important}.compact-overview{display:flex!important;flex-direction:column;height:auto!important;gap:16px}.compact-overview>.hero{display:flex!important;width:100%!important;align-self:stretch!important;flex-direction:column;gap:12px;min-width:0}.compact-overview .main-display-stage{position:relative;height:auto!important;width:100%;aspect-ratio:1.9;max-height:none!important}.compact-overview .main-display-stage>.scene-wrap{position:absolute;inset:0}.compact-overview .house-layout{width:100%!important;height:100%!important;aspect-ratio:auto!important}.compact-overview .house-canvas{left:10%;top:-11%;width:80%;height:110%}.compact-overview .house-reading,.compact-overview .sigen-photo-node,.compact-overview .sigen-photo-leader{display:none!important}.compact-overview .house-header{inset:4% 4% auto}.compact-overview .house-temperature,.sigen-photo-weather .house-temperature{font-size:18px!important}.compact-overview .house-weather-icon,.sigen-photo-weather .house-weather-icon{width:32px!important;height:32px!important}.sigen-photo-weather .house-weather{min-height:44px;padding:6px 10px}.compact-overview .mobile-power-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;width:100%}.mobile-power-grid button{min-height:72px;min-width:0;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--ink);padding:10px 12px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;text-align:left;font:inherit}.mobile-power-grid span{font-size:12px;color:var(--muted)}.mobile-power-grid strong{font-size:21px;line-height:1.25}.mobile-power-grid small{font-size:11px;margin-top:2px;color:var(--muted)}.compact-overview .overview-primary-controls{width:100%;margin:0}.compact-overview .overview-primary-controls>.panel{padding:14px!important}.compact-overview .battery-control-buttons{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.compact-overview .battery-control-buttons>button:last-child{grid-column:1/-1}.compact-overview .control-buttons button{min-height:46px!important;font-size:13px!important}.compact-overview .overview-charger-controls{grid-template-columns:1fr;gap:12px}.compact-overview>.overview-sidebar{width:100%;display:flex;flex-direction:column;gap:14px}.compact-overview .overview-summary-stack{display:flex;flex-direction:column;gap:14px;height:auto}.compact-overview .overview-side-module>.panel{padding:16px!important}.compact-overview .overview-circle-grid{gap:8px}.compact-overview .overview-summary-ring{max-width:94px!important}.compact-overview .overview-circle-label{font-size:12px!important;min-height:32px!important}.compact-overview .overview-ring-centre strong{font-size:16px!important}.compact-overview .overview-ring-centre small{font-size:10px!important}.compact-overview .overview-device-links{display:grid;grid-template-columns:1fr;grid-template-rows:repeat(3,minmax(48px,auto))!important;gap:8px}.overview-side-module h2{font-size:18px!important}.overview-side-module strong{font-size:21px}.settings-home-grid{grid-template-columns:1fr}.settings-home-tile{min-height:86px;padding:16px}.settings-home-title{font-size:21px}.settings-home-tools{flex-wrap:wrap}.settings-home-tools button{flex-basis:100%}.sigen-detail{width:100vw;max-width:100vw;max-height:calc(100dvh - 12px);border-radius:18px 18px 0 0;margin:12px 0 0}.sigen-detail .detail-body{padding:14px}.sigen-detail .detail-header{padding:10px 12px;gap:8px}.sigen-detail .detail-heading h2{font-size:18px}.detail-total-grid{grid-template-columns:1fr}.settings-row{min-height:54px!important;padding:14px!important}.settings-page{gap:12px}.chart-toolbar-global{top:calc(var(--sigen-sticky-offset,56px) + 57px);gap:5px;padding:7px}.chart-toolbar-global span{display:none}.chart-toolbar-global input{width:110px}.chart-toolbar-global select{max-width:100px;font-size:13px}.chart-category-jumps{gap:6px;flex-wrap:nowrap;overflow-x:auto;padding-bottom:6px}.chart-category-jumps button{white-space:nowrap;flex:none}.chart-category{scroll-margin-top:180px}}
@container sigen-card (min-width:950px){
.compact-overview.overview-grid.overview-aligned-controls{grid-template-rows:minmax(0,1fr) 196px!important}.compact-overview.overview-aligned-controls>.hero{grid-template-rows:subgrid!important}.compact-overview .main-display-stage[data-display=photo],.compact-overview .main-display-stage[data-display=flow]{max-height:none;align-self:stretch}.compact-overview .overview-summary-stack{grid-template-rows:auto minmax(0,1fr) auto}.compact-overview .overview-side-module>.panel{padding:10px!important}.compact-overview .overview-forecast-panel .mini-grid{gap:8px}.compact-overview .overview-energy-metric{min-height:48px;padding:7px 9px}.compact-overview .overview-energy-metric small{font-size:14px;line-height:1.3}.compact-overview .overview-energy-metric strong{font-size:23px}.compact-overview .overview-summary-ring{max-width:86px!important}.compact-overview .overview-circle-label{font-size:12px!important}.compact-overview .overview-circle-panel{padding:10px!important}.compact-overview .overview-primary-controls>.panel{padding:12px!important}.compact-overview .overview-charger-controls{margin-top:5px;padding-top:5px}.compact-overview .overview-charger-heading{padding-bottom:6px}.compact-overview .overview-device-links{grid-template-rows:repeat(3,minmax(0,1fr))!important}ha-card.embedded-shell>header{padding:10px 18px}ha-card.embedded-shell>header .eyebrow{display:none}ha-card.embedded-shell>header>div:first-child{display:flex;align-items:center;gap:12px}ha-card.embedded-shell>header h1{font-size:22px;margin:0}ha-card.embedded-shell>header .connection-strip{margin:0}.compact-overview [data-display-module=forecast] .tile{min-height:50px;padding:6px!important;gap:10px!important}.compact-overview [data-display-module=forecast] .tile strong{font-size:20px;line-height:24px}.compact-overview [data-display-module=forecast] .tile small{font-size:12px;line-height:16px}
}

ha-card.standalone-card{height:auto!important;min-width:0;max-width:100%;display:block!important;border-radius:20px;overflow:hidden}ha-card.standalone-card>main{display:block!important;padding:0!important;min-width:0}ha-card.standalone-card main>.panel{border:0;background:transparent;margin:0;padding:16px}.standalone-card .mobile-power-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.standalone-card .mobile-power-grid button{min-height:76px;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--ink);font:inherit;padding:12px;display:flex;flex-direction:column;align-items:flex-start;text-align:left;min-width:0}.standalone-card .mobile-power-grid span{font-size:13px;color:var(--muted)}.standalone-card .mobile-power-grid strong{font-size:23px}.standalone-card .mobile-power-grid small{font-size:12px;color:var(--muted)}.standalone-card .control-buttons{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(130px,1fr))!important;gap:8px}.standalone-card .control-buttons button{font-size:14px!important;min-height:48px!important;line-height:1.3;padding:9px 10px}.standalone-card [data-controls-layout=vertical] .battery-control-buttons{grid-template-columns:1fr!important}.standalone-card [data-controls-layout=horizontal] .battery-control-buttons{grid-template-columns:repeat(auto-fit,minmax(100px,1fr))!important}.standalone-card [data-density=compact] .control-buttons button{min-height:44px!important;font-size:13px!important}.standalone-card [data-density=compact]>.panel{padding:12px}.standalone-card .overview-charger-controls{grid-template-columns:1fr;gap:12px}.standalone-card .overview-mode-control{font-size:14px;padding:12px}.standalone-card .overview-mode-control select{min-height:44px}.standalone-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}.standalone-device-reading{display:grid;grid-template-columns:1fr 1fr auto;align-items:center;gap:12px;width:100%;font:inherit;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:14px;padding:14px;text-align:left}.standalone-device-reading span{min-width:0}.standalone-device-reading small{display:block;font-size:12px;color:var(--muted)}.standalone-device-reading strong{display:block;font-size:22px}.standalone-card .connection-strip{justify-content:space-between;margin:0}.standalone-card .connection-indicator{font-size:13px!important;min-height:44px!important;padding:10px!important;border:1px solid var(--line)!important;background:var(--surface)!important}.standalone-card .overview-circle-panel{margin:0}.standalone-card .overview-energy-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.standalone-card .overview-energy-metric{min-height:78px}.standalone-card .overview-energy-metric small{font-size:13px}.standalone-card .overview-energy-metric strong{font-size:23px}.standalone-card .detail-link{min-height:44px}.standalone-card .mini-grid .tile{min-height:84px}.standalone-card .battery-summary{padding:4px 0}.standalone-card h2{font-size:19px}
@container sigen-card (min-width:600px){.standalone-card .mobile-power-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.standalone-card .overview-energy-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.standalone-card .overview-charger-controls{grid-template-columns:repeat(2,minmax(0,1fr))}}
@container sigen-card (max-width:340px){.standalone-card .mobile-power-grid strong,.standalone-card .overview-energy-metric strong{font-size:19px}.standalone-card .overview-energy-metric small{font-size:12px}.standalone-card .battery-summary{gap:12px}.standalone-card .standalone-device-reading{grid-template-columns:1fr auto}.standalone-device-reading span:nth-child(2){grid-row:2}.standalone-card .overview-summary-ring{max-width:70px}.standalone-card .overview-ring-centre strong{font-size:13px!important}}

@media(pointer:coarse){.detail-icon,.navigation-actions button,.settings-secondary,.settings-save,.settings-apply{min-width:44px;min-height:44px}}

`;

export function installNavigation(Card) {
  const originalDisconnected=Card.prototype.disconnectedCallback;
  Card.prototype.disconnectedCallback=function(){this._cancelOptionsFlow?.();this._sharedSettingsUnsubscribe?.();this._sharedSettingsUnsubscribe=null;this._sharedSettingsLoaded=null;originalDisconnected?.call(this);};
  Card.prototype._sharedSettingsKey=function(){return this._config?.config_entry?`sigen_hybrid_tc_${this._config.config_entry}`:null;};
  Card.prototype._loadSharedSettings=async function(){
    const key=this._sharedSettingsKey();if(!key||this._sharedSettingsLoading===key||this._sharedSettingsLoaded===key||typeof this._hass?.callWS!=='function')return;
    this._sharedSettingsLoading=key;
    try{
      const response=await this._hass.callWS({type:'frontend/get_system_data',key});if(this._sharedSettingsKey()!==key)return;
      this._sharedInterfaceOptions=response?.value?.settings??{};this._sharedSettingsLoaded=key;
      if(typeof this._hass.connection?.subscribeMessage==='function'){
        this._sharedSettingsUnsubscribe?.();
        const off=await this._hass.connection.subscribeMessage(message=>{if(this._sharedSettingsKey()!==key)return;const next=message?.value?.settings??{};if(JSON.stringify(next)===JSON.stringify(this._sharedInterfaceOptions))return;this._sharedInterfaceOptions=next;this._render();},{type:'frontend/subscribe_system_data',key});
        if(this.isConnected===false)off();else this._sharedSettingsUnsubscribe=off;
      }
      this._render();
    }catch{this._sharedSettingsLoaded=key;this._sharedSettingsError=true;}finally{if(this._sharedSettingsLoading===key)this._sharedSettingsLoading=null;}
  };
  Card.prototype._saveSharedSetting=async function(route,id,draft){
    const key=this._sharedSettingsKey();if(!key)throw new Error('Choose a Sigenergy TC connection before saving this plan.');
    const response=await this._hass.callWS({type:'frontend/get_system_data',key}),settings=response?.value?.settings??{};
    const previous=id?this._sharedInterfaceOptions?.[route]?.[id]:this._sharedInterfaceOptions?.[route],latest=id?settings[route]?.[id]:settings[route];
    if(JSON.stringify(previous)!==JSON.stringify(latest))throw new Error('This setting changed on another device. Reopen it before saving.');
    const updated={...settings,[route]:id?{...settings[route],[id]:draft}:draft};
    await this._hass.callWS({type:'frontend/set_system_data',key,value:{version:1,settings:updated,changed_route:route,changed_at:new Date().toISOString()}});
    this._sharedInterfaceOptions=updated;this._sharedSettingsLoaded=key;
  };
  Card.prototype._saveAccountPreferences=async function(draft){
    const response=await this._hass.callWS({type:'frontend/get_user_data',key:'language'});
    const original=response?.value??this._hass.locale??{};
    const value={...original};for(const key of ['time_format','date_format','number_format','first_weekday'])value[key]=draft[key];
    await this._hass.callWS({type:'frontend/set_user_data',key:'language',value});
  };
  Card.prototype._bindDashboardInstaller=async function(){
    const host=this._detailDialog?.querySelector('[data-dashboard-installer]');if(!host||host.dataset.bound)return;host.dataset.bound='1';
    const live=()=>host.isConnected&&this._detailStack?.at(-1)?.route==='dashboard_install';
    try{
      const dashboards=await this._hass.callWS({type:'lovelace/dashboards/list'});if(!live())return;
      const items=dashboards.filter(d=>d.mode==='storage'&&d.url_path!=='map');
      host.innerHTML=`<label class="settings-field"><span>Card content</span><select data-embed-content>${CARD_PRESETS.filter(([key])=>key!=='chart').map(([key,label,group])=>`<option value="${key}">${escape(group+' · '+label)}</option>`).join('')}<optgroup label="Individual charts">${CHART_CHOICES.map(([key,label])=>`<option value="chart:${key}">${escape(label)}</option>`).join('')}</optgroup></select></label><label class="settings-field"><span>Dashboard</span><select data-embed-dashboard><option value="">Choose a dashboard</option>${items.map(d=>`<option value="${escape(d.url_path)}">${escape(d.title)}</option>`).join('')}</select></label><div data-embed-destinations></div><output data-embed-result aria-live="polite"></output>`;
      const select=host.querySelector('[data-embed-dashboard]'),destinations=host.querySelector('[data-embed-destinations]'),output=host.querySelector('[data-embed-result]');
      select.addEventListener('change',async()=>{
        destinations.innerHTML='';output.textContent='';const path=select.value;if(!path)return;output.textContent='Loading pages…';
        try{
          const before=await this._hass.callWS({type:'lovelace/config',url_path:path});if(!live()||select.value!==path)return;
          if(before.strategy)throw new Error('Choose a dashboard you can edit.');
          const targets=dashboardEmbedTargets(before).filter(t=>t.kind!=='shell'||customElements.get('taba7-dashboard-shell')?.supportsEmbeddedCards===true);
          output.textContent='';destinations.innerHTML=`<label class="settings-field"><span>Destination</span><select data-embed-target><option value="new">New Home Assistant page</option>${targets.map(t=>`<option value="${escape(t.key)}">${escape(t.kind==='shell'?'Custom menu · '+t.label:'Existing page · '+t.label)}</option>`).join('')}</select></label><label class="settings-field" data-embed-name><span>Page name</span><input value="Solar" maxlength="60"></label><p class="settings-note" data-embed-summary>A new page will contain the selected Sigenergy TC card or dashboard.</p><button type="button" class="settings-save" data-embed-apply>Add Sigenergy TC</button>`;
          const target=destinations.querySelector('[data-embed-target]'),name=destinations.querySelector('[data-embed-name]'),summary=destinations.querySelector('[data-embed-summary]'),apply=destinations.querySelector('[data-embed-apply]');
          target.addEventListener('change',()=>{name.hidden=target.value!=='new';const selected=targets.find(t=>t.key===target.value);summary.textContent=selected?.kind==='shell'?`Sigenergy TC will open inside ${selected.label}. A backup of this dashboard will be saved first.`:target.value==='new'?'A new page will contain the selected Sigenergy TC card or dashboard.':'The card will be added alongside the existing content. A backup will be saved first.';});
          apply.addEventListener('click',async()=>{
            apply.disabled=true;output.textContent='Adding dashboard…';
            try{
              const current=await this._hass.callWS({type:'lovelace/config',url_path:path});if(JSON.stringify(current)!==JSON.stringify(before))throw new Error('The dashboard changed. Choose the destination again.');
              const card=presetCardConfiguration(this._config,host.querySelector('[data-embed-content]').value);
              const prepared=embedDashboardCard(before,target.value,card,name.querySelector('input').value);
              const stored=await this._hass.callWS({type:'frontend/get_user_data',key:'sigen_hybrid_dashboard_backups'}),backups=Array.isArray(stored?.value)?stored.value:[];
              await this._hass.callWS({type:'frontend/set_user_data',key:'sigen_hybrid_dashboard_backups',value:[{at:new Date().toISOString(),dashboard:path,before,after:prepared.config},...backups].slice(0,5)});
              await this._hass.callWS({type:'lovelace/config/save',url_path:path,config:prepared.config});
              const after=await this._hass.callWS({type:'lovelace/config',url_path:path});if(JSON.stringify(after)!==JSON.stringify(prepared.config))throw new Error('Dashboard verification failed. A backup is retained.');
              output.innerHTML=`Added. <a href="/${escape(path)}/${escape(prepared.path??'0')}">Open dashboard</a>`;
            }catch(error){output.textContent=error.message??'Could not add the dashboard.';apply.disabled=false;}
          });
        }catch(error){output.textContent=error.message??'Could not load this dashboard.';}
      });
    }catch{host.textContent='Dashboard setup requires a Home Assistant administrator account.';}
  };
  Card.prototype._optionsFlowPage=function(){
    const flow=this._optionsFlow,labels={connections:'Connections',modbus:'Local Modbus',remove_cloud:'Remove saved cloud sign-in',local:'Local Modbus',cloud:'mySigen Cloud',forecast:'Solar forecast',forecast_entities:'Forecast sensors',safety:'Owner limits',dashboard:'Dashboard defaults'};
    if(!flow)return {title:'Connection setup',body:'<p>Loading connection options…</p>'};
    const title=labels[flow.step_id]??'Connection setup';
    if(flow.type==='menu')return {title,body:`<div class="settings-page">${(flow.menu_options??[]).filter(step=>['connections','modbus','cloud','remove_cloud'].includes(step)).map(step=>`<button type="button" class="settings-row" data-options-menu="${escape(step)}">${escape(labels[step]??step.replaceAll('_',' '))}<span>›</span></button>`).join('')}</div>`};
    if(flow.type==='form')return {title,body:`<div class="settings-page">${flow.errors&&Object.keys(flow.errors).length?'<p role="alert">Check the connection details and try again.</p>':''}<ha-form data-options-form></ha-form><div class="settings-actions"><button type="button" class="settings-secondary" data-detail-close>Cancel</button><button type="button" class="settings-save" data-options-submit>Continue</button></div></div>`};
    return {title:'Connections',body:`<p>${flow.type==='create_entry'?'Connection settings saved.':'Connection setup closed.'}</p>`};
  };
  Card.prototype._startOptionsFlow=async function(initialStep){
    if(!this._config.config_entry)return;
    const generation=this._optionsGeneration=(this._optionsGeneration??0)+1;this._optionsFlow=null;this._optionsFlowData={};this._openDetail('connection_setup');
    try{const flow=await this._hass.callApi('POST','config/config_entries/options/flow',{handler:this._config.config_entry});if(generation!==this._optionsGeneration){if(flow.flow_id)this._hass.callApi('DELETE',`config/config_entries/options/flow/${flow.flow_id}`).catch(()=>{});return;}this._optionsFlow=flow;if(initialStep==='safety'&&flow.type==='menu'&&flow.menu_options?.includes('safety'))return this._submitOptionsFlow({next_step_id:'safety'});this._openDetail('connection_setup',undefined,true);}catch{const body=this._detailDialog?.querySelector('.detail-body');if(body)body.textContent='Setup is unavailable. Check your administrator access.';}
  };
  Card.prototype._bindOptionsForm=function(){
    const form=this._detailDialog?.querySelector('[data-options-form]');if(!form||!this._optionsFlow)return;
    const labels={host:'Modbus address',port:'Port',sole_modbus_client:'Dedicated Modbus connection',shared_read_only:'Additional read-only connection',poll_seconds:'Polling interval (seconds)',username:'mySigen username',password:'Password',region:'Region',enabled:'Enabled',allow_unofficial:'Accept use of the mySigen app interface',cloud:'mySigen Cloud',modbus:'Local Modbus',enable_control:'Enable plant control',export_permitted:'My site is approved for grid export',reserve_soc:'Minimum reserve (%)',charge_ceiling_soc:'Charge ceiling (%)',max_charge_kw:'Maximum requested charge power (kW)',max_discharge_kw:'Maximum requested discharge power (kW)'};
    form.hass=this._hass;form.schema=this._optionsFlow.data_schema??[];form.computeLabel=schema=>labels[schema.name]??schema.name.replaceAll('_',' ');form.data=Object.fromEntries(form.schema.filter(s=>s.default!==undefined||s.description?.suggested_value!==undefined).map(s=>[s.name,s.default??s.description.suggested_value]));this._optionsFlowData={...form.data};
    form.addEventListener('value-changed',event=>{this._optionsFlowData=event.detail.value;});
  };
  Card.prototype._submitOptionsFlow=async function(data){
    const flow=this._optionsFlow,generation=this._optionsGeneration;if(!flow?.flow_id||this._optionsSubmitting)return;
    this._optionsSubmitting=true;
    try{const next=await this._hass.callApi('POST',`config/config_entries/options/flow/${flow.flow_id}`,data);if(generation!==this._optionsGeneration){if(next.flow_id&&['menu','form'].includes(next.type))this._hass.callApi('DELETE',`config/config_entries/options/flow/${next.flow_id}`).catch(()=>{});return;}this._optionsFlow=next;this._optionsFlowData={};this._openDetail('connection_setup',undefined,true);}catch{if(generation!==this._optionsGeneration)return;const output=this._detailDialog?.querySelector('.detail-save-notice');if(output){output.hidden=false;output.textContent='Connection setup failed. Check the entered details.';}}finally{this._optionsSubmitting=false;}
  };

  const originalRender=Card.prototype._render,originalHeader=Card.prototype._header,originalBattery=Card.prototype._battery,originalFlow=Card.prototype._flow,originalHouse=Card.prototype._house,originalManual=Card.prototype._openPreview,originalStatistics=Card.prototype._statistics,originalContent=Card.prototype._content;
  Card.prototype._savedHomepageAppearance=function(){
    try{
      const saved=JSON.parse(localStorage.getItem(`sigen-hybrid:interface:${this._config?.config_entry??this._config?.title??'default'}`)??'{}')?.display_settings;
      return saved?.route==='display_settings'&&saved.local_only===true&&HOMEPAGE_APPEARANCES.includes(saved.appearance)?saved.appearance:undefined;
    }catch{return undefined;}
  };
  Card.prototype._homepageBackground=function(){
    const context=this._detailContext();
    return homepageBackground(savedDisplaySettings(context)??displayDefaults(context));
  };
  Card.prototype._overviewPreviewToolbar=function(){
    const display=this._previewMainDisplay??this._mainDisplay??savedDisplaySettings(this._detailContext())?.main_display??displayDefaults(this._detailContext()).main_display;
    const appearance=this._previewAppearance??this._savedHomepageAppearance()??(this._explicitAppearance?this._config?.appearance:this._preferences?.appearance??this._config?.appearance)??'auto';
    const group=(label,key,selected,choices)=>`<div class="overview-preview-group" role="group" aria-label="${label} preview"><span>${label}</span>${choices.map(([value,title])=>`<button type="button" data-preview-${key}="${value}" aria-pressed="${selected===value}">${title}</button>`).join('')}</div>`;
    return `<div class="overview-preview-toolbar" aria-label="Display preview">${group('Scene','display',display,[['house','House'],['flow','Flow'],['photo','Photo house']])}${group('Appearance','appearance',appearance,[['auto','Auto'],['day','Day'],['night','Night']])}${group('Layout','layout',this._previewLayout?.preset??'current',[['current','Default'],['classic','Classic'],['advanced','Advanced']])}<button type="button" class="overview-preview-reset" data-preview-reset>Reset</button></div>`;
  };
  Card.prototype._changeOverviewPreview=function(target){
    const reset=target.hasAttribute('data-preview-reset'),display=target.dataset.previewDisplay,appearance=target.dataset.previewAppearance,layout=target.dataset.previewLayout;
    if(!reset&&!['house','flow','photo'].includes(display)&&!['auto','day','night'].includes(appearance)&&!['current','classic','advanced'].includes(layout))return;
    const focus=reset?'[data-preview-reset]':['house','flow','photo'].includes(display)?`[data-preview-display="${display}"]`:['auto','day','night'].includes(appearance)?`[data-preview-appearance="${appearance}"]`:`[data-preview-layout="${layout}"]`;
    const apply=()=>{
      if(this._detailDialog)this._closeDetail();
      if(reset){delete this._previewMainDisplay;delete this._previewAppearance;delete this._previewLayout;}
      else if(['house','flow','photo'].includes(display))this._previewMainDisplay=display;
      else if(['auto','day','night'].includes(appearance))this._previewAppearance=appearance;
      else if(layout==='current')delete this._previewLayout;
      else if(Object.hasOwn(DISPLAY_PRESETS,layout)){
        const baseline=savedDisplaySettings(this._detailContext())??displayDefaults(this._detailContext()),preset=DISPLAY_PRESETS[layout];
        this._previewLayout={...baseline,preset:layout,order:[...preset.order],hidden:[...preset.hidden]};
      }
      this._render();
      this.shadowRoot?.querySelector?.(focus)?.focus?.();
    };
    if(this._detailDirty){this._detailPending=apply;return this._confirmDiscard();}
    apply();
  };
  Card.prototype._standaloneContent=function(){
    const view=this._view,ctx=this._detailContext(),heading=label=>`<h2>${escape(this._config.title??label)}</h2>`;
    if(view==='chart'){const kind=this._config.chart_kind??'power';return `<sigen-history-chart data-chart="${kind}"></sigen-history-chart>`;}
    if(view==='energy_today')return renderTodayEnergy(ctx);
    if(view==='energy_summary')return renderBatteryLevel(ctx);
    if(view==='power_summary')return `<section class="panel standalone-power">${heading('Live power')}${renderMobilePower({...ctx,has:key=>this._has(key)})}</section>`;
    if(view==='forecast_summary')return this._forecast();
    if(view==='devices')return this._devices();
    if(view==='mode_control')return `<section class="panel">${heading('Operating mode')}${this._overviewModeControl()}<div class="standalone-links">${link('energy_profile','Energy profile')}${link('strategies','Personal strategies')}</div></section>`;
    if(view==='connections_card')return `<section class="panel">${heading('Connections')}${this._connectionIndicators()}</section>`;
    if(view==='quick_controls')return this._controls({chargers:false});
    if(view==='photo')return this._photo();
    if(['ac','dc'].includes(view)){
      const label=view==='ac'?'AC charger':'DC charger',power=this._value(view+'_power'),energy=this._value(view+'_today','energy');
      return `<section class="panel charger-standalone">${heading(label)}<button type="button" class="standalone-device-reading" data-detail="${view}"><span><small>Charging power</small><strong>${power===null?'—':Math.abs(power).toLocaleString(undefined,{maximumFractionDigits:2})+' kW'}</strong></span><span><small>Charged today</small><strong>${energy===null?'—':energy.toLocaleString(undefined,{maximumFractionDigits:2})+' kWh'}</strong></span><b aria-hidden="true">›</b></button>${renderChargerControls(ctx,view)}<button type="button" class="detail-link" data-detail="${view}_chart">Charging history </button></section>`;
    }
    return null;
  };
  Card.prototype._content=function(){
    const standalone=this._standaloneContent();if(standalone!==null)return standalone;
    if(['dc_chart','dc_voltage_chart','dc_current_chart','dc_soc_chart','dc_metrics_chart'].includes(this._view)){const kind=this._view.slice(0,-6);return `<section class="panel"><h2>${escape(chartTitle(kind))}</h2><sigen-history-chart data-chart="${kind}"></sigen-history-chart></section>`;}
    if(WIDGET_ROUTES.includes(this._view))return renderSummaryWidget(this._view,this._detailContext());
    let content=originalContent.call(this);if(this._view==='battery'&&this._config.quick_controls===true)content+=this._controls({chargers:false});
    if(this._view==='overview')content=withServiceNavigation(content,this._tab);
    if(this._view==='overview'&&this._tab==='settings')return (content.match(/^<nav\b[\s\S]*?<\/nav>/)?.[0]??'')+renderSettingsDetail('settings',this._detailContext()).body;
    if(this._view==='overview'&&this._tab==='charts')return (content.match(/^<nav\b[\s\S]*?<\/nav>/)?.[0]??'')+this._chartsPage();
    if(this._view==='charts')return this._chartsPage();
    if(this._view!=='overview'||this._tab!=='overview')return content;
    const display=this._previewLayout??savedDisplaySettings(this._detailContext());
    const modules=['forecast','today','current_mode_battery','manual_controls'];
    const visible=display?display.order.filter(key=>!display.hidden.includes(key)&&modules.includes(key)):modules;
    const tabs=content.match(/^<nav\b[\s\S]*?<\/nav>/)?.[0]??'';
    return tabs+(this._config?.show_preview_controls===true?this._overviewPreviewToolbar():'')+this._overviewFrame(visible);
  };
  Card.prototype._chartsPage=function(){
    const charts=availableCharts(this),labels=new Map(charts);
    const selected=this._chartsRange??{period:'day',date:dateAt(this._now(),this._config.timezone??this._hass?.config?.time_zone??'UTC')},today=dateAt(this._now(),this._config.timezone??this._hass?.config?.time_zone??'UTC');
    const categories=CHART_GROUPS.map(([title,kinds],index)=>({title,index,kinds:kinds.filter(kind=>labels.has(kind))})).filter(group=>group.kinds.length);
    const groups=categories.map(({title,index,kinds})=>`<section class="chart-category" data-chart-category="${index}"><h2>${title}</h2><div class="chart-category-panels">${kinds.map(kind=>`<section class="panel chart-catalog-panel" data-chart-panel="${kind}"><sigen-history-chart data-chart="${kind}"></sigen-history-chart></section>`).join('')}</div></section>`).join('');
    return `<div class="chart-catalog" data-chart-catalog-key="${charts.map(([kind])=>kind).join(',')}"><div class="chart-toolbar-global" aria-label="All charts date range"><span>All charts</span><button type="button" data-charts-step="-1" aria-label="Previous chart period">‹</button><input type="date" data-charts-date aria-label="All charts date" value="${escape(selected.date)}" max="${today}"><button type="button" data-charts-step="1" aria-label="Next chart period">›</button><select data-charts-period aria-label="All charts period">${[['day','Day'],['week','Week'],['month','Month'],['year','Year'],['lifetime','Lifetime']].map(([value,label])=>`<option value="${value}"${value===selected.period?' selected':''}>${label}</option>`).join('')}</select></div><nav class="chart-category-jumps" aria-label="Chart categories">${categories.map(({title,index})=>`<button type="button" data-chart-jump="${index}">${title}</button>`).join('')}<button type="button" class="chart-customize" data-detail="chart_settings">Customize charts</button></nav>${groups}</div>`;
  };
  Card.prototype._pvStringsChart=function(){return solarStringSeries({inventory:this._config?.devices,entities:this._entities}).length>=2?'<section class="panel"><h2>PV strings</h2><sigen-history-chart data-chart="strings"></sigen-history-chart></section>':'';};
  Card.prototype._statisticsCard=function(){const selection=this._statsSelection??{period:'day',date:dateAt(this._now(),this._config.timezone??this._hass?.config?.time_zone??'UTC')},values=statisticsValues(this,selection.period,selection.date),proxy=Object.create(this),card=this;proxy._value=(key,kind)=>kind==='energy'&&Object.hasOwn(values,key)?values[key]:card._value(key,kind);return proxy;};
  Card.prototype._statistics=function(){
    const today=dateAt(this._now(),this._config.timezone??this._hass?.config?.time_zone??'UTC'),selected=this._statsSelection??{period:'day',date:today},labels={day:'Day',week:'Week',month:'Month',year:'Year',lifetime:'Lifetime'};
    const toolbar=`<div class="detail-toolbar"><button type="button" class="detail-icon" data-statistics-step="-1" aria-label="Previous energy period"${selected.period==='lifetime'?' disabled':''}>‹</button><input type="date" data-statistics-date aria-label="Energy statistics date" value="${escape(selected.date)}" max="${today}"${selected.period==='lifetime'?' disabled':''}><button type="button" class="detail-icon" data-statistics-step="1" aria-label="Next energy period"${selected.period==='lifetime'||selected.date>=today?' disabled':''}>›</button><select data-statistics-period aria-label="Energy statistics period">${Object.entries(labels).map(([value,label])=>`<option value="${value}"${selected.period===value?' selected':''}>${label}</option>`).join('')}</select></div>`;
    let body=originalStatistics.call(this._statisticsCard()).replace('Today · kWh',`${labels[selected.period]} · kWh`).replace('<svg class="statistics"',toolbar+'<svg class="statistics"');
    const unavailable=Object.values(statisticsValues(this,selected.period,selected.date)).every(value=>value===null);
    if(unavailable)body=body.replace('</section>','<p class="detail-empty">Energy totals unavailable for this period</p></section>');
    else if(!body.includes('<linearGradient')&&Object.values(statisticsValues(this,selected.period,selected.date)).some(value=>value>0))body=body.replace('</section>','<p class="detail-empty">Flow breakdown unavailable</p></section>');
    return body;
  };
  for(const [method,kind] of [['_power','power'],['_singlePower',null],['_priceChart','price']]){
    const original=Card.prototype[method];
    Card.prototype[method]=function(...args){return `<div data-upgrade-chart="${kind??({solar_chart:'solar',load_chart:'load',battery_chart:'battery',grid_chart:'grid'}[args[0]]??'power')}">${original.apply(this,args)}</div>`;};
  }
  Card.prototype._header=function(){if(this._config?.card_layout==='compact')return '';return originalHeader.call(this).replace('</header>','<div class="navigation-actions"><button type="button" data-detail="search" aria-label="Search your system" title="Search">⌕</button><button type="button" data-detail="plant" aria-label="Plant information" title="Plant information">ⓘ</button></div></header>');};
  Card.prototype._overviewModeControl=function(){return renderOverviewModeControl(this._detailContext());};
  Card.prototype._batteryExportRestriction=function(){
    const eligibility=strategyExportEligibility(this._detailContext());
    const reason=eligibility.permitted===false?'Export permission is off. ':eligibility.permitted===null?'Export permission is not confirmed. ':eligibility.battery_blocked?'Block Battery Grid Export is enabled. ':'';
    return reason.trim();
  };
  Card.prototype._chooseOverviewMode=function(target){
    const ctx=this._detailContext(),requested=target.value,observed=selectedMode(ctx);target.value=observed;
    if(requested===observed||!modeChoices(ctx).some(([mode])=>mode===requested))return;
    const review=()=>{
      this._openDetail('mode');
      const select=this._detailDialog?.querySelector('[data-settings-form="mode"] select[name="mode"]');
      if(select){select.value=requested;this._detailDirty=true;select.focus();}
    };
    if(this._detailDirty){this._detailPending=review;return this._confirmDiscard();}
    review();
  };
  Card.prototype._battery=function(){const body=originalBattery.call(this).replace('<div class="battery-summary">','<div class="battery-summary" data-detail="battery" role="button" tabindex="0" aria-label="SigenStor details">');return body+(this._config.card_layout==='compact'?'':`<div class="overview-device-links">${this._overviewModeControl()}${link('energy_profile','My Energy Profile')}${link('strategies','Personal Strategies')}</div>`);};
  Card.prototype._flow=function(){let html=originalFlow.call(this);const routes=['solar','battery','grid','load','ac','dc'].filter((kind)=>this._has(kind==='load'?'home_power':`${kind}_power`));let index=0;return html.replace(/<g><rect/g,()=>`<g data-detail="${routes[index++]??'plant'}" role="button" tabindex="0"><rect`);};
  Card.prototype._weatherEffectsEnabled=function(){return (this._previewLayout??savedDisplaySettings(this._detailContext()))?.immersive_weather===true;};
  Card.prototype._house=function(){
    const names={battery:'SigenStor',gateway:'Energy Gateway',ac:'AC charger',dc:'DC charger'};
    const weather=this._hass?.states[this._config.weather_entity]?.state,conditions={sunny:'sunny','clear-night':'sunny',partlycloudy:'cloudy',cloudy:'cloudy',fog:'fog',rainy:'rainy',pouring:'rainy',snowy:'snowy','snowy-rainy':'snowy',lightning:'thunder','lightning-rainy':'thunder'},condition=Object.hasOwn(conditions,weather)?conditions[weather]:null;
    const immersive=(this._previewLayout??savedDisplaySettings(this._detailContext()))?.immersive_weather===true&&condition?` immersive-weather weather-${condition}`:'';
    return originalHouse.call(this).replace('class="scene-wrap"',`class="scene-wrap${immersive}"`).replace('class="portal-status-bg"','data-detail="plant" role="button" tabindex="0" aria-label="System status" class="portal-status-bg"').replace('class="portal-temperature"','data-detail="weather" role="button" tabindex="0" aria-label="Weather details" class="portal-temperature"')
      .replace(/(<svg\b[^>]*class="portal-equipment"[^>]*data-equipment="(battery|gateway|ac|dc)"[^>]*>)([\s\S]*?)(<\/svg>)/g,(_,opening,route,body,closing)=>{
        const frame=opening.replace(/\s(?:data-detail|role|tabindex|aria-label)="[^"]*"/g,'');
        const image=body.replace(/<image\b([^>]*?)(\/?)>/g,(_,attributes,end)=>`<image${attributes.replace(/\s+pointer-events="[^"]*"/g,'')} pointer-events="none"${end}>`);
        const hit=image.replace(/class="portal-equipment-hit"/,'class="portal-equipment-hit"'+` data-detail="${route}" role="button" tabindex="0" aria-label="${names[route]} details"`);
        return frame+hit+closing;
      }).replace('</svg></div>',`${this._has('solar_power')?'<polygon points="478,290 665,325 601,500 427,436" fill="transparent" data-detail="solar" role="button" tabindex="0" aria-label="PV panels"/>':''}</svg></div>`);
  };
  Card.prototype._render=function(){
    const uiNight=this._uiNight?.()??this._night(),themeChanged=this._renderedUiNight!==undefined&&this._renderedUiNight!==uiNight;
    if(this.isConnected===true)this._loadSharedSettings();
    if(!this._dialogOpen){this._chartViews??=new Map();this._chartInstances??=new Map();for(const el of this.shadowRoot.querySelectorAll?.('sigen-history-chart')??[]){const key=`${el.dataset.chart}:${el.dataset.id??''}`;this._chartViews.set(key,el.data);this._chartInstances.set(key,el);}}
    const catalog=this.shadowRoot.querySelector?.('.chart-catalog'),chartsVisible=this._view==='charts'||this._view==='overview'&&this._tab==='charts';
    if(!this._dialogOpen&&!themeChanged&&this._view==='chart'&&this._chartPageConfig===this._config&&this.shadowRoot.querySelector?.('sigen-history-chart')){this._upgradeCharts();return;}
    // Telemetry refreshes must not detach the chart tree or its scroll anchor.
    if(!this._dialogOpen&&!themeChanged&&chartsVisible&&catalog&&this._chartPageConfig===this._config&&catalog.dataset.chartCatalogKey===availableCharts(this).map(([kind])=>kind).join(',')){const strip=this.shadowRoot.querySelector('.connection-strip');if(strip&&this._connectionIndicators)strip.outerHTML=this._connectionIndicators();this._upgradeCharts();return;}
    originalRender.call(this);
    if(!this._dialogOpen)this._renderedUiNight=uiNight;
    if(!this._dialogOpen&&this._view==='overview'){
      const nav=this.shadowRoot.querySelector?.('main > nav[aria-label="Energy sections"]'),header=this.shadowRoot.querySelector?.('ha-card > header');
      if(nav&&header){
        const row=document.createElement('div');row.className='primary-navigation';
        nav.before(row);row.appendChild(nav);
        for(const selector of ['.badges','.connection-strip']){const item=header.querySelector(selector);if(item)row.appendChild(item);}
        header.classList.add('compact-app-header');
      }
    }

    this._chartPageConfig=this._config;
    const style=this.shadowRoot.querySelector?.('style');if(style&&!style.dataset.navigation){style.textContent+=NAV_STYLE+HOME_STYLE+DETAIL_STYLE+SETTINGS_STYLE+WIDGET_STYLE+ENERGY_STYLE+VIEWPORT_STYLE+UX_STYLE+COMPACT_HEADER_STYLE+'\n.extended-energy-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:18px}.extended-energy-section{min-width:0}.extended-energy-section>.panel{height:100%;margin:0}.extended-statistics,.extended-power,.extended-today,.extended-tariff,.extended-energy_produced,.extended-environment,.extended-strategies{grid-column:1/-1}@container(max-width:700px){.extended-energy-grid{grid-template-columns:1fr}}';style.dataset.navigation='1';}
    if(!this._navigationBound){this._navigationBound=true;this.shadowRoot.addEventListener?.('click',event=>this._navigationClick(event),true);this.shadowRoot.addEventListener?.('keydown',event=>{const target=event.composedPath().find(el=>el?.matches?.('[role="button"][tabindex]'));if(target&&target.tagName?.toLowerCase()!=='button'&&['Enter',' '].includes(event.key)){event.preventDefault();target.dispatchEvent(new MouseEvent('click',{bubbles:true,composed:true}));}},true);}
    if(!this._homeKeysBound){this._homeKeysBound=true;this.shadowRoot.addEventListener?.('keydown',event=>{const menu=this.shadowRoot.querySelector('.home-menu'),button=this.shadowRoot.querySelector('[data-home-menu]');if(!menu)return;if(event.key==='ArrowDown'&&event.composedPath().includes(button)){menu.hidden=false;button.setAttribute('aria-expanded','true');}if(menu.hidden)return;if(event.key==='Escape'){event.preventDefault();this._closeHomeMenu();button?.focus();return;}if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const items=[...menu.querySelectorAll('button')],index=items.indexOf(this.shadowRoot.activeElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowUp'?-1:1)+items.length)%items.length;items[next]?.focus();}},true);}
    if(!this._statisticsBound){this._statisticsBound=true;this.shadowRoot.addEventListener?.('change',event=>{if(event.target?.matches?.('[data-statistics-date],[data-statistics-period]'))this._changeStatistics(event.target);},true);}
    if(!this._overviewModeBound){this._overviewModeBound=true;this.shadowRoot.addEventListener?.('change',event=>{if(event.target?.matches?.('[data-overview-mode]'))this._chooseOverviewMode(event.target);},true);}
    if(this._dialogOpen){this._refreshDetailReadings?.();return;}
    this._upgradeCharts();
    this._bindSankeyRoutes(this.shadowRoot);
    const panels=this.shadowRoot.querySelectorAll?.('main .panel')??[];
    for(const panel of panels){const heading=panel.querySelector('h2');if(!heading||panel.hasAttribute('data-card-detail'))continue;const route=/statistics/i.test(heading.textContent)?'statistics':/forecast/i.test(heading.textContent)?'forecast':/energy today/i.test(heading.textContent)?'energy':/tariff/i.test(heading.textContent)?'tariffs':/panel optimizers/i.test(heading.textContent)?'strings':null;if(route){panel.dataset.detail=route;panel.dataset.cardDetail=route;heading.dataset.detail=route;heading.setAttribute('role','button');heading.setAttribute('tabindex','0');heading.setAttribute('aria-label',`Open ${heading.textContent}`);}}
  };
  const renderNavigation=Card.prototype._render;
  Card.prototype._render=function(){
    const chartsVisible=this._view==='charts'||this._view==='overview'&&this._tab==='charts';
    return chartsVisible&&this.shadowRoot.querySelector?.('.chart-catalog')?preserveChartScroll(this,()=>renderNavigation.call(this)):renderNavigation.call(this);
  };
  Card.prototype._refreshDetailReadings=function(){
    if(!this._detailDialog||this._detailDirty||this._detailDialog.querySelector('form')||this._detailDialog.querySelector('.detail-unsaved'))return;
    const current=this._detailStack.at(-1);if(!current)return;
    const template=document.createElement('template');template.innerHTML=this._detailModel(current.route,current.id).body??'';
    for(const selector of ['.detail-metric strong','.detail-metric small','.detail-status','tbody td','tbody th','.detail-hero-copy p','.detail-inventory-tile small','.widget-metric strong','.widget-bottom-total strong','.widget-bottom-total small','.widget-detail-period .widget-badge','.widget-factor-list dd','.overview-charging-total strong','.overview-charging-breakdown .overview-energy-metric strong']){
      const previous=this._detailDialog.querySelectorAll(selector),next=template.content.querySelectorAll(selector);
      if(previous.length!==next.length)continue;
      previous.forEach((element,index)=>{if(element.textContent!==next[index].textContent)element.textContent=next[index].textContent;});
    }
    const previousMetrics=this._detailDialog.querySelectorAll('.detail-metric[data-entity]'),nextMetrics=template.content.querySelectorAll('.detail-metric[data-entity]');
    if(previousMetrics.length===nextMetrics.length)previousMetrics.forEach((element,index)=>{const label=nextMetrics[index].getAttribute('aria-label');if(label!==null&&element.getAttribute('aria-label')!==label)element.setAttribute('aria-label',label);});
    for(const field of ['symbol','condition','temperature']){
      const selector=`[data-weather-field="${field}"]`,previous=this._detailDialog.querySelector(selector),next=template.content.querySelector(selector);
      if(previous&&next&&previous.textContent!==next.textContent)previous.textContent=next.textContent;
    }
    for(const chart of this._detailDialog.querySelectorAll('sigen-history-chart')){
      if(chart._loading)continue;
      const kind=chart.dataset.chart??'power';
      chart.data=refreshedChartData(chart.data,this._chartData(kind,chart.dataset.id),kind);
    }
    if(current.route==='connections'){const body=this._detailDialog.querySelector('.detail-body');if(body)body.innerHTML=this._detailModel('connections').body;}
    if(current.route==='search')this._updateSearchResults();
  };
  Card.prototype._navigationClick=function(event){
    const el=event.composedPath().find(node=>node?.matches?.('[data-configure-connections],[data-options-menu],[data-options-submit],[data-detail],[data-detail-back],[data-detail-close],[data-entity],[data-save-settings],[data-manual],[data-discard-detail],[data-keep-editing],[data-statistics-step],[data-flow-source],[data-home-menu],[data-search-category],[data-download-records],[data-preview-display],[data-preview-appearance],[data-preview-layout],[data-preview-reset],[data-owner-setting],[data-charger-action],a[href]'));
    if(!el){this._closeHomeMenu();return;}
    if(el.hasAttribute('data-card-detail')){const input=event.composedPath().find(node=>node?.matches?.('input,select,textarea,button,a[href]'));if(input&&input!==el)return;}
    if(el.tagName?.toLowerCase()==='a'&&el.hasAttribute('href')){
      let safe=false;try{safe=['http:','https:'].includes(new URL(el.getAttribute('href'),globalThis.location?.href??'https://home-assistant.invalid/').protocol);}catch{}
      if(!safe||this._detailDirty){
        event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
        if(!safe)return;
        this._detailPending=()=>{el.click();this._closeDetail();};return this._confirmDiscard();
      }
      return;
    }
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    if(el.hasAttribute('data-home-menu')){const menu=this.shadowRoot.querySelector?.('.home-menu');if(menu){menu.hidden=!menu.hidden;el.setAttribute('aria-expanded',String(!menu.hidden));}return;}
    this._closeHomeMenu();
    if(['data-preview-display','data-preview-appearance','data-preview-layout','data-preview-reset'].some(attribute=>el.hasAttribute(attribute)))return this._changeOverviewPreview(el);
    if(el.hasAttribute('data-search-category')){this._searchSelection={...this._searchSelection,category:el.dataset.searchCategory};return this._updateSearchResults();}
    if(el.hasAttribute('data-configure-connections'))return this._startOptionsFlow();
    if(el.hasAttribute('data-options-menu'))return this._submitOptionsFlow({next_step_id:el.dataset.optionsMenu});
    if(el.hasAttribute('data-options-submit'))return this._submitOptionsFlow(this._optionsFlowData??{});
    if(el.hasAttribute('data-download-records'))return this._downloadRecords(el);
    if(el.hasAttribute('data-flow-source')){this._detailFlowInfo={source:el.dataset.flowSource,target:el.dataset.flowTarget,kwh:numeric(el.dataset.flowKwh)};return this._openDetail('flow_detail');}
    if(el.hasAttribute('data-statistics-step'))return this._changeStatistics(el);
    if(el.hasAttribute('data-keep-editing')){this._detailDialog.querySelector('.detail-unsaved')?.remove();this._detailPending=null;return;}
    if(el.hasAttribute('data-detail-close'))return this._closeDetail();
    if(el.hasAttribute('data-detail-back'))return this._backDetail();
    if(el.hasAttribute('data-discard-detail')){this._detailDirty=false;return this._runPendingDetail();}
    if(el.hasAttribute('data-owner-setting'))return this._sendOwnerSetting(el.dataset.ownerSetting,el.dataset.value==='true');
    if(el.hasAttribute('data-charger-action'))return this._sendOwnerSetting(`${el.dataset.chargerType}_charging`,el.dataset.chargerAction==='start',el.dataset.serial);
    if(el.hasAttribute('data-save-settings'))return this._saveDetail();
    if(el.dataset.manual)return this._openPreview(el.dataset.manual);
    if(el.dataset.detail){this._openDetail(el.dataset.detail,el.dataset.id);if(el.hasAttribute('data-display-weather'))this._detailDialog?.querySelector('[name="immersive_weather"]')?.focus();return;}
    const id=el.dataset.entity;if(!id)return this._openDetail('plant');
    if(this._detailDialog&&/^(sensor|binary_sensor|weather)\.[a-z0-9_]+$/.test(id)){
      const open=()=>{this._closeDetail();return this.dispatchEvent(new CustomEvent('hass-more-info',{detail:{entityId:id},bubbles:true,composed:true}));};
      if(this._detailDirty){this._detailPending=open;return this._confirmDiscard();}return open();
    }
    const module=(this._config.optimizers??[]).find(m=>Object.values(m).includes(id));
    const key=Object.keys(this._entities).find(key=>this._entities[key]===id);
    const route=module?'optimizer':routeForEntity(key??'');
    return this._openDetail(route,module?String(module.id??module.power):route==='sensor'?(key??id):undefined);
  };
  Card.prototype._bindSankeyRoutes=function(root){this._sankeyResize?.disconnect();for(const svg of root.querySelectorAll?.('svg.statistics')??[]){fitSankeyWidth(svg);if(typeof ResizeObserver!=='undefined'){this._sankeyResize??=new ResizeObserver(entries=>entries.forEach(entry=>fitSankeyWidth(entry.target)));this._sankeyResize.observe(svg);}}const routes={SOLAR:'solar',BATTERY:'battery',GRID:'grid',LOAD:'load',EVAC:'ac',EVDC:'dc'};for(const label of root.querySelectorAll?.('svg.statistics .sankey-label')??[]){const route=routes[label.textContent.trim()],group=label.closest('g');if(route&&group){group.dataset.detail=route;group.setAttribute('role','button');group.setAttribute('tabindex','0');group.setAttribute('aria-label',`${label.textContent.trim()} energy details`);}}};
  Card.prototype._changeStatistics=function(target){
    const root=target.closest('.panel'),date=root?.querySelector('[data-statistics-date]')?.value,period=root?.querySelector('[data-statistics-period]')?.value;
    if(!date||!['day','week','month','year','lifetime'].includes(period))return;
    const chosen=target.hasAttribute('data-statistics-step')?shiftDate(date,period,Number(target.dataset.statisticsStep)):date;
    const today=dateAt(this._now(),this._config.timezone??this._hass?.config?.time_zone??'UTC');if(chosen>today)return;
    this._statsSelection={period,date:chosen};
    if(this._detailDialog){const current=this._detailStack.at(-1);this._openDetail(current.route,current.id,true);}else this._render();
  };
  Card.prototype._detailContext=function(id){
    let options={};try{options=JSON.parse(localStorage.getItem(`sigen-hybrid:interface:${this._config.config_entry??this._config.title??'default'}`)??'{}');}catch{}
    options=mergeInterfacePreferences(options,this._sharedInterfaceOptions);
    const forecastConfiguration=this._forecastConfiguration;
    return {id,forecastConfiguration,connections:this._connectionOverview?.(),entities:this._entities,optimizers:this._config.optimizers??[],inventory:this._deviceInventory?.()??this._config.devices??[],history:this._history,now:this._now(),timezone:this._config.timezone??this._hass?.config?.time_zone??'UTC',currency:this._hass?.config?.currency??this._config.currency,haLocale:this._hass?.locale,haUnitSystem:this._hass?.config?.unit_system,haDarkMode:this._hass?.themes?.darkMode,night:this._night(),config:this._config,interfaceOptions:options,alertFilters:this._alertFilters??{},chargerRecordFilters:this._chargerRecordFilters??{},controlPermission:this._config.cloud_paused!==true&&this._state('control_status')?.attributes?.live_writes_locked===false&&this._state('control_status')?.attributes?.control_api_version===1&&this._state('control_status')?.attributes?.config_entry_id===this._config.config_entry,capabilities:this._state('control_status')?.attributes?.capabilities??{},state:key=>this._entities[key]?typeof this._state==='function'?this._state(key):this._hass?.states[this._entities[key]]:this._hass?.states[key],rawState:key=>this._hass?.states[this._entities[key]??key],value:(key,quantity='power')=>this._entities[key]?this._value(key,quantity):null,entity:key=>this._entities[key]??key};
  };
  Card.prototype._loadForecastConfiguration=async function(){
    const entry=this._config.config_entry;if(!entry||this._forecastConfigurationLoading)return;
    this._forecastConfigurationLoading=true;
    try{const result=await this._hass.callWS({type:'sigen_hybrid/forecast_configuration',config_entry:entry});if(this._config.config_entry===entry)this._forecastConfiguration=result;}
    catch{this._forecastConfiguration={error:'Could not load forecast settings. Close and reopen this page to retry.'};}
    finally{this._forecastConfigurationLoading=false;if(this._detailStack?.at(-1)?.route==='forecast_settings'&&!this._detailDirty)this._openDetail('forecast_settings',undefined,true);}
  };
  Card.prototype._bindForecastForm=function(){
    const form=this._detailDialog?.querySelector('[data-settings-form="forecast_settings"]');if(!form)return;
    const refresh=()=>{const selected=[...form.querySelectorAll('input[name="sources"]:checked')].map(input=>input.value),select=form.querySelector('select[name="primary_source"]');if(!select)return;const previous=select.value,choices=(this._forecastConfiguration?.sources??[]).filter(source=>selected.includes(source.id));select.innerHTML=choices.length?choices.map(source=>`<option value="${escape(source.id)}">${escape(`${source.name} · ${source.title}`)}</option>`).join(''):'<option value="">No source selected</option>';select.value=choices.some(source=>source.id===previous)?previous:choices[0]?.id??'';};
    const limits=()=>{const inputs=[...form.querySelectorAll('input[name="sources"]')],count=inputs.filter(input=>input.checked).length,average=form.querySelector('input[name="average"]')?.checked;for(const input of inputs){input.disabled=average&&count>=2&&!input.checked;input.title=input.disabled?'Select at most two sources for averaging':'';}};
    form.addEventListener('change',event=>{if(event.target?.name==='sources')refresh();limits();});limits();
  };
  Card.prototype._detailModel=function(route,id){
    if(route==='connection_setup')return this._optionsFlowPage();
    const ctx=this._detailContext(id);
    if(route==='energy_totals')return {title:'Energy totals',body:`<div class="chart-summary-grid">${['production','consumption','energy_produced'].map(kind=>renderSummaryWidget(kind,ctx)).join('')}</div>`};
    if(route==='charging_energy')return renderChargingEnergy(ctx);
    if(route==='search')return searchPage(ctx,this._searchSelection);
    if(route==='system_share')return {title:'System sharing',body:'<div class="detail-links"><a class="detail-link" href="/config/users"><span>Manage Home Assistant users</span></a></div>'};
    if(route==='data_download'){
      const choices=[['power','Power'],['solar','Solar'],['load','Load'],['battery','Battery'],['grid','Grid'],['soc','Battery SOC']],kind=choices.some(([key])=>key===id)?id:'power';
      return {title:'Data download',body:`<section class="record-download-controls"><label>Readings<select name="download_kind">${choices.map(([key,label])=>`<option value="${key}"${key===kind?' selected':''}>${label}</option>`).join('')}</select></label><label>Date<input type="date" name="download_date" value="${dateAt(this._now(),ctx.timezone)}" max="${dateAt(this._now(),ctx.timezone)}"></label><label>Period<select name="download_period">${[['day','Day'],['week','Week'],['month','Month'],['year','Year'],['lifetime','Lifetime']].map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><button type="button" class="detail-link" data-download-records>Download CSV <span aria-hidden="true">↓</span></button><output data-download-status aria-live="polite"></output></section>`};
    }
    if(route==='flow_detail'){const flow=this._detailFlowInfo??{},names={solar:'Solar Production & Forecast',battery:'Battery',grid:'Grid',home:'Home',load:'Load',ac:'AC charger',dc:'DC charger'},from=Object.hasOwn(names,flow.source)?names[flow.source]:'Source',to=Object.hasOwn(names,flow.target)?names[flow.target]:'Destination';return {title:`${from} → ${to}`,subtitle:'Estimated allocation',body:`<div class="detail-total-grid"><div class="detail-total"><small>Energy</small><strong>${flow.kwh===null||!Number.isFinite(flow.kwh)?'—':escape(flow.kwh.toLocaleString(undefined,{maximumFractionDigits:2})+' kWh')}</strong></div></div>${link('statistics','Period energy totals')}${link(routeForEntity((flow.source??'')+'_power'),from+' details')}${link(routeForEntity((flow.target??'')+'_power'),to+' details')}`};}
    if(DEVICE_ROUTES.has(route))return renderDeviceDetail(route,ctx);
    if(ENERGY_ROUTES.includes(route))return renderEnergyProfile(route,ctx);
    const summary=renderSummaryDetail(route,ctx);if(summary)return summary;
    if((Array.isArray(SETTINGS_ROUTES)?SETTINGS_ROUTES:new Set(SETTINGS_ROUTES)).has?.(route)||Array.isArray(SETTINGS_ROUTES)&&SETTINGS_ROUTES.includes(route))return renderSettingsDetail(route,ctx);
    if(route.endsWith('_chart')||route==='power'){const kind=route.replace('_chart','');return {title:chartTitle(kind),body:`<sigen-history-chart data-chart="${escape(kind)}"></sigen-history-chart>`};}
    if(['production','consumption','energy_produced'].includes(route))return {title:({production:'PV Production',consumption:'Consumption',energy_produced:'Energy Produced'})[route],body:`<div class="detail-total-grid">${totals(route==='energy_produced'?this._statisticsCard():this)}</div>${link('statistics','Energy flow breakdown')}${link('energy_value','Energy value')}${link('tariffs','Tariff plan')}`};
    if(['statistics','energy'].includes(route))return {title:'Energy Statistics',body:`${this._statistics()}<div class="detail-total-grid">${totals(this._statisticsCard())}</div>${link('production','PV Production')}${link('consumption','Consumption')}${link('energy_produced','Energy Produced')}`};
    const key=id??'',state=this._hass?.states[this._entities[key]??key];
    return {title:state?.attributes?.friendly_name??'Measurement details',body:`<dl class="detail-meta"><dt>Value</dt><dd>${escape(state?.state??'—')} ${escape(state?.attributes?.unit_of_measurement??'')}</dd><dt>Entity</dt><dd>${escape(this._entities[key]??key)}</dd><dt>Last updated</dt><dd>${escape(state?.last_updated??'—')}</dd></dl>${link('devices','Devices')}`};
  };
  Card.prototype._downloadRecords=async function(button){
    const root=this._detailDialog;if(!root)return;
    const output=root.querySelector('[data-download-status]'),kind=root.querySelector('[name="download_kind"]')?.value,period=root.querySelector('[name="download_period"]')?.value,date=root.querySelector('[name="download_date"]')?.value;
    if(!['power','solar','load','battery','grid','soc'].includes(kind)||!['day','week','month','year','lifetime'].includes(period))return;
    button.disabled=true;if(output)output.textContent='Loading recorded data…';
    try{
      const model=this._chartData(kind),timezone=this._config.timezone??this._hass?.config?.time_zone??'UTC',range=periodRange({period,date,timezone,now:this._now(),firstTime:model.lifetimeStart??0,weekStart:model.weekStart??1});
      if(range.start>this._now())throw new Error('Choose a current or past date.');
      const response=typeof model.load==='function'?await model.load({...range,period,date,timezone}):model.series;
      if(root!==this._detailDialog)return;
      const series=(Array.isArray(response)?response:response?.series??[]).filter(line=>line.forecast!==true),csv=toCSV(series,range);
      if(!csv.includes('\r\n')){if(output)output.textContent='No recorded data for this period.';return;}
      const blob=new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=`sigenergy-${kind}-${period}-${date}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      if(output)output.textContent='CSV downloaded.';
    }catch{if(root===this._detailDialog&&output)output.textContent='Recorded data could not be downloaded. Check the date and try again.';}
    finally{if(root===this._detailDialog)button.disabled=false;}
  };
  Card.prototype._openDetail=function(route,id,replace=false){
    const control=this._state('control_status')?.attributes;
    if(route==='safety'&&control?.control_api_version===1&&control.config_entry_id===this._config.config_entry)return this._startOptionsFlow('safety');
    if(this._detailDirty){this._detailPending=()=>this._openDetail(route,id,replace);return this._confirmDiscard();}
    if(route==='forecast_settings'&&!replace)this._forecastConfiguration=null;
    const seasonPrefix=route==='tariff_season'&&/^(import|export):new$/.test(id??'')?id.split(':')[0]+':':'';
    if(id==='new'&&['strategy','vehicle'].includes(route)||seasonPrefix){
      const saved=this._detailContext().interfaceOptions?.[route]??{};
      do{id=`${seasonPrefix}draft-${Date.now().toString(36)}-${(++draftSerial).toString(36)}`;}while(Object.hasOwn(saved,id));
    }
    const selected=(this._config.devices??[]).filter(item=>[item?.id,item?.serial,item?.serial_number,item?.serialNumber].some(value=>value!==undefined&&value!==null&&String(value)===String(id))),actualCharger=selected.length===1&&['ac','accharger','evac','dc','dccharger','evdc'].includes(String(selected[0].type??'').toLowerCase().replace(/[ _-]/g,''));
    const schedule=route==='charger_schedule'&&!actualCharger?decodeChargerScheduleId(id):null;
    if(schedule?.scheduleId==='new'){
      const saved=this._detailContext().interfaceOptions?.charger_schedule??{};
      do{id=encodeChargerScheduleId(schedule.chargerId,`draft-${Date.now().toString(36)}-${(++draftSerial).toString(36)}`);}while(Object.hasOwn(saved,id));
    }
    if(!this._detailDialog){this._detailFocus=this.shadowRoot.activeElement;this._detailStack=[];this._detailDialog=document.createElement('dialog');this._detailDialog.className=`sigen-detail${(this._uiNight?.()??this._night())?' night':''}`;this._dialogOpen=true;this.shadowRoot.appendChild(this._detailDialog);this._detailDialog.addEventListener('cancel',event=>{event.preventDefault();this._closeDetail();});this._detailDialog.addEventListener('click',event=>{if(event.target!==this._detailDialog)return;const r=this._detailDialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)this._closeDetail();});this._detailDialog.showModal();}
    if(!replace)this._detailStack.push({route,id});
    this._detailId=id;this._detailDirty=false;const model=this._detailModel(route,id);
    this._detailDialog.setAttribute('aria-labelledby','sigen-detail-heading');
    this._detailDialog.innerHTML=`<header class="detail-header"><button type="button" class="detail-icon" data-detail-back aria-label="Back">‹</button><div class="detail-heading"><h2 id="sigen-detail-heading">${escape(model.title)}</h2>${model.subtitle?`<p>${escape(model.subtitle)}</p>`:''}</div><button type="button" class="detail-icon" data-detail-close aria-label="Close details">×</button></header><div class="detail-body">${model.body??''}</div><output class="detail-save-notice" hidden aria-live="polite"></output>`;
    this._detailDialog.querySelectorAll('form').forEach(form=>{form.addEventListener('input',()=>{this._detailDirty=true;});form.addEventListener('change',()=>{this._detailDirty=true;});form.addEventListener('submit',event=>{event.preventDefault();this._saveDetail();});});
    this._detailDialog.scrollTop=0;this._detailDialog.querySelector('[data-detail-back]').focus();this._upgradeCharts(this._detailDialog);this._bindSankeyRoutes(this._detailDialog);
    this._bindDisplayForm();this._bindDashboardInstaller();this._bindOptionsForm();
    this._bindForecastForm();if(route==='forecast_settings'&&!replace)this._loadForecastConfiguration();
    for(const form of this._detailDialog.querySelectorAll('[data-settings-form="tariff_edit"],[data-settings-form="tariff_season"]'))bindTariffEditor(form,this._detailContext(),()=>{this._detailDirty=true;});
    for(const form of this._detailDialog.querySelectorAll('[data-settings-form="strategy"]'))bindStrategyEditor(form,this._detailContext());
    this._bindAlertFilters();
    this._bindChargerRecordFilters();
    const search=this._detailDialog.querySelector('[data-search-input]');if(search){search.addEventListener('input',()=>{this._searchSelection={...this._searchSelection,query:search.value.slice(0,160)};this._updateSearchResults();});search.focus();}
  };
  Card.prototype._closeHomeMenu=function(){const menu=this.shadowRoot?.querySelector?.('.home-menu'),button=this.shadowRoot?.querySelector?.('[data-home-menu]');if(menu)menu.hidden=true;button?.setAttribute('aria-expanded','false');};
  Card.prototype._updateSearchResults=function(){
    const root=this._detailDialog,results=root?.querySelector('.search-results');if(!results)return;
    const selection=this._searchSelection??{};results.innerHTML=searchRows(this._detailContext(),selection.query??'',selection.category??'all');
    for(const button of root.querySelectorAll('[data-search-category]'))button.setAttribute('aria-pressed',String(button.dataset.searchCategory===(selection.category??'all')));
  };
  Card.prototype._displayDraft=function(form){
    const keys=DISPLAY_MODULES.map(item=>item.key);
    return {main_display:form.querySelector('[name="main_display"]')?.value,appearance:form.querySelector('[name="appearance"]')?.value,background_type:form.querySelector('[name="background_type"]')?.value,background_color:form.querySelector('[name="background_color"]')?.value,background_image:form.querySelector('[name="background_image"]')?.value,preset:form.querySelector('[data-display-preset]')?.value??'custom',order:[...(form._displayOrder??keys)],hidden:keys.filter(key=>!form.querySelector(`[name="visible"][value="${key}"]`)?.checked),immersive_weather:form.querySelector('[name="immersive_weather"]')?.checked===true};
  };
  Card.prototype._writeDisplayDraft=function(form,value,dirty=true){
    const order=moveDisplayModule(value.order,value.order?.[0],0);if(!order)return;
    form._displayOrder=order;const hidden=new Set(value.hidden??[]),list=form.querySelector('.settings-display-list');
    order.forEach((key,index)=>{const select=form.querySelector(`[name="order_${key}"]`),check=form.querySelector(`[name="visible"][value="${key}"]`),row=form.querySelector(`[data-display-row][data-display-key="${key}"]`);if(select)select.value=String(index+1);if(check)check.checked=!hidden.has(key);if(list&&row)list.appendChild(row);});
    const preset=form.querySelector('[data-display-preset]'),weather=form.querySelector('[name="immersive_weather"]'),main=form.querySelector('[name="main_display"]'),appearance=form.querySelector('[name="appearance"]');
    if(main&&['house','flow','photo'].includes(value.main_display))main.value=value.main_display;
    if(appearance&&HOMEPAGE_APPEARANCES.includes(value.appearance))appearance.value=value.appearance;
    const background=form.querySelector('[name="background_type"]'),color=form.querySelector('[name="background_color"]'),image=form.querySelector('[name="background_image"]');
    if(background&&HOMEPAGE_BACKGROUNDS.includes(value.background_type))background.value=value.background_type;
    if(color&&typeof value.background_color==='string'&&/^#[0-9a-f]{6}$/i.test(value.background_color))color.value=value.background_color;
    if(image&&typeof value.background_image==='string')image.value=value.background_image;
    if(preset)preset.value=['custom','classic','advanced'].includes(value.preset)?value.preset:'custom';if(weather)weather.checked=value.immersive_weather===true;
    if(dirty)this._detailDirty=true;
  };
  Card.prototype._bindDisplayForm=function(){
    const form=this._detailDialog?.querySelector('[data-settings-form="display_settings"]');if(!form||form._displayBound)return;form._displayBound=true;
    let initial;try{initial=collectSettings('display_settings',form,this._detailContext());}catch{initial=displayDefaults(this._detailContext());}this._writeDisplayDraft(form,initial,false);
    form.addEventListener('click',event=>{const target=event.target?.closest?.('[data-display-move],[data-display-restore]');if(!target)return;event.preventDefault();if(target.hasAttribute('data-display-restore'))return this._writeDisplayDraft(form,displayDefaults(this._detailContext()));const draft=this._displayDraft(form),position=draft.order.indexOf(target.dataset.displayKey),order=moveDisplayModule(draft.order,target.dataset.displayKey,position+Number(target.dataset.displayMove));if(order)this._writeDisplayDraft(form,{...draft,preset:'custom',order});});
    form.addEventListener('change',event=>{const target=event.target;if(target?.matches?.('[data-display-preset]')){const preset=Object.hasOwn(DISPLAY_PRESETS,target.value)?DISPLAY_PRESETS[target.value]:null;if(preset)this._writeDisplayDraft(form,{...this._displayDraft(form),...preset,preset:target.value});}else if(target?.name?.startsWith('order_')){const draft=this._displayDraft(form),order=moveDisplayModule(draft.order,target.name.slice(6),Number(target.value)-1);if(order)this._writeDisplayDraft(form,{...draft,preset:'custom',order});}else if(target?.name==='visible'){const preset=form.querySelector('[data-display-preset]');if(preset)preset.value='custom';}});
    form.addEventListener('dragstart',event=>{const row=event.target?.closest?.('[data-display-row]');if(!row||event.target?.closest?.('input,select,button'))return;form._displayDragKey=row.dataset.displayKey;event.dataTransfer?.setData('text/plain',form._displayDragKey);});
    form.addEventListener('dragover',event=>{if(form._displayDragKey&&event.target?.closest?.('[data-display-row]'))event.preventDefault();});
    form.addEventListener('drop',event=>{const row=event.target?.closest?.('[data-display-row]'),draft=this._displayDraft(form);if(!row||!form._displayDragKey)return;event.preventDefault();const order=moveDisplayModule(draft.order,form._displayDragKey,draft.order.indexOf(row.dataset.displayKey));if(order)this._writeDisplayDraft(form,{...draft,preset:'custom',order});form._displayDragKey=null;});
    form.addEventListener('dragend',()=>{form._displayDragKey=null;});
  };
  Card.prototype._bindAlertFilters=function(){
    for(const input of this._detailDialog?.querySelectorAll('[data-alert-filter]')??[]){
      const update=()=>{const key=input.dataset.alertFilter;if(!['query','type','from','to'].includes(key))return;const value=String(input.value??'').slice(0,key==='query'?160:20);this._alertFilters={...this._alertFilters,[key]:value};const selection=[input.selectionStart,input.selectionEnd],current=this._detailStack.at(-1);this._openDetail(current.route,current.id,true);const next=this._detailDialog.querySelector(`[data-alert-filter="${key}"]`);next?.focus();if(key==='query'&&typeof next?.setSelectionRange==='function')next.setSelectionRange(...selection);};
      input.addEventListener(input.type==='search'||input.type==='text'?'input':'change',update);
    }
  };
  Card.prototype._bindChargerRecordFilters=function(){
    for(const input of this._detailDialog?.querySelectorAll('[data-charger-record-filter]')??[]){
      input.addEventListener('change',()=>{
        const key=input.dataset.chargerRecordFilter,id=input.dataset.chargerRecordDevice,current=this._detailStack.at(-1);
        if(!['from','to'].includes(key)||typeof id!=='string'||!id||current?.route!=='charger_records')return;
        const filters={...(this._chargerRecordFilters??{})},previous=Object.hasOwn(filters,id)?filters[id]:{};
        Object.defineProperty(filters,id,{value:{...previous,[key]:String(input.value??'').slice(0,10)},enumerable:true,configurable:true,writable:true});this._chargerRecordFilters=filters;
        this._openDetail(current.route,current.id,true);
        this._detailDialog?.querySelector(`[data-charger-record-filter="${key}"]`)?.focus();
      });
    }
  };
  Card.prototype._confirmDiscard=function(){if(this._detailDialog.querySelector('.detail-unsaved'))return;const overlay=document.createElement('div');overlay.className='detail-unsaved';overlay.setAttribute('role','alertdialog');overlay.setAttribute('aria-label','Unsaved changes');overlay.style.cssText='position:fixed;inset:0;z-index:20;display:grid;place-content:center;padding:24px;background:#142c4977;backdrop-filter:blur(4px)';overlay.innerHTML='<section class="detail-confirm"><h3>Unsaved changes</h3><p>Save your dashboard preferences or discard these changes.</p><button type="button" data-save-settings>Save</button><button type="button" data-discard-detail>Discard</button><button type="button" data-keep-editing>Keep editing</button></section>';this._detailDialog.appendChild(overlay);overlay.querySelector('button').focus();};
  Card.prototype._runPendingDetail=function(){const next=this._detailPending;this._detailPending=null;next?.();};
  Card.prototype._backDetail=function(){if(this._detailDirty){this._detailPending=()=>this._backDetail();return this._confirmDiscard();}if(this._detailStack.length<=1)return this._closeDetail();if(this._detailStack.at(-1)?.route==='connection_setup')this._cancelOptionsFlow();this._detailStack.pop();const previous=this._detailStack.at(-1);this._openDetail(previous.route,previous.id,true);};
  Card.prototype._cancelOptionsFlow=function(){const flow=this._optionsFlow;this._optionsGeneration=(this._optionsGeneration??0)+1;this._optionsFlow=null;this._optionsFlowData={};if(flow?.flow_id&&['menu','form'].includes(flow.type))this._hass.callApi('DELETE',`config/config_entries/options/flow/${flow.flow_id}`).catch(()=>{});};
  Card.prototype._closeDetail=function(){if(this._detailDirty){this._detailPending=()=>this._closeDetail();return this._confirmDiscard();}const d=this._detailDialog;if(!d)return;this._cancelOptionsFlow();this._detailDialog=null;this._detailStack=[];d.close();d.remove();this._dialogOpen=false;if(this._renderPending){this._renderPending=false;this._render();}this._detailFocus?.focus?.();};
  Card.prototype._saveDetail=async function(){
    const current=this._detailStack.at(-1),form=this._detailDialog.querySelector('[data-settings-form]');if(!form)return;
    this._detailDialog.querySelector('.detail-unsaved')?.remove();const output=this._detailDialog.querySelector('.detail-save-notice');
    try{
      if(!form.reportValidity())return;if(['__proto__','constructor','prototype'].includes(current.id))throw new Error('Invalid settings identifier');
      const draft=collectSettings(current.route,form,this._detailContext(current.id)),storageKey=`sigen-hybrid:interface:${this._config.config_entry??this._config.title??'default'}`;
      if(current.route==='mode'&&nativeModeChoices(this._detailContext()).length){
        const [mode,profile_id]=draft.mode.split(':').map(Number);
        await this._sendOwnerSetting('native_mode',{mode,profile_id});
      }else if(current.route==='app_settings'){
        await this._saveAccountPreferences(draft);output.textContent='Home Assistant preferences saved';
      }else if(current.route==='forecast_settings'){
        if(!this._forecastConfiguration?.revision)throw new Error('Reload forecast settings before saving');
        this._forecastConfiguration=await this._hass.callWS({type:'sigen_hybrid/forecast_configuration',config_entry:this._config.config_entry,save:true,revision:this._forecastConfiguration.revision,sources:draft.sources,primary_source:draft.primary_source,average:draft.average});
        output.textContent='Forecast settings saved';
      }else if(!PERSONAL_SETTINGS.has(current.route)){
        await this._saveSharedSetting(current.route,current.id,draft);output.textContent=['strategy','strategy_control','tariff_edit','tariff_season'].includes(current.route)?'Saved in Home Assistant':'Draft saved in Home Assistant';
      }else{
        let options={};try{options=JSON.parse(localStorage.getItem(storageKey)??'{}');}catch{}
        if(!options||typeof options!=='object'||Array.isArray(options))options={};
        if(current.id){options[current.route]??={};options[current.route][current.id]=draft;}else options[current.route]=draft;
        localStorage.setItem(storageKey,JSON.stringify(options));output.textContent='Preferences saved';
      }
      this._detailDirty=false;output.hidden=false;
      if(['display_settings','chart_settings'].includes(current.route)){this._scene=null;this._renderPending=true;}
      if(this._detailPending)this._runPendingDetail();
    }catch(error){output.hidden=false;output.textContent=error.message??'Check the entered settings';}
  };
  Card.prototype._sendOwnerSetting=async function(setting,value,serial){
    const control=this._state('control_status')?.attributes??{},feature=setting==='grid_connection'?'grid_switch':setting;
    const output=this._detailDialog?.querySelector('.detail-save-notice')??this.shadowRoot.querySelector('.instant-manual-panel output');
    const show=message=>{this._result=message;if(output){output.hidden=false;output.textContent=message;}};
    if(!this._detailContext().controlPermission||control.capabilities?.[feature]?.available!==true){show('This control is temporarily unavailable.');return;}
    const signature=JSON.stringify({setting,value,serial}),previous=this._ownerSettingRequest;
    const reuse=previous?.signature===signature&&(previous.uncertain===true||control.operation?.request_id===previous.id&&['queued','uncertain','interrupted','recovery_pending'].includes(control.operation.phase));
    const id=reuse?previous.id:globalThis.crypto?.randomUUID?.()??`owner-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this._ownerSettingRequest={id,signature,uncertain:true};
    show('Checking plant state');
    try{
      const result=await this._hass.callWS({type:'call_service',domain:'sigen_hybrid',service:'owner_setting',return_response:true,service_data:{config_entry:control.config_entry_id,setting,value,request_id:id,dry_run:false,...(serial?{serial}:{})}});
      show(result?.response?.message??'Request submitted; awaiting controller status.');
      this._syncOwnerSetting();
    }catch{show('Request not confirmed. Check controller status before retrying.');}
  };
  Card.prototype._syncOwnerSetting=function(){
    const request=this._ownerSettingRequest,op=this._state('control_status')?.attributes?.operation;
    if(!request||op?.request_id!==request.id)return;
    const pending=['queued','cancelling','uncertain','interrupted','recovery_pending'].includes(op.phase);
    request.uncertain=pending;
    const output=this._detailDialog?.querySelector('.detail-save-notice')??this.shadowRoot.querySelector('.instant-manual-panel output');
    if(op.message){this._result=op.message;if(output){output.hidden=false;output.textContent=op.message;}}
    for(const button of this._detailDialog?.querySelectorAll('[data-save-settings],[data-owner-setting]')??[])button.disabled=pending;
  };
  Card.prototype._openPreview=function(mode){if(this._detailDirty){this._detailPending=()=>this._openPreview(mode);return this._confirmDiscard();}const previous=this._detailStack?.map(item=>({...item})),last=previous?.at(-1);if(this._detailDialog)this._closeDetail();originalManual.call(this,mode);if(last){const d=this.shadowRoot.querySelector('dialog');d?.addEventListener('close',()=>{this._openDetail(last.route,last.id);this._detailStack=previous;});}};
  Card.prototype._chartData=function(kind,chartId){
    let context=this;
    if(chartId!==undefined&&chartId!==null&&String(chartId)!==''){
      context=Object.create(this);context._detailId=chartId;context._scopedHistory=true;
      const matches=(this._config.devices??[]).filter(item=>[item?.id,item?.serial,item?.serial_number,item?.serialNumber].some(id=>id!==undefined&&id!==null&&String(id)===String(chartId))),device=matches.length===1?matches[0]:undefined;
      if(kind!=='optimizer'){
        const definitions=Object.hasOwn(CHARTS,kind)?CHARTS[kind]:CHARTS.power,mapping=device?.entities??{},entities={...this._entities};
        const singleCharger=device&&(device.type??device.kind)===kind&&['ac','dc'].includes(kind)&&(this._config.devices??[]).filter(item=>(item.type??item.kind)===kind).length===1;
        for(const [key] of definitions){
          const ownEntity=mapping[key]??(definitions.length===1&&!(kind==='solar'&&(device?.type??device?.kind)==='inverter')?mapping.power:null);
          entities[key]=ownEntity??(singleCharger?this._entities[key]:null);
        }
        context._config={...this._config,entities};
      }
    }
    const forecast=kind==='forecast',series=historySeries(context,kind),times=series.flatMap(s=>s.points.map(p=>p.time)),now=forecast?Date.now():this._now();
    const timezone=this._config.timezone??this._hass?.config?.time_zone??'UTC',weekStart=this._config.week_start??this._config.weekStart??1,date=dateAt(now,timezone),day=periodRange({period:'day',date,timezone,now});
    const hasForecast=series.some(line=>line.forecast===true),ends=hasForecast?(context._state('forecast_today')?.attributes?.series??context._config?.forecast_series??[]).map(point=>epoch(point.end)).filter(Number.isFinite):[];
    const start=forecast&&times.length?Math.min(day.start,...times):day.start,end=forecast&&times.length?Math.max(day.end,...times,...ends):day.end;
    const commissioned=Date.parse(this._config.history_start??''),lifetimeStart=Number.isFinite(commissioned)?commissioned:0;
    const horizon=hasForecast?Math.max(end,...ends,...series.filter(line=>line.forecast).flatMap(line=>line.points.map(point=>point.time))):null;
    const sun=this._hass?.states[this._config.sun_entity??'sun.sun']?.attributes??{};
    return {title:chartTitle(kind),series,now,start,end,period:'day',date,weekStart,sunrise:this._config.sun_events?.sunrise??sun.next_rising,sunset:this._config.sun_events?.sunset??sun.next_setting,...(horizon!==null?{maxFuture:horizon}:{}),lifetimeStart,timezone,loadKey:`${this._config.config_entry??'local'}:${kind}:${chartId??''}`,load:async range=>{
      if(this._config.recorded_history||forecast)return historySeries(context,kind);
      const optimizer=(this._config.optimizers??[]).find((m,index)=>String(m.id??index)===String(context._detailId)||m.power===context._detailId);
      const definitions=Object.hasOwn(CHARTS,kind)?CHARTS[kind]:CHARTS.power;
      const ids=[...new Set((kind==='optimizer'?[optimizer?.power??context._detailId]:['strings','pv_metrics'].includes(kind)?[...solarStringSeries({inventory:context._config?.devices,entities:context._entities}).map(source=>source.entity_id),...(kind==='pv_metrics'?definitions.map(([key])=>context._entities[key]):[])]:definitions.map(([key])=>context._entities[key])).filter(id=>/^(sensor|binary_sensor)\.[a-z0-9_]+$/.test(id??'')))];
      const selectedStart=Math.max(range.start,lifetimeStart),period=range.period==='day'?'5minute':['week','month'].includes(range.period)?'hour':'day';
      const aliases=context._scopedHistory?{}:Object.fromEntries(definitions.map(([key])=>[key,context._config.history_entities?.[key]]).filter(([,id])=>/^sensor\.[a-z0-9_]+$/.test(id??'')));
      const localIds=[...new Set([...ids,...Object.values(aliases)])];
      const local=async()=>{
        if(!localIds.length||selectedStart>=range.end||typeof this._hass?.callWS!=='function')return [];
        const cacheKey=JSON.stringify([historyConnectionKey(this),this._config.config_entry,localIds,selectedStart,range.end,period,Math.floor(Date.now()/60000)]);
        if(!detailHistoryCache.has(cacheKey))detailHistoryCache.set(cacheKey,this._hass.callWS({type:'recorder/statistics_during_period',start_time:new Date(selectedStart).toISOString(),end_time:new Date(range.end).toISOString(),statistic_ids:localIds,period,types:['mean']}));
        while(detailHistoryCache.size>60)detailHistoryCache.delete(detailHistoryCache.keys().next().value);
        try{
          const rows=await detailHistoryCache.get(cacheKey),current=historySeries(context,kind,rows);
          if(!Object.keys(aliases).length)return current;
          const earlier=Object.create(context);earlier._config={...context._config,entities:{...context._entities,...aliases}};
          Object.defineProperty(earlier,'_entities',{value:earlier._config.entities});
          earlier._state=key=>earlier._hass?.states[earlier._entities[key]??key];
          return mergeHistorySeries(current,historySeries(earlier,kind,rows));
        }catch(error){detailHistoryCache.delete(cacheKey);throw error;}
      };
      const cloudKind=kind==='dc_metrics'?'dc':kind;
      const cloudAllowed=!context._scopedHistory&&Boolean(this._config.config_entry)&&['power','solar','load','battery','grid','soc','price','ac','dc'].includes(cloudKind)&&typeof this._hass?.callWS==='function';
      if(!cloudAllowed)return local();
      const cloud=async()=>{
        const selectedDate=range.date??dateAt(range.start,timezone),key=JSON.stringify([historyConnectionKey(this),this._config.config_entry,cloudKind,range.period,range.start,range.end,Math.floor(Date.now()/300000)]);
        if(!cloudHistoryCache.has(key))cloudHistoryCache.set(key,this._hass.callWS({type:'sigen_hybrid/history',config_entry:this._config.config_entry,kind:cloudKind,period:range.period,date:selectedDate,start_time:new Date(range.start).toISOString(),end_time:new Date(range.end).toISOString()}));
        while(cloudHistoryCache.size>96)cloudHistoryCache.delete(cloudHistoryCache.keys().next().value);
        try{return await cloudHistoryCache.get(key);}catch{cloudHistoryCache.delete(key);return null;}
      };
      let native=[],remote=[],ownerValue=null;
      const combined=()=>{
        // Period API values are measured kWh totals, never averages of native kW.
        if(range.period!=='day'&&remote.some(line=>line.unit==='kWh'&&line.points?.some(point=>point.value!==null)))return {...ownerValue,series:remote,chartType:'bar'};
        return {series:mergeHistorySeries(native,remote),chartType:'line',source:remote.length?'sigenergy_cloud_and_recorder':'local_recorder'};
      };
      const publish=()=>range.onUpdate?.(combined());
      const [recorded]=await Promise.allSettled([
        local().then(value=>{native=value;publish();return value;}),
        cloud().then(value=>{ownerValue=value;remote=Array.isArray(value?.series)?value.series:[];publish();return value;}),
      ]);
      if(!remote.length&&recorded.status==='rejected')throw recorded.reason;
      return combined();
    }};
  };
  Card.prototype._synchronizeChartRange=function(period,date,origin){
    this._chartsRange={period,date};
    for(const chart of this.shadowRoot.querySelectorAll?.('.chart-catalog sigen-history-chart')??[])if(chart!==origin)chart._change(period,date);
    this._updateChartToolbar();
  };
  Card.prototype._updateChartToolbar=function(){
    const toolbar=this.shadowRoot.querySelector?.('.chart-toolbar-global');if(!toolbar)return;
    const selected=this._chartsRange??{period:'day',date:dateAt(this._now(),this._config.timezone??this._hass?.config?.time_zone??'UTC')},today=dateAt(this._now(),this._config.timezone??this._hass?.config?.time_zone??'UTC');
    const date=toolbar.querySelector('[data-charts-date]'),period=toolbar.querySelector('[data-charts-period]');date.value=selected.date;period.value=selected.period;date.disabled=selected.period==='lifetime';
    for(const button of toolbar.querySelectorAll('[data-charts-step]'))button.disabled=selected.period==='lifetime'||button.dataset.chartsStep==='1'&&selected.date>=today;
    if(toolbar.dataset.bound)return;toolbar.dataset.bound='1';
    const change=step=>{const chosen=step?shiftDate(date.value,period.value,step):date.value;if(chosen>today)return;this._synchronizeChartRange(period.value,chosen);};
    date.addEventListener('change',()=>change(0));period.addEventListener('change',()=>change(0));
    for(const button of toolbar.querySelectorAll('[data-charts-step]'))button.addEventListener('click',()=>change(Number(button.dataset.chartsStep)));
    // Complete category navigation before live chart refreshes preserve scroll positions.
    for(const button of this.shadowRoot.querySelectorAll('[data-chart-jump]'))button.addEventListener('click',()=>this.shadowRoot.querySelector(`[data-chart-category="${button.dataset.chartJump}"]`)?.scrollIntoView({behavior:'auto',block:'start'}));
  };
  Card.prototype._upgradeCharts=function(root=this.shadowRoot){
    for(const host of root.querySelectorAll?.('[data-upgrade-chart]')??[]){const kind=host.dataset.upgradeChart,target=host.querySelector('svg.chart,.chart-empty');if(!target)continue;host.querySelectorAll('.legend,.section-title>small').forEach(el=>el.remove());const chart=document.createElement('sigen-history-chart');chart.dataset.chart=kind;target.replaceWith(chart);}
    const shared=root===this.shadowRoot&&Boolean(root.querySelector?.('.chart-catalog'));let index=0;
    for(let chart of root.querySelectorAll?.('sigen-history-chart')??[]){
      const key=`${chart.dataset.chart}:${chart.dataset.id??''}`,data={...this._chartData(chart.dataset.chart??'power',chart.dataset.id),compact:root===this.shadowRoot&&this._view!=='chart'},previous=root===this.shadowRoot?this._chartViews?.get(key):null,existing=root===this.shadowRoot?this._chartInstances?.get(key):null;
      if(existing&&existing!==chart){chart.replaceWith(existing);chart=existing;}
      if(shared){
        this._chartsRange??={period:data.period,date:data.date};
        const selection=this._chartsRange;
        chart.data={...data,...selection,...periodRange({...data,...selection,firstTime:data.lifetimeStart}),hideControls:true};index++;
        if(!chart._sharedRangeBound){chart._sharedRangeBound=true;chart.addEventListener('sigen-chart-range-change',event=>{this._synchronizeChartRange(event.detail.period,event.detail.date,chart);});}
      }else{
        const selected=previous&&(previous.period!=='day'||previous.date!==data.date);chart.data=selected?{...previous,title:data.title,now:data.now,load:data.load,compact:data.compact,hideControls:false}:{...data,hideControls:false};
      }
    }
    if(shared)this._updateChartToolbar();
  };
}
