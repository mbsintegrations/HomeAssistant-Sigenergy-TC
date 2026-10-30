import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderHouseScene, renderWeatherEffects, renderSceneWeather, HOUSE_STYLE} from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-house.js';

test('weather effects require opt-in and a known current condition, with night and reduced-motion support',()=>{
  const current={immersiveWeather:true,weather:{state:'rainy'}};
  assert.match(renderWeatherEffects(current),/effect-rain/);
  assert.equal(renderWeatherEffects({...current,immersiveWeather:false}),'');
  for(const state of ['unavailable','unknown','<script>'])assert.equal(renderWeatherEffects({...current,weather:{state}}),'');
  for(const [state,effect]of [['sunny','sun'],['snowy','snow'],['fog','fog'],['cloudy','cloud'],['lightning','thunder']])assert.match(renderWeatherEffects({...current,weather:{state}}),new RegExp(`effect-${effect}`));
  assert.match(renderWeatherEffects({...current,night:true,weather:{state:'sunny'}}),/effect-stars/);
  assert.match(renderWeatherEffects({...current,animations:false}),/effect-still/);
  assert.match(HOUSE_STYLE,/@media\(prefers-reduced-motion:reduce\)/);
});

test('weather badge preserves supplied temperature units and real zero without an artwork dependency',()=>{
  const html=renderSceneWeather({weather:{state:'clear-night',attributes:{temperature:0,temperature_unit:'°C'}}});
  assert.match(html,/0 °C/);assert.match(html,/house-weather-symbol/);assert.match(html,/data-detail="weather"/);
  assert.equal(renderSceneWeather({}),'');
});

const art = {house:'/local/house.png',battery:'/local/battery.png',gateway:'/local/gateway.png',ac:'/local/ac.png',dc:'/local/dc.png',weather:'/local/cloud.png'};
const readings = {solar_power:2.5,home_power:1.25,battery_power:-1.5,battery_soc:81.8,grid_power:0,ac_power:0,dc_power:0};
const ctx = (values=readings, extra={}) => ({art,has:key=>Object.hasOwn(values,key),value:key=>values[key]??null,state:key=>key==='ac_state'?{state:'Not Connected'}:key==='grid_status'?{state:'Normal | On Grid'}:Object.hasOwn(values,key)?{state:String(values[key])}:undefined,weather:{state:'partlycloudy',attributes:{temperature:9.3,temperature_unit:'°C'}},wires:'<path class="portal-cable" d="M449 310 V400" fill="none"/>',...extra});

test('power, weather and status labels are readable HTML independent of the house SVG scale',()=>{
  const html=renderHouseScene(ctx()), canvas=html.match(/<div class="house-canvas">([\s\S]*?)<\/svg><\/div>/)[1];
  assert.ok(html.startsWith('<div class="scene-wrap">'));
  assert.ok(canvas.includes('viewBox="110 170 800 670"'));
  assert.ok(!canvas.includes('<text')&&!canvas.includes('<foreignObject'));
  assert.ok(!canvas.includes('Normal | On Grid')&&!canvas.includes('9.3'));
  assert.ok(html.includes('2.5 kW')&&html.includes('81.8%')&&html.includes('9.3 °C'));
  assert.ok(html.includes('class="house-power-row"')&&html.includes('class="house-bottom-row"'));
  assert.ok(html.includes('class="portal-cable" d="M449 310 V400"'));
});

test('original house and all equipment preserve their exact sprite geometry and transparent hit rectangles',()=>{
  const day=renderHouseScene(ctx()),night=renderHouseScene(ctx(readings,{night:true}));
  assert.ok(day.includes('href="/local/house.png" x="134" y="179" width="738" height="643"'));
  for(const key of ['battery','gateway','ac','dc'])assert.ok(day.includes(`class="portal-equipment" data-equipment="${key}"`));
  for(const bounds of ['476 553 127 268','659 619 79 119','50 489 42 84','254 599 61 144'])assert.ok(day.includes(`viewBox="${bounds}"`));
  for(const bounds of ['55 482 53 88','251 594 44 129'])assert.ok(night.includes(`viewBox="${bounds}"`));
  assert.equal((day.match(/class="portal-equipment-hit"/g)??[]).length,4);
  assert.equal((day.match(/pointer-events="none"/g)??[]).length,4);
  assert.ok(day.includes('x="476" y="553" width="127" height="268" fill="transparent"'));
});

test('all expected detail routes remain real accessible buttons or equipment hit regions',()=>{
  const html=renderHouseScene(ctx());
  for(const route of ['solar','load','battery','grid','dc','ac','weather'])assert.ok(html.includes(`data-detail="${route}"`),route);
  assert.ok(html.includes('aria-label="Home consumption details"'));
  assert.ok(HOUSE_STYLE.includes('min-height:44px'));
  assert.ok(html.includes('Not plugged-in'));
  assert.ok(!html.includes('data-service=')&&!html.includes('data-action='));
});

test('zero, unavailable power, SOC boundaries and grid directions keep their actual meanings',()=>{
  const zero=renderHouseScene(ctx({solar_power:0,home_power:0,battery_power:0,battery_soc:0,grid_power:0}));
  assert.ok(zero.includes('SigenStor · 0%')&&zero.includes('0 kW')&&zero.includes('Balanced'));
  const missing=renderHouseScene(ctx({solar_power:null,home_power:null,battery_power:null,battery_soc:null,grid_power:null}));
  assert.ok(missing.includes('SigenStor · —')&&missing.includes('<strong>—</strong>')&&missing.includes('Unavailable'));
  for(const soc of [-1,101,NaN,Infinity,'0',false])assert.ok(renderHouseScene(ctx({...readings,battery_soc:soc})).includes('SigenStor · —'));
  assert.ok(renderHouseScene(ctx({...readings,grid_power:1})).includes('Importing'));
  assert.ok(renderHouseScene(ctx({...readings,grid_power:-1})).includes('Exporting'));
  assert.ok(renderHouseScene(ctx({...readings,battery_power:1})).includes('Charging'));
  assert.ok(renderHouseScene(ctx({...readings,battery_power:-1})).includes('Discharging'));
});

test('configuration determines equipment visibility, including zero-power and state-only chargers',()=>{
  const none=renderHouseScene(ctx({}, {art:{}}));
  for(const route of ['ac','dc','battery','solar','load','grid'])assert.ok(!none.includes(`data-detail="${route}"`));
  assert.ok(!none.includes('portal-equipment'));
  const only=renderHouseScene(ctx({ac_state:null}));
  assert.ok(only.includes('data-detail="ac"')&&only.includes('data-equipment="ac"'));
  assert.ok(!only.includes('data-detail="dc"'));
  assert.ok(renderHouseScene(ctx({dc_power:0})).includes('data-equipment="dc"'));
});

test('intrinsic status badges safely contain long text and unsafe artwork URLs never enter markup',()=>{
  const html=renderHouseScene(ctx(readings,{art:{...art,house:'javascript:bad()',battery:'//third.party/pixel',ac:'/x" onerror="bad'},state:key=>key==='ac_state'?{state:'Connection unknown <long> & ready'}:key==='grid_status'?{state:'A very long system status <unsafe>'}:undefined}));
  assert.ok(html.includes('Connection unknown &lt;long&gt; &amp; ready'));
  assert.doesNotMatch(html,/house-system-status/);
  assert.ok(!html.includes('<long>')&&!html.includes('javascript:')&&!html.includes('//third.party'));
  assert.ok(!html.includes('data-equipment="battery"')&&!html.includes('data-equipment="ac"'));
  assert.match(HOUSE_STYLE,/\.house-ac-status\{[^}]*width:max-content/);
  assert.match(HOUSE_STYLE,/\.house-system-badge\{[^}]*width:max-content/);
  assert.ok(!html.includes('<foreignObject'));
});

test('weather preserves true zero and hides unavailable temperature instead of inventing it',()=>{
  const zero=renderHouseScene(ctx(readings,{weather:{state:'cloudy',attributes:{temperature:0,temperature_unit:'°C'}}}));
  assert.ok(zero.includes('>0 °C</span>'));
  const unavailable=renderHouseScene(ctx(readings,{weather:{state:'unavailable',attributes:{temperature:9.3,temperature_unit:'°C'}}}));
  assert.ok(unavailable.includes('class="house-temperature">—</span>'));
  const none=renderHouseScene(ctx(readings,{art:{...art,weather:null},weather:undefined}));
  assert.ok(!none.includes('data-detail="weather"'));
});

test('the medium canvas resizes with its container and needs no fixed pixel maximum or SVG label space',()=>{
  assert.match(HOUSE_STYLE,/\.house-canvas\{[^}]*width:100%;aspect-ratio:1\.8/);
  assert.match(HOUSE_STYLE,/@container\(max-width:650px\)\{\.house-canvas\{aspect-ratio:1\.35/);
  assert.match(HOUSE_STYLE,/\.house-layout \.house-canvas>\.portal-scene\{[^}]*width:100%;height:100%/);
  const canvasRule=HOUSE_STYLE.match(/\.house-canvas\{([^}]+)\}/)[1];
  assert.doesNotMatch(canvasRule,/max-width:\d+px|height:\d+px/);
});

test('house rendering is deterministic and has no network, storage, timer, hardware or DOM implementation',async()=>{
  const source=await readFile(new URL('../custom_components/sigen_hybrid/frontend/sigen-hybrid-house.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket|setInterval|setTimeout|requestAnimationFrame|callService|callWS)\s*\(/);
  assert.doesNotMatch(source,/\b(?:localStorage|sessionStorage|customElements|window|document)\b/);
  assert.doesNotMatch(source,/^import\s/m);
  const input=Object.freeze(ctx(Object.freeze({...readings})));
  assert.equal(renderHouseScene(input),renderHouseScene(input));
});
