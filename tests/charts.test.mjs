import test from 'node:test';
import assert from 'node:assert/strict';
import {dateAt,periodRange,shiftDate,sunEvents,normalizeSeries,nearestPoint,gapPaths,csvEscape,toCSV,SigenHistoryChart,preserveChartScroll} from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-charts.js';

test('local progress renders before Cloud completes without duplicate refresh or stale date overwrite',async()=>{
  const chart=new SigenHistoryChart(),now=Date.parse('2026-10-29T12:00:00Z'),pending=[];
  chart.data={title:'Power',loadKey:'progress-power',now,timezone:'UTC',date:'2026-10-29',series:[],load:range=>new Promise(resolve=>pending.push({range,resolve}))};
  const first=chart._change('day','2026-10-29');
  pending[0].range.onUpdate({series:[{key:'grid',unit:'kW',points:[{time:now,value:2}]}]});
  assert.equal(chart._loading,false);assert.equal(chart._pendingLoad,true);assert.equal(chart.data.series[0].points[0].value,2);
  chart._active=true;chart._loadedAt=0;chart._autoLoad();await Promise.resolve();assert.equal(pending.length,1);
  chart._active=false;
  const second=chart._change('day','2026-10-28');
  pending[0].range.onUpdate({series:[{key:'stale',unit:'kW',points:[{time:now,value:999}]}]});
  assert.notEqual(chart.data.series[0].key,'stale');
  pending[1].resolve({series:[{key:'grid',unit:'kW',points:[{time:now-86400000,value:3}]}]});await second;
  pending[0].resolve({series:[{key:'stale',unit:'kW',points:[{time:now,value:999}]}]});await first;
  assert.equal(chart.data.date,'2026-10-28');assert.equal(chart.data.series[0].points[0].value,3);assert.equal(chart._pendingLoad,false);
});

test('background failure preserves rendered local history and shared chart controls remain usable',async()=>{
  const chart=new SigenHistoryChart(),now=Date.parse('2026-10-29T12:00:00Z');
  chart.data={title:'Power',loadKey:'partial-failure',now,timezone:'UTC',date:'2026-10-29',hideControls:true,series:[],load:async range=>{
    range.onUpdate({series:[{key:'grid',unit:'kW',points:[{time:now,value:0}]}]});throw Error('Cloud offline');
  }};
  await chart._change('day','2026-10-29');assert.equal(chart.data.series[0].points[0].value,0);assert.equal(chart._error,'');
  chart._loading=true;
  assert.match(chart._template(false),/class="controls" hidden/);
  assert.doesNotMatch(chart._template(true),/class="controls" hidden/);
  assert.doesNotMatch(chart._template(true),/class="date"[^>]*disabled|class="period"[^>]*disabled/);
});

test('compact multi-unit plots keep the same total height while expanded plots retain detail',()=>{
  const chart=new SigenHistoryChart(),now=Date.parse('2026-10-27T12:00:00Z');
  const series=['kW','V','A'].map((unit,index)=>({key:String(index),unit,points:[{time:now,value:index+1}]}));
  chart.data={now,date:'2026-10-27',timezone:'UTC',series:[series[0]]};
  const single=chart._plot(false).match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)[1];
  chart.data={now,date:'2026-10-27',timezone:'UTC',series};
  const combined=chart._plot(false).match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)[1];
  assert.equal(combined,single);assert.equal(chart._geometries.get(false).groups.length,3);
  chart._plot(true);assert.ok(chart._geometries.get(true).height>Number(combined));
});

test('chart redraw restores scroll through shadow hosts even when layout collapses or rendering throws',()=>{
  const page={scrollTop:7800,scrollLeft:0},pane={parentElement:page,scrollTop:120,scrollLeft:30},host={getRootNode:()=>({host:pane})};
  assert.equal(preserveChartScroll(host,()=>{page.scrollTop=80;pane.scrollTop=0;pane.scrollLeft=0;return 'updated';}),'updated');
  assert.equal(page.scrollTop,7800);assert.equal(pane.scrollTop,120);assert.equal(pane.scrollLeft,30);
  assert.throws(()=>preserveChartScroll(host,()=>{page.scrollTop=0;throw Error('render failed');}),/render failed/);
  assert.equal(page.scrollTop,7800);
});

test('post-layout scroll anchoring is restored without overriding fresh user input',()=>{
  const original=globalThis.requestAnimationFrame,frames=[],listeners=new Map(),doc={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},page={scrollTop:1000,scrollLeft:0},host={parentElement:page,ownerDocument:doc};
  globalThis.requestAnimationFrame=fn=>frames.push(fn);
  try{
    preserveChartScroll(host,()=>{});page.scrollTop=30;frames.shift()();assert.equal(page.scrollTop,1000);
    preserveChartScroll(host,()=>{});listeners.get('wheel')();page.scrollTop=700;frames.shift()();assert.equal(page.scrollTop,700);assert.equal(listeners.size,0);
  }finally{globalThis.requestAnimationFrame=original;}
});

test('chart loads the initial calendar range automatically and keeps a single request during refresh',async()=>{
  const chart=new SigenHistoryChart(),now=Date.parse('2026-10-27T12:00:00Z'),calls=[];
  let complete;
  const model={title:'Solar',loadKey:'entry:solar',timezone:'Europe/Dublin',date:'2026-10-27',now,series:[],load:range=>{calls.push(range);return new Promise(resolve=>{complete=resolve;});}};
  chart.data=model;chart.connectedCallback();await Promise.resolve();
  assert.equal(calls.length,1);assert.equal(calls[0].start,Date.parse('2026-10-27T00:00:00Z'));
  chart.data={...model,now:now+1000};assert.equal(calls.length,1);
  complete({series:[{key:'solar_power',unit:'kW',points:[{time:now-3600000,value:3}]}],source:'sigenergy_cloud_and_recorder',chartType:'line'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(chart.data.series[0].points[0].value,3);
  chart.data={...model,now:now+2000,series:[]};await Promise.resolve();
  assert.equal(calls.length,1);assert.equal(chart.data.series[0].points[0].value,3);assert.ok(chart._visible.has('solar_power'));
  chart.disconnectedCallback();
});

test('verified period energy is drawn as kWh bars and never as an interpolated power curve',()=>{
  const chart=new SigenHistoryChart(),now=Date.parse('2026-10-27T12:00:00Z');
  chart.data={title:'Solar energy',chartType:'bar',timezone:'UTC',period:'month',date:'2026-10-27',now,series:[{key:'solar_energy',label:'Solar',unit:'kWh',points:[{time:Date.parse('2026-10-01T00:00:00Z'),value:22},{time:Date.parse('2026-10-02T00:00:00Z'),value:0},{time:Date.parse('2026-10-03T00:00:00Z'),value:null}]}]};
  const plot=chart._plot(false);assert.equal((plot.match(/class="bar"/g)??[]).length,2);assert.match(plot,/kWh/);assert.doesNotMatch(plot,/class="trace"/);
  assert.match(toCSV(chart.data.series),/,22,kWh/);assert.match(toCSV(chart.data.series),/,0,kWh/);
});

test('Lifetime Cloud response expands the axis to its supplied annual measurements',async()=>{
  const chart=new SigenHistoryChart(),now=Date.parse('2026-10-27T19:00:00Z'),start=Date.parse('2026-01-01T00:00:00Z'),end=Date.parse('2027-01-01T00:00:00Z');
  chart.data={title:'Solar',loadKey:'entry:lifetime',timezone:'Europe/Dublin',date:'2026-10-27',now,lifetimeStart:now-300000,series:[],load:async()=>({series:[{key:'solar_energy',unit:'kWh',points:[{time:start,value:129.25}]}],start,end,chartType:'bar',source:'sigenergy_cloud'})};
  await chart._change('lifetime','2026-10-27');
  assert.equal(chart.data.start,start);assert.equal(chart.data.end,end);assert.match(chart._plot(false),/class="bar"/);assert.match(chart._template(false),/Lifetime/);assert.equal(chart.data.series[0].unit,'kWh');
});

test('calendar ranges use the plant timezone and respect 23/25-hour days',()=>{
  const spring=periodRange({period:'day',date:'2026-03-29',timezone:'Europe/Dublin'});
  assert.equal(new Date(spring.start).toISOString(),'2026-03-29T00:00:00.000Z');
  assert.equal(new Date(spring.end).toISOString(),'2026-03-29T23:00:00.000Z');
  assert.equal(spring.end-spring.start,23*3600000);
  const autumn=periodRange({period:'day',date:'2026-10-25',timezone:'Europe/Dublin'});
  assert.equal(autumn.end-autumn.start,25*3600000);
  const india=periodRange({period:'day',date:'2026-10-27',timezone:'Asia/Kolkata'});
  assert.equal(new Date(india.start).toISOString(),'2026-10-26T18:30:00.000Z');
  assert.equal(dateAt(india.start,'Asia/Kolkata'),'2026-10-27');
});

test('month, year, leap dates and midnight DST transitions use calendar boundaries',()=>{
  const leap=periodRange({period:'month',date:'2028-02-20',timezone:'UTC'});
  assert.equal(leap.end-leap.start,29*86400000);
  const march=periodRange({period:'month',date:'2026-03-20',timezone:'Europe/Dublin'});
  assert.equal(march.end-march.start,31*86400000-3600000);
  const year=periodRange({period:'year',date:'2026-05-15',timezone:'Europe/Dublin'});
  assert.equal(year.end-year.start,365*86400000);
  const skippedMidnight=periodRange({period:'day',date:'2018-11-04',timezone:'America/Sao_Paulo'});
  assert.equal(new Date(skippedMidnight.start).toISOString(),'2018-11-04T03:00:00.000Z');
  assert.equal(skippedMidnight.end-skippedMidnight.start,23*3600000);
  assert.throws(()=>periodRange({date:'2026-02-30'}));
  assert.throws(()=>periodRange({date:'2026-10-27',timezone:'No/Timezone'}));
});

test('date navigation clamps month/year ends and lifetime never manufactures points',()=>{
  assert.equal(shiftDate('2026-01-31','month',1),'2026-02-28');
  assert.equal(shiftDate('2028-01-31','month',1),'2028-02-29');
  assert.equal(shiftDate('2028-02-29','year',1),'2029-02-28');
  assert.equal(shiftDate('2026-10-31','day',1),'2026-11-01');
  assert.deepEqual(periodRange({period:'lifetime',date:'2026-10-27',firstTime:1000,now:9000}),{start:1000,end:9000});
});

test('calendar weeks default to Monday and preserve seven local dates across DST',()=>{
  const spring=periodRange({period:'week',date:'2026-03-29',timezone:'Europe/Dublin'});
  assert.equal(new Date(spring.start).toISOString(),'2026-03-23T00:00:00.000Z');
  assert.equal(new Date(spring.end).toISOString(),'2026-03-29T23:00:00.000Z');
  assert.equal(spring.end-spring.start,167*3600000);
  const autumn=periodRange({period:'week',date:'2026-10-25',timezone:'Europe/Dublin'});
  assert.equal(new Date(autumn.start).toISOString(),'2026-10-18T23:00:00.000Z');
  assert.equal(new Date(autumn.end).toISOString(),'2026-10-26T00:00:00.000Z');
  assert.equal(autumn.end-autumn.start,169*3600000);
  assert.equal(dateAt(autumn.start,'Europe/Dublin'),'2026-10-19');
  assert.equal(dateAt(autumn.end-1,'Europe/Dublin'),'2026-10-25');
});

test('configured week starts and weekly navigation work across year and leap boundaries',()=>{
  const sunday=periodRange({period:'week',date:'2027-01-01',timezone:'Asia/Kolkata',weekStart:0});
  assert.equal(new Date(sunday.start).toISOString(),'2026-12-26T18:30:00.000Z');
  assert.equal(new Date(sunday.end).toISOString(),'2027-01-02T18:30:00.000Z');
  const monday=periodRange({period:'week',date:'2027-01-01',timezone:'UTC'});
  assert.equal(new Date(monday.start).toISOString(),'2026-12-28T00:00:00.000Z');
  assert.equal(shiftDate('2026-12-28','week',1),'2027-01-04');
  assert.equal(shiftDate('2027-01-04','week',-1),'2026-12-28');
  assert.equal(shiftDate('2028-02-29','week',1),'2028-03-07');
  for(const weekStart of [-1,7,1.5,'1',true,NaN])assert.throws(()=>periodRange({period:'week',date:'2026-10-27',weekStart}));
  assert.throws(()=>shiftDate('2026-10-27','week',.5));
});

test('Week selection requests its own calendar range and retains gaps without inventing totals',async()=>{
  const now=Date.parse('2026-03-29T12:00:00Z'),point=Date.parse('2026-03-29T01:00:00Z'),requests=[];
  const chart=new SigenHistoryChart();
  chart.data={title:'Solar power',timezone:'Europe/Dublin',date:'2026-03-29',weekStart:0,now,series:[],load:async range=>{requests.push(range);return [{key:'solar',label:'Solar',unit:'kW',points:[{time:point,value:0},{time:point+3600000,value:null}]}];}};
  await chart._change('week','2026-03-29');
  assert.equal(requests.length,1);assert.equal(requests[0].period,'week');assert.equal(requests[0].weekStart,0);
  assert.equal(new Date(requests[0].start).toISOString(),'2026-03-29T00:00:00.000Z');
  assert.equal(new Date(requests[0].end).toISOString(),'2026-04-04T23:00:00.000Z');
  assert.equal(chart.data.weekStart,0);
  assert.deepEqual(chart.data.series[0].points,[{time:point,value:0},{time:point+3600000,value:null}]);
  assert.match(chart._template(false),/<option value="week" selected>Week<\/option>/);
  assert.match(chart._template(true),/Europe\/Dublin · Week/);
  assert.notEqual(chart._formatTime(point),chart._formatTime(point+86400000));
  assert.doesNotMatch(chart._template(false),/class="sun-events"/);
  chart.data={...chart.data,series:[]};
  assert.match(chart._template(false),/No history for this period/);
});

test('series normalization preserves unknowns, negative prices and authoritative units',()=>{
  const source=[{key:'pv',label:'Solar',unit:'W',color:'red;bad',points:[{time:2,value:'1200'},{time:1,value:null},{time:3,value:''},{time:4,value:Infinity},{time:2,value:1400},{time:null,value:3}]}];
  const normalized=normalizeSeries(source);
  assert.equal(normalized[0].unit,'kW');assert.equal(normalized[0].color,'#e9bf00');
  assert.deepEqual(normalized[0].points,[{time:1,value:null},{time:2,value:1.4},{time:3,value:null},{time:4,value:null}]);
  assert.equal(source[0].points[0].value,'1200');
  const prices=normalizeSeries([{unit:'cent/kWh',currency:'EUR',points:[{time:0,value:-5}]}]);
  assert.equal(prices[0].unit,'EUR/kWh');assert.equal(prices[0].points[0].value,-.05);
  assert.equal(normalizeSeries([{unit:'cent/kWh',points:[]}])[0].unit,'currency/kWh');
  assert.equal(normalizeSeries([{unit:'EUR/MWh',points:[{time:0,value:200}]}])[0].points[0].value,.2);
});

test('nearest point respects missing values and maximum distance instead of bridging a gap',()=>{
  const points=[{time:0,value:1},{time:10,value:null},{time:20,value:3}];
  assert.deepEqual(nearestPoint(points,12),{time:10,value:null});
  assert.equal(nearestPoint(points,100,5),null);
  assert.deepEqual(nearestPoint(points,5),points[0]);
  assert.equal(nearestPoint([],5),null);
});

test('forecast overlays keep their label and dashed style through normalization, rendering and CSV',()=>{
  const input=[{key:'forecast',forecast:true,unit:'W',points:[{time:1000,value:1200},{time:2000,value:1600}]}];
  const normalized=normalizeSeries(input);
  assert.equal(normalized[0].forecast,true);
  assert.equal(normalized[0].label,'Forecast');
  assert.equal(normalized[0].dash,'6 5');
  assert.deepEqual(normalizeSeries(normalized),normalized);
  const chart=new SigenHistoryChart();
  chart.data={series:input,start:0,end:3000,now:2000,timezone:'UTC',date:'1970-01-01'};
  assert.match(chart._template(false),/stroke-dasharray="6 5"/);
  assert.match(chart._template(false),/>Forecast<\/button>/);
  assert.match(toCSV(input),/,Forecast,1\.2,kW/);
  const unsafe=normalizeSeries([{...input[0],dash:'6" onload="alert(1)'},{key:'actual',dash:'url(javascript:bad)',points:[]},{key:'safe',dash:'4, 2.5',points:[]}]);
  assert.equal(unsafe[0].dash,'6 5');
  assert.equal(unsafe[1].dash,null);
  assert.equal(unsafe[2].dash,'4, 2.5');
  assert.equal(normalizeSeries([{dash:'0 0'}])[0].dash,null);
});

test('compact embedded charts hide the duplicate title while retaining controls and accessible names',()=>{
  const chart=new SigenHistoryChart();
  chart.data={title:'Power metrics',compact:true,series:[{key:'solar',label:'Solar',unit:'kW',points:[{time:1000,value:1}]}],start:0,end:3000,now:2000,timezone:'UTC',date:'1970-01-01'};
  const embedded=chart._template(false);
  assert.match(embedded,/<section class="chart compact" aria-label="Power metrics"/);
  assert.match(embedded,/<h2 class="sr-only">Power metrics<\/h2>/);
  assert.match(embedded,/aria-label="Expand chart"/);
  assert.match(embedded,/aria-label="Chart date"/);
  assert.match(embedded,/aria-label="Chart period"/);
  assert.match(embedded,/aria-label="Power metrics\. Use left and right arrows/);
  const expanded=chart._template(true);
  assert.match(expanded,/<h2>Power metrics<\/h2>/);
  assert.doesNotMatch(expanded,/<h2 class="sr-only">/);
  chart.data={...chart.data,compact:false};
  assert.match(chart._template(false),/<h2>Power metrics<\/h2>/);
});

test('sun events display same-day aware timestamps in the chart timezone across DST',()=>{
  const context={date:'2026-03-29',timezone:'Europe/Dublin',locale:'en-IE',now:Date.parse('2026-03-29T12:00:00Z')};
  const events=sunEvents({...context,sunrise:'2026-03-29T06:15:00Z',sunset:'2026-03-29T19:45:00+01:00'});
  assert.deepEqual(events.map(event=>[event.label,event.clock]),[['Sunrise','07:15'],['Sunset','19:45']]);
  assert.equal(sunEvents({...context,date:'2026-10-25',now:Date.parse('2026-10-25T12:00:00Z'),sunrise:'2026-10-25T06:15:00Z'})[0].clock,'06:15');
  const chart=new SigenHistoryChart();
  chart.data={...context,sunrise:'2026-03-29T06:15:00Z',sunset:'2026-03-29T19:45:00+01:00',series:[]};
  assert.match(chart._template(false),/Sunrise <time datetime="2026-03-29T06:15:00Z">07:15<\/time>/);
  assert.match(chart._template(false),/Europe\/Dublin · Day/);
});

test('sun events remain hidden for historical periods, wrong event dates and invalid timestamps',()=>{
  const current={date:'2026-10-27',timezone:'Europe/Dublin',now:Date.parse('2026-10-27T12:00:00Z'),sunrise:'2026-10-27T07:21:00Z',sunset:'2026-10-27T17:13:00Z'};
  assert.equal(sunEvents({...current,date:'2026-10-26'}).length,0);
  assert.equal(sunEvents({...current,date:'2026-10-26',sunrise:'2026-10-26T07:21:00Z',sunset:undefined}).length,0);
  for(const period of ['week','month','year','lifetime']) assert.equal(sunEvents({...current,period}).length,0);
  for(const sunrise of ['2026-10-27T07:21:00','2026-10-27','bad','2026-10-27T24:21:00Z','2026-10-26T07:21:00Z',123]) assert.equal(sunEvents({...current,sunrise,sunset:undefined}).length,0);
  assert.equal(sunEvents({...current,date:'2026-03-02',now:Date.parse('2026-03-02T12:00:00Z'),sunrise:'2026-02-30T07:21:00Z',sunset:undefined}).length,0);
  assert.equal(sunEvents({...current,timezone:'No/Timezone'}).length,0);
  const chart=new SigenHistoryChart();
  chart.data={...current,date:'2026-10-26',series:[]};
  assert.doesNotMatch(chart._template(false),/class="sun-events"/);
});

test('SVG paths split at missing values and absent time intervals',()=>{
  assert.deepEqual(gapPaths([{time:0,value:1},{time:1,value:2},{time:2,value:null},{time:3,value:4},{time:10,value:5}],{maxGapMs:2}),['M0.00,1.00 L1.00,2.00','M3.00,4.00','M10.00,5.00']);
  const paths=gapPaths([{time:0,value:0},{time:1,value:NaN},{time:2,value:-2}]);
  assert.equal(paths.some(path=>/NaN|Infinity/.test(path)),false);
  assert.equal(paths.length,2);
});

test('CSV quotes labels and blocks spreadsheet formulas while retaining real negative readings',()=>{
  assert.equal(csvEscape('=1+1'),"'=1+1");
  assert.equal(csvEscape(' @SUM(A1)'),"' @SUM(A1)");
  assert.equal(csvEscape('a,"b"\nc'),'"a,""b""\nc"');
  assert.equal(csvEscape(-.05),'-0.05');
  const csv=toCSV([{key:'tariff',label:'=HYPERLINK("bad")',unit:'EUR/kWh',points:[{time:0,value:-.05},{time:1000,value:null},{time:2000,value:1}]}],{start:0,end:1000});
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(csv.includes(',-0.05,EUR/kWh'));
  assert.ok(csv.includes(',"\'=HYPERLINK(""bad"")",,EUR/kWh'));
  assert.equal(csv.includes('1970-01-01T00:00:02'),false);
});
