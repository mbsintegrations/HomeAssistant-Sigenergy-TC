import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WIDGET_ROUTES, renderSummaryWidget, renderSummaryDetail, WIDGET_STYLE } from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-widgets.js';

const NOW = Date.parse('2026-10-27T01:00:00Z');
const state = (value, unit, attributes = {}) => ({ state: String(value), attributes: { unit_of_measurement: unit, ...attributes } });
function context(states = {}, extra = {}) {
  const entities = Object.fromEntries(Object.keys(states).map(key => [key, `sensor.${key}`]));
  return { now: NOW, timezone: 'Europe/Dublin', config: {}, interfaceOptions: {}, entities, currency: 'EUR',
    state: key => states[key] ?? null,
    value: (key, quantity) => { const reading = states[key]; if (!reading || !reading.state.trim() || ['unknown', 'unavailable'].includes(reading.state)) return null; const value = Number(reading.state); if (!Number.isFinite(value)) return null; const factor = quantity === 'energy' ? ({ Wh: .001, kWh: 1, MWh: 1000 })[reading.attributes.unit_of_measurement] : quantity === 'soc' && reading.attributes.unit_of_measurement === '%' ? 1 : undefined; return factor === undefined ? null : value * factor; },
    ...extra,
  };
}
const render = (route, states = {}, extra = {}) => renderSummaryWidget(route, context(states, extra));

test('all seven compact widget routes render functional expand links and honest unknown values', () => {
  assert.deepEqual([...WIDGET_ROUTES], ['energy_value', 'production', 'consumption', 'energy_produced', 'environment', 'ai', 'strategies']);
  for (const route of WIDGET_ROUTES) {
    const body = render(route);
    assert.ok(body.startsWith('<section class="panel '), route);
    assert.ok(body.includes(`data-detail="${route}"`), route);
    assert.ok(!/Sample|development|NaN|Infinity|undefined|null/.test(body), route);
  }
  for (const route of ['constructor', '__proto__', 'toString', 'unknown']) assert.equal(render(route), '');
  assert.ok(WIDGET_STYLE.includes('@container'));
});

test('production and consumption preserve supplied Wh, kWh and MWh through the context normalizer', () => {
  const ctx = context({ solar_today: state(1500, 'Wh'), solar_lifetime: state(.1, 'MWh'), home_today: state(2.5, 'kWh'), home_lifetime: state(.2, 'MWh') });
  const pv = renderSummaryWidget('production', ctx), load = renderSummaryWidget('consumption', ctx);
  assert.ok(pv.includes('1.5 kWh') && pv.includes('100 kWh'));
  assert.ok(load.includes('2.5 kWh') && load.includes('200 kWh'));
  assert.ok(!pv.includes('widget-ring-allocation') && !load.includes('widget-ring-allocation'));
  assert.ok(!pv.includes('widget-allocation-list'));
  assert.ok(render('production', { solar_today: state(0, 'kWh') }).includes('0 kWh'));
  assert.ok(!render('production', { solar_today: state(5, 'unverified') }).includes('5 kWh'));
});

test('allocation shares require the matching day and complete balanced nonnegative measured parts', () => {
  const valid = { date: '2026-10-27', unit: 'kWh', parts: [{ key: 'home', energy_kwh: 3 }, { key: 'battery', energy_kwh: 2 }] };
  const extra = allocation => ({ config: { energy_allocations: { production: allocation } } });
  const body = render('production', { solar_today: state(5, 'kWh') }, extra(valid));
  assert.ok(body.includes('widget-ring-allocation') && body.includes('widget-allocation-list'));
  assert.ok(body.includes('Load') && body.includes('Battery') && body.includes('3 kWh') && body.includes('2 kWh'));
  for (const bad of [{ ...valid, date: '2026-10-26' }, { ...valid, unit: 'MWh' }, { ...valid, parts: [{ key: 'home', energy_kwh: 4 }] }, { ...valid, parts: [{ key: 'home', energy_kwh: -1 }, { key: 'grid', energy_kwh: 6 }] }, { ...valid, parts: [{ key: 'home', energy_kwh: true }, { key: 'battery', energy_kwh: 4 }] }, { ...valid, parts: [{ key: 'home', energy_kwh: 3 }, { key: 'home', energy_kwh: 2 }] }]) assert.ok(!render('production', { solar_today: state(5, 'kWh') }, extra(bad)).includes('widget-ring-allocation'));
  const dayKeyed = render('consumption', { home_today: state(5, 'kWh') }, { config: { energy_allocations: { '2026-10-27': { consumption: { parts: [{ key: 'solar', energy_kwh: 2 }, { key: 'grid', energy_kwh: 3 }] } } } } });
  assert.ok(dayKeyed.includes('widget-ring-allocation'));
});

test('month and year production use only explicitly supplied current-period totals', () => {
  const states = { solar_today: state(7, 'kWh'), solar_lifetime: state(.1, 'MWh') };
  const unknown = render('energy_produced', states);
  assert.ok(unknown.includes('<small>Month</small><strong>—</strong>') && unknown.includes('<small>Year</small><strong>—</strong>'));
  assert.ok(unknown.includes('100 kWh'));
  const known = render('energy_produced', states, { config: { energy_periods: { month: { '2026-10-01': { solar_today: 20 } }, year: { '2026-01-01': { solar_today: 80 } } } } });
  assert.ok(known.includes('20 kWh') && known.includes('80 kWh'));
  const invalid = render('energy_produced', states, { config: { energy_periods: { month: { '2026-09-01': { solar_today: 30 }, '2026-10-01': { solar_today: -1 } }, year: { '2026-01-01': { solar_today: true } } } } });
  assert.ok(!invalid.includes('30 kWh'));
  assert.ok(invalid.includes('<small>Month</small><strong>—</strong>') && invalid.includes('<small>Year</small><strong>—</strong>'));
});

test('environmental equivalents have no default factors and are explicitly labeled estimates', () => {
  const states = { solar_today: state(10, 'kWh'), solar_lifetime: state(.1, 'MWh') };
  const absent = render('environment', states);
  assert.ok(!absent.includes('Estimate'));
  assert.ok(absent.includes('<small>CO₂ avoided</small><strong>—</strong>'));
  const estimate = render('environment', states, { interfaceOptions: { environment: { co2_kg_per_kwh: .4, coal_kg_per_kwh: .2, trees_per_kwh: .01 } } });
  assert.ok(estimate.includes('Estimate') && estimate.includes('4 kg') && estimate.includes('2 kg') && estimate.includes('0.1 trees'));
  const lifetime = render('environment', states, { config: { environmental_factors: { energy_period: 'lifetime', co2_kg_per_kwh: .4 } } });
  assert.ok(lifetime.includes('Lifetime solar production') && lifetime.includes('40 kg'));
  const invalid = render('environment', states, { interfaceOptions: { environment: { co2_kg_per_kwh: true, coal_kg_per_kwh: -1, trees_per_kwh: Infinity } } });
  assert.ok(!invalid.includes('Estimate'));
  assert.ok(!render('environment', {}, { interfaceOptions: { environment: { co2_kg_per_kwh: .4 } } }).includes('Estimate'));
});

test('Energy Value accepts actual currency amount entities and never multiplies a current rate by daily energy', () => {
  const measured = render('energy_value', { import_cost_today: state(2, 'EUR'), export_revenue_today: state(.5, 'EUR') });
  assert.ok(measured.includes('2 EUR') && measured.includes('0.5 EUR') && measured.includes('1.5 EUR'));
  const rates = render('energy_value', { grid_import_today: state(100, 'kWh'), grid_export_today: state(50, 'kWh'), buy_price: state(.5, 'EUR/kWh'), sell_price: state(.2, 'EUR/kWh'), import_cost_today: state(.5, 'EUR/kWh') });
  assert.ok(rates.includes('<small>Import cost</small><strong>—</strong>'));
  assert.ok(rates.includes('<small>Export income</small><strong>—</strong>'));
  assert.ok(rates.includes('data-detail="tariffs"'));
  const stale = render('energy_value', { import_cost_today: state(100, 'EUR', { date: '2026-10-26' }) });
  assert.ok(!stale.includes('100 EUR'));
  const mixed = render('energy_value', { import_cost_today: state(-2, 'GBP'), export_revenue_today: state(.5, 'EUR') });
  assert.ok(mixed.includes('-2 GBP') && mixed.includes('<small>Net cost</small><strong>—</strong>'));
});

const settledIntervals = () => ({ complete: true, date: '2026-10-27', currency: 'EUR', start: '2026-10-27T00:00:00Z', end: '2026-10-27T01:00:00Z', intervals: [
  { start: '2026-10-27T00:00:00Z', end: '2026-10-27T00:30:00Z', import_kwh: 1, export_kwh: 2, buy_price_per_kwh: .1, sell_price_per_kwh: .2 },
  { start: '2026-10-27T00:30:00Z', end: '2026-10-27T01:00:00Z', import_kwh: 2, export_kwh: 0, buy_price_per_kwh: .2, sell_price_per_kwh: .3 },
] });
test('interval costs require complete contiguous settled data reconciled with actual daily energy', () => {
  const states = { grid_import_today: state(.003, 'MWh'), grid_export_today: state(2000, 'Wh') }, source = settledIntervals();
  const body = render('energy_value', states, { config: { energy_value_intervals: source } });
  assert.ok(body.includes('0.5 EUR') && body.includes('0.4 EUR') && body.includes('0.1 EUR'));
  const badSources = [
    { ...source, complete: false }, { ...source, date: '2026-10-26' }, { ...source, end: '2026-10-27T00:30:00Z' },
    { ...source, intervals: [source.intervals[0], { ...source.intervals[1], start: '2026-10-27T00:35:00Z' }] },
    { ...source, intervals: [{ ...source.intervals[0], import_kwh: 9 }, source.intervals[1]] },
    { ...source, intervals: [{ ...source.intervals[0], import_kwh: -1 }, source.intervals[1]] },
    { ...source, intervals: [{ ...source.intervals[0], buy_price_per_kwh: true }, source.intervals[1]] },
  ];
  for (const invalid of badSources) assert.ok(render('energy_value', states, { config: { energy_value_intervals: invalid } }).includes('<small>Import cost</small><strong>—</strong>'));
  assert.ok(render('energy_value', {}, { config: { energy_value_intervals: source } }).includes('<small>Import cost</small><strong>—</strong>'));
});

test('Energy Value expansion reuses measured or reconciled costs and has no recursive expand target', () => {
  for (const ctx of [context({ import_cost_today: state(2, 'EUR'), export_revenue_today: state(.5, 'EUR') }), context({ grid_import_today: state(3, 'kWh'), grid_export_today: state(2, 'kWh') }, { config: { energy_value_intervals: settledIntervals() } })]) {
    const overview = renderSummaryWidget('energy_value', ctx), expanded = renderSummaryDetail('energy_value', ctx);
    assert.equal(expanded.title, 'Energy Value');
    assert.deepEqual([...expanded.body.matchAll(/<strong>([^<]*)<\/strong>/g)].map(match => match[1]), [...overview.matchAll(/<strong>([^<]*)<\/strong>/g)].map(match => match[1]));
    assert.match(expanded.body, />Today<\/span>/);
    assert.match(expanded.body, /data-detail="revenue_calendar"/); assert.match(expanded.body, /data-detail="statistics"/);
    assert.doesNotMatch(expanded.body, /widget-expand|data-detail="energy_value"|<h2>/);
  }
  const missing = renderSummaryDetail('energy_value', context({ grid_import_today: state(100, 'kWh'), buy_price: state(.5, 'EUR\/kWh') })).body;
  assert.equal((missing.match(/<strong>—<\/strong>/g) ?? []).length, 3);
  const mixed = renderSummaryDetail('energy_value', context({ import_cost_today: state(-2, 'GBP'), export_revenue_today: state(.5, 'EUR') })).body;
  assert.match(mixed, /-2 GBP/); assert.match(mixed, /<small>Net cost<\/small><strong>—<\/strong>/);
});

test('environment expansion shows the same configured estimates, period and factors without a self link', () => {
  for (const period of ['today', 'lifetime']) {
    const ctx = context({ solar_today: state(10, 'kWh'), solar_lifetime: state(.1, 'MWh') }, { config: { environmental_factors: { energy_period: period, co2_kg_per_kwh: .4, coal_kg_per_kwh: .2, trees_per_kwh: .01 } } });
    const overview = renderSummaryWidget('environment', ctx), detail = renderSummaryDetail('environment', ctx);
    assert.equal(detail.title, 'Environmental Benefits');
    assert.deepEqual([...detail.body.matchAll(/<strong>([^<]*)<\/strong>/g)].map(match => match[1]), [...overview.matchAll(/<strong>([^<]*)<\/strong>/g)].map(match => match[1]));
    assert.ok(detail.body.includes(`${period === 'lifetime' ? 'Lifetime' : 'Today'} · Estimate`));
    assert.match(detail.body, /0.4 kg\/kWh/); assert.match(detail.body, /0.01 trees\/kWh/);
    assert.doesNotMatch(detail.body, /widget-expand|data-detail="environment"|<h2>|No factors/);
  }
  const missing = renderSummaryDetail('environment', context({ solar_today: state(0, 'kWh') })).body;
  assert.match(missing, /0 kWh/); assert.doesNotMatch(missing, /Estimate/);
  assert.equal((missing.match(/<dd>—<\/dd>/g) ?? []).length, 3);
  const missingEnergy = renderSummaryDetail('environment', context({}, { interfaceOptions: { environment: { co2_kg_per_kwh: .4 } } })).body;
  assert.match(missingEnergy, /0.4 kg\/kWh/); assert.doesNotMatch(missingEnergy, /Estimate/);
  assert.equal(renderSummaryDetail('unknown'), null);
});

test('AI summary reports only current mode and SOC with safe read-only navigation', () => {
  const body = render('ai', { cloud_mode: state('Sigen AI Mode', ''), battery_soc: state(75, '%') });
  assert.ok(body.includes('Sigen AI Mode') && body.includes('75 %'));
  assert.ok(!body.includes('Controls locked'));
  for (const route of ['ai', 'strategies']) assert.ok(body.includes(`data-detail="${route}"`));
  assert.ok(body.includes('data-manual="charge"'));
  assert.ok(!body.includes('data-execute='));
});

test('strategy summaries show actual saved local draft names and times, never example schedules', () => {
  const body = render('strategies', {}, { interfaceOptions: { strategy: { night: { name: 'Owner plan', start: '02:00', end: '05:00', enabled: true }, invalid: { name: 'Other plan', start: 'bad', end: '25:00' } } } });
  assert.ok(body.includes('Owner plan') && body.includes('02:00–05:00'));
  assert.ok(body.includes('Draft') && body.includes('data-detail="strategy" data-id="night"'));
  assert.ok(body.includes('data-detail="strategy" data-id="new"'));
  assert.ok(render('strategies').includes('No strategies saved'));
  assert.ok(!render('strategies').includes('02:00'));
});

test('all mapped labels and draft names are escaped and untrusted route keys stay inert', () => {
  const bad = '<img src=x onerror="bad">';
  const ai = render('ai', { cloud_mode: state(bad, '') });
  const drafts = render('strategies', {}, { interfaceOptions: { strategy: JSON.parse(`{"safe":{"name":${JSON.stringify(bad)},"start":"02:00","end":"05:00"},"__proto__":{"name":"Unsafe draft"}}`) } });
  const allocation = render('production', { solar_today: state(1, 'kWh') }, { config: { energy_allocations: { production: { date: '2026-10-27', parts: [{ key: 'home', energy_kwh: 1, label: bad }] } } } });
  for (const body of [ai, drafts, allocation]) { assert.ok(!body.includes('<img')); assert.ok(!body.includes(' onerror="')); assert.ok(body.includes('&lt;img')); }
  assert.ok(!drafts.includes('Unsafe draft'));
});

test('summary widget source has no imports, requests, credential handling or hardware execution', async () => {
  const source = await readFile(new URL('../custom_components/sigen_hybrid/frontend/sigen-hybrid-widgets.js', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\s/m.test(source));
  assert.ok(!/\bfetch\s*\(|callWS\s*\(|callService\s*\(|XMLHttpRequest|new\s+WebSocket|localStorage|dry_run\s*:\s*false/.test(source));
});
