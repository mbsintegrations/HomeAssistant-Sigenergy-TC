import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { photoSceneModel, renderPhotoScene, PHOTO_STYLE } from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-photo.js';

const MODULE = new URL('../custom_components/sigen_hybrid/frontend/sigen-hybrid-photo.js', import.meta.url);
const context = (values = {}, extra = {}) => ({
  value: key => values[key] ?? null,
  has: key => Object.hasOwn(values, key),
  state: key => key === 'ac_state' ? { state: 'Not plugged-in' } : null,
  activity: key => ({ value: values[key] ?? null, fresh: Number.isFinite(values[key]), active: Number.isFinite(values[key]) && Math.abs(values[key]) >= .025 }),
  ...extra,
});
const flowTag = (body, key) => body.match(new RegExp(`<g class="[^"]*" data-photo-flow="${key}"[^>]*>`))?.[0] ?? '';

test('uses local newly generated day/night assets with renderer attribution and no embedded upstream images', async () => {
  const source = await readFile(MODULE, 'utf8');
  const hashes = {
    'overview-house-day-v1.webp': '4fb5e608e53f88bdf8cd33ee86b11d906ff277fd3993be2300a6618d91ff2512',
    'overview-house-night-v1.webp': '0df501a63e198cc32862a920a8bc0df1ef2ccf91e73730dc73df6a7757336654',
  };
  for (const [name, expected] of Object.entries(hashes)) {
    const bytes = await readFile(new URL(`../custom_components/sigen_hybrid/frontend/assets/${name}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
    assert.ok(source.includes(`new URL('./assets/${name}', import.meta.url).href`));
  }
  assert.ok(!source.includes('data:image'));
  assert.ok(!source.includes('sigen-photo-charger-art'));
  assert.match(source, /Copyright 2025-2026 Jean-Yves Avenard/);
  assert.match(source, /Apache License, Version 2\.0/);
  assert.match(source, /Modified for Sigenergy TC/);
  assert.match(source, /86f82a214c7a/);
  assert.match(source, /no upstream image assets/);
  assert.ok(!/href=["']https?:/.test(source));
});

test('selects only one local day or night image when the scene is rendered', () => {
  const values = { ac_power: 0, dc_power: 0 };
  const day = renderPhotoScene(context(values)), night = renderPhotoScene(context(values, { night: true }));
  assert.ok(!day.includes('sigen-photo-scene is-night'));
  assert.ok(night.includes('sigen-photo-scene is-night'));
  const images = body => [...body.matchAll(/<image[^>]+href="([^"]+)"/g)].map(match => match[1]);
  assert.equal(images(day).length, 1);
  assert.equal(images(night).length, 1);
  assert.ok(images(day)[0].endsWith('/assets/overview-house-day-v1.webp'));
  assert.ok(images(night)[0].endsWith('/assets/overview-house-night-v1.webp'));
  assert.ok(!day.includes('overview-house-night'));
  assert.ok(!night.includes('overview-house-day'));
  assert.equal(renderPhotoScene(context(values)), day);
});

test('unknowns remain unknown while zero power and zero SOC stay valid and readable', () => {
  const unknown = renderPhotoScene(context());
  assert.equal((unknown.match(/<strong>—<\/strong>/g) ?? []).length, 4);
  assert.ok(unknown.includes('SigenStor · —'));
  const zero = renderPhotoScene(context({ solar_power: 0, home_power: 0, battery_power: 0, battery_soc: 0, grid_power: 0 }));
  assert.equal((zero.match(/<strong>0 kW<\/strong>/g) ?? []).length, 4);
  assert.ok(zero.includes('SigenStor · 0%'));
  assert.ok(zero.includes('<em>Idle</em>'));
  assert.ok(!/NaN|Infinity|undefined|null|Sample/.test(zero));
  for (const bad of [NaN, Infinity, '0', false]) assert.equal(photoSceneModel(context({ battery_soc: bad })).values.soc, null);
  for (const bad of [-1, 101]) assert.equal(photoSceneModel(context({ battery_soc: bad })).values.soc, null);
});

test('shows normalized power magnitudes and contextual charge/import direction', () => {
  const model = photoSceneModel(context({ solar_power: 6.5, home_power: 2.25, battery_power: 3, battery_soc: 76.5, grid_power: -1.25, ac_power: .47, dc_power: 0 }));
  assert.equal(model.values.inverter, 3.5);
  assert.equal(model.batteryStatus, 'Charging');
  assert.equal(model.gridStatus, 'Exporting');
  const body = renderPhotoScene(context({ solar_power: 6.5, home_power: 2.25, battery_power: -3, battery_soc: 76.5, grid_power: 1.25, ac_power: .47, dc_power: -1.5 }));
  assert.ok(body.includes('<strong>470 W</strong>'));
  assert.ok(body.includes('<strong>3 kW</strong>'));
  assert.ok(body.includes('SigenStor · 76.5%'));
  assert.ok(body.includes('<em>Discharging</em>'));
  assert.ok(body.includes('<em>Importing</em>'));
  assert.ok(!body.includes('<strong>-'));
});

test('preserves correct solar, home, inverter and gateway cable direction conventions', () => {
  const importing = photoSceneModel(context({ solar_power: 0, home_power: 2, battery_power: 1, grid_power: 3 }));
  assert.equal(importing.values.inverter, -1);
  assert.equal(importing.flows.inverterFlow.reverse, true);
  assert.equal(importing.flows.gridFlow.reverse, true);
  assert.equal(importing.flows.homeFlow.reverse, false);
  const exporting = photoSceneModel(context({ solar_power: 6, home_power: 1, battery_power: 2, grid_power: -3, dc_power: .5 }));
  assert.equal(exporting.values.inverter, 3.5);
  assert.equal(exporting.flows.inverterFlow.reverse, false);
  assert.equal(exporting.flows.gridFlow.reverse, false);
  assert.equal(exporting.flows.solarFlow.reverse, false);
  const fallback = photoSceneModel(context({ home_power: 2, grid_power: 5 }));
  assert.equal(fallback.values.inverter, -3);
  assert.equal(fallback.flows.inverterFlow.reverse, true);
  assert.equal(photoSceneModel(context()).values.inverter, null);
});

test('charger visibility follows configured devices rather than nonzero measurements', () => {
  const none = renderPhotoScene(context());
  assert.ok(!none.includes('data-detail="ac"') && !none.includes('data-detail="dc"'));
  assert.ok(!none.includes('sigen-photo-charger-art'));
  const zero = renderPhotoScene(context({ ac_power: 0, dc_power: 0 }));
  assert.ok(zero.includes('data-detail="ac"') && zero.includes('data-detail="dc"'));
  assert.equal((zero.match(/sigen-photo-charger-art/g) ?? []).length, 0); // Charger is already part of the original generated scene.
  const stateOnly = renderPhotoScene(context({ ac_state: null }));
  assert.ok(stateOnly.includes('data-detail="ac"'));
  assert.ok(!stateOnly.includes('data-detail="dc"'));
  const unconfigured = renderPhotoScene(context({ ac_power: 1, dc_power: 1 }, { has: () => false }));
  assert.ok(!unconfigured.includes('data-detail="ac"') && !unconfigured.includes('data-detail="dc"'));
  const unavailable = photoSceneModel(context({ solar_power: 5, battery_power: 1, dc_power: null }));
  assert.equal(unavailable.values.inverter, null);
});

test('only the host freshness/activity result enables movement and all animation preferences are honored', () => {
  const values = { solar_power: 4, battery_power: 0, home_power: 1, grid_power: -3 };
  const current = renderPhotoScene(context(values));
  assert.match(flowTag(current, 'solarFlow'), /is-moving/);
  assert.match(flowTag(current, 'homeFlow'), /is-moving/);
  assert.match(flowTag(current, 'gridFlow'), /data-reverse="false"/);
  const paused = renderPhotoScene(context(values, { activity: () => ({ active: false }) }));
  assert.ok(!paused.includes('is-moving') && !paused.includes('data-active="true"'));
  const noAnimation = renderPhotoScene(context(values, { animations: false }));
  assert.ok(!noAnimation.includes('is-moving'));
  assert.match(flowTag(noAnimation, 'solarFlow'), /is-active/);
  assert.ok(!renderPhotoScene(context(values, { activity: undefined })).includes('is-moving'));
  assert.ok(!renderPhotoScene(context({}, { activity: () => ({ active: true }) })).includes('is-moving'));
  assert.match(PHOTO_STYLE, /@media\(prefers-reduced-motion:reduce\)/);
});

test('derived inverter motion requires fresh solar, battery and configured DC operands or fresh fallback meters', () => {
  const values = { solar_power: 5, battery_power: 0, home_power: 2, grid_power: -3, dc_power: 0 };
  const withStale = key => context(values, { activity: current => ({ fresh: current !== key, active: current !== key && Math.abs(values[current]) > .03 }) });
  for (const key of ['solar_power', 'battery_power', 'dc_power']) {
    const model = photoSceneModel(withStale(key));
    assert.equal(model.values.inverter, 5);
    assert.equal(model.flows.inverterFlow.active, false, key);
  }
  assert.equal(photoSceneModel(context(values)).flows.inverterFlow.active, true);
  const noIdleFreshness = photoSceneModel(context(values, { activity: key => ({ active: Math.abs(values[key]) > .03 }) }));
  assert.equal(noIdleFreshness.flows.inverterFlow.active, false);
  const fallbackValues = { home_power: 2, grid_power: 3 };
  for (const key of ['home_power', 'grid_power']) {
    const model = photoSceneModel(context(fallbackValues, { activity: current => ({ fresh: current !== key, active: current !== key }) }));
    assert.equal(model.values.inverter, -1);
    assert.equal(model.flows.inverterFlow.active, false);
  }
});

test('every device label opens its existing accessible detail route and text is escaped', () => {
  const body = renderPhotoScene(context({ solar_power: 1, home_power: 2, battery_power: -1, battery_soc: 0, grid_power: 0, ac_power: 0, dc_power: 0 }, { state: () => ({ state: '<img src=x onerror="bad"> & ready' }) }));
  for (const route of ['solar', 'load', 'battery', 'grid', 'ac', 'dc']) {
    assert.match(body, new RegExp(`<button type="button" data-detail="${route}" aria-label="[^"]+Open details">`));
  }
  assert.equal((body.match(/<button /g) ?? []).length, 6);
  assert.ok(body.includes('&lt;img src=x onerror=&quot;bad&quot;&gt; &amp; ready'));
  assert.ok(!body.includes('<img src=x'));
  assert.ok(!body.includes('data-action=') && !body.includes('data-service='));
});

test('covers every scene row with real photograph pixels and keeps the cables on their transformed equipment', () => {
  const body = renderPhotoScene(context({ ac_power: 0 }));
  assert.ok(body.includes('viewBox="0 0 1676 673"'));
  assert.ok(body.includes('x="0" y="56" width="1676" height="557"'));
  for (const path of ['M838 18 V221.111', 'M1258.474 18 V339.521', 'M816.251 525.592 V641', 'M1154.564 578.756 V641', 'M838 239 V267 Q838 274 832 280 V389', 'M854 442 L858 449 Q860 453 864 449 L866 438']) assert.ok(body.includes(`d="${path}"`));
  for (const path of body.matchAll(/<path\b[^>]+>/g)) assert.ok(path[0].includes('fill="none"'));
  assert.equal((body.match(/data-photo-flow=/g) ?? []).length, 5);
  assert.match(PHOTO_STYLE, /container-type:inline-size/);
  assert.match(PHOTO_STYLE, /@container \(max-width:560px\)/);
  assert.match(PHOTO_STYLE, /aspect-ratio:1360\/673/);
  assert.match(PHOTO_STYLE, /aspect-ratio:1490\/673/);
  assert.doesNotMatch(PHOTO_STYLE, /height:673px|width:1676px/);
  const cover = body.match(/<g class="sigen-photo-cover-image" transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)">/);
  assert.ok(cover);
  const [, x, y, scale] = cover.map(Number);
  assert.ok(Math.abs(56 * scale + y) < .001); // First image row covers scene top.
  assert.ok(Math.abs((56 + 557) * scale + y - 673) < .001); // Last row covers bottom.
  assert.ok(x < 0 && 1676 * scale + x > 1676); // Image spans both horizontal edges.
  assert.ok(body.includes(`<g class="sigen-photo-cover-flows" transform="translate(${cover[1]} ${cover[2]}) scale(${cover[3]})">`));
  assert.match(PHOTO_STYLE, /focus-visible/);
});

test('multiple scenes can isolate their gradient identifiers without retaining module state', () => {
  const a = renderPhotoScene(context({}, { idPrefix: 'scene-a' })), b = renderPhotoScene(context({}, { idPrefix: 'scene-b' }));
  assert.ok(a.includes('id="scene-a-top"') && a.includes('url(#scene-a-top)'));
  assert.ok(b.includes('id="scene-b-top"') && b.includes('url(#scene-b-top)'));
  assert.ok(!b.includes('scene-a'));
  const invalid = renderPhotoScene(context({}, { idPrefix: '"><script>alert(1)</script>' }));
  assert.ok(invalid.includes('id="sigen-photo-top"'));
  assert.ok(!invalid.includes('<script>'));
});

test('rendering is pure and has no HASS, network, storage, timers, history or direct-control implementation', async () => {
  const source = await readFile(MODULE, 'utf8');
  assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|setInterval|setTimeout|requestAnimationFrame|cancelAnimationFrame|callService|sendMessagePromise)\s*\(/.test(source));
  assert.ok(!/\b(?:localStorage|sessionStorage|indexedDB|customElements|window|document|Date)\b/.test(source));
  const values = Object.freeze({ solar_power: 4, home_power: 2, battery_power: 1, grid_power: -1 });
  const ctx = Object.freeze(context(values));
  assert.equal(renderPhotoScene(ctx), renderPhotoScene(ctx));
  assert.deepEqual(values, { solar_power: 4, home_power: 2, battery_power: 1, grid_power: -1 });
});

test('Photo House shows actual weather at top left and shares opt-in effects without changing power labels',()=>{
  const ctx=context({solar_power:0,home_power:2},{weather:{state:'rainy',attributes:{temperature:10.1,temperature_unit:'°C'}},immersiveWeather:true});
  const html=renderPhotoScene(ctx);
  assert.match(html,/sigen-photo-weather/);assert.match(html,/10.1 °C/);assert.match(html,/effect-rain/);
  assert.match(html,/SOLAR/);assert.match(html,/HOME/);assert.match(html,/data-detail="weather"/);
  assert.doesNotMatch(renderPhotoScene({...ctx,immersiveWeather:false}),/effect-rain/);
});
