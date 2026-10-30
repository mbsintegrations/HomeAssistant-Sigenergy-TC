/* SPDX-License-Identifier: GPL-3.0-only
 * Original, pure summary views. The host owns navigation and all data access.
 */
export const WIDGET_ROUTES = Object.freeze(['energy_value', 'production', 'consumption', 'energy_produced', 'environment', 'ai', 'strategies']);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const number = value => !['number', 'string'].includes(typeof value) || typeof value === 'string' && !value.trim() ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const nonnegative = value => { const result = number(value); return result !== null && result >= 0 ? result : null; };
const knownState = reading => reading && !['unknown', 'unavailable', 'none', ''].includes(String(reading.state ?? '').toLowerCase());
const COLORS = { solar: '#efc900', battery: '#26c9c8', grid: '#6694ff', home: '#a45bf0', ac: '#b46767', dc: '#d29420' };
const LABELS = { solar: 'Solar', battery: 'Battery', grid: 'Grid', home: 'Load', ac: 'AC charger', dc: 'DC charger' };
function state(ctx, key) { try { return ctx.state?.(key) ?? null; } catch { return null; } }
function energy(ctx, keys) {
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    const reading = state(ctx, key);
    if (reading && (!knownState(reading) || !['Wh', 'kWh', 'MWh'].includes(reading.attributes?.unit_of_measurement))) continue;
    try { const value = nonnegative(ctx.value?.(key, 'energy')); if (value !== null) return value; } catch { /* Optional source. */ }
  }
  return null;
}
function scalar(ctx, key, quantity) {
  const reading = state(ctx, key); if (reading && !knownState(reading)) return null;
  try { return number(ctx.value?.(key, quantity)); } catch { return null; }
}
function formatted(value, unit = '') { return value === null || !Number.isFinite(value) ? '—' : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ''}`; }
function calendar(ctx, timestamp) {
  const now = typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const time = timestamp ?? now;
  let timezone = ctx.timezone ?? 'UTC';
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(time); } catch { timezone = 'UTC'; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(time).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { now, timezone, date: `${parts.year}-${parts.month}-${parts.day}`, month: `${parts.year}-${parts.month}-01`, year: `${parts.year}-01-01`, midnight: parts.hour === '00' && parts.minute === '00' && parts.second === '00' && time % 1000 === 0 };
}
function link(route, label, id) { return `<button type="button" class="widget-link" data-detail="${esc(route)}"${id === undefined ? '' : ` data-id="${esc(id)}"`}><span>${esc(label)}</span><span aria-hidden="true">›</span></button>`; }
function metric(label, value, unit = '', tone = '') { return `<div class="widget-metric${tone ? ` widget-tone-${tone}` : ''}"><small>${esc(label)}</small><strong>${esc(formatted(value, unit))}</strong></div>`; }
function frame(route, title, body, badge = '', detail = false) { return `<section class="${detail ? 'widget-detail ' : 'panel '}sigen-summary-widget widget-${route}"${detail?'':` data-detail="${esc(route)}" data-card-detail="${esc(route)}"`}>${detail ? `<div class="widget-detail-period"><span class="widget-badge">${esc(badge)}</span></div>` : `<div class="section-title"><h2 data-detail="${esc(route)}" role="button" tabindex="0" aria-label="${esc(`Open ${title}`)}">${esc(title)}</h2><div class="widget-heading-actions">${badge ? `<span class="widget-badge">${esc(badge)}</span>` : ''}</div></div>`}${body}</section>`; }

function allocation(ctx, route, total) {
  if (total === null || total <= 0) return null;
  const date = calendar(ctx).date, all = object(ctx.config?.energy_allocations);
  const day = object(all[date]), source = object(day[route] ?? all[route]);
  if (!Object.keys(source).length || source.date !== undefined && source.date !== date || !day[route] && source.date !== date || source.unit !== undefined && source.unit !== 'kWh' || !Array.isArray(source.parts)) return null;
  const allowed = route === 'production' ? ['home', 'battery', 'grid', 'ac', 'dc'] : ['solar', 'battery', 'grid', 'dc'];
  const seen = new Set(), parts = [];
  for (const item of source.parts) {
    if (!item || typeof item !== 'object') return null;
    const key = item.key === 'load' ? 'home' : item.key, value = nonnegative(item.energy_kwh);
    if (!allowed.includes(key) || value === null || seen.has(key)) return null;
    seen.add(key); parts.push({ key, value, label: typeof item.label === 'string' ? item.label : LABELS[key] });
  }
  const sum = parts.reduce((total, item) => total + item.value, 0);
  return parts.length && parts.length <= allowed.length && Math.abs(sum - total) <= Math.max(.001, total * .001) ? parts : null;
}
function ring(total, tone, parts) {
  let position = 0;
  const gradient = parts?.map(part => { const start = position; position += part.value / total * 100; return `${COLORS[part.key]} ${start}% ${position}%`; }).join(',');
  return `<div class="widget-ring${parts ? ' widget-ring-allocation' : ''}" style="--widget-ring:${parts ? `conic-gradient(${gradient})` : COLORS[tone]}"><div><strong>${esc(formatted(total, 'kWh'))}</strong><small>Today</small></div></div>`;
}
function routingWidget(route, ctx) {
  const production = route === 'production', total = energy(ctx, production ? 'solar_today' : 'home_today');
  const lifetime = energy(ctx, production ? ['solar_lifetime', 'solar_energy_lifetime', 'total_pv_generation'] : ['home_lifetime', 'load_energy_lifetime', 'total_load_consumption']);
  const parts = allocation(ctx, route, total);
  const legend = parts ? `<div class="widget-allocation-list">${parts.map(part => `<div><i style="--widget-dot:${COLORS[part.key]}"></i><span>${esc(part.label)}</span><strong>${esc(formatted(part.value, 'kWh'))}</strong></div>`).join('')}</div>` : '';
  return frame(route, production ? 'PV Production' : 'Consumption', `<div class="widget-production-body">${ring(total, production ? 'solar' : 'home', parts)}${legend}</div><div class="widget-bottom-total"><small>Lifetime</small><strong>${esc(formatted(lifetime, 'kWh'))}</strong></div>${link(route, 'Breakdown')}`);
}
function periodSolar(ctx, period) {
  const dates = calendar(ctx), records = object(ctx.config?.energy_periods?.[period]);
  for (const date of [dates.date, dates[period]]) {
    if (!Object.hasOwn(records, date)) continue;
    const record = object(records[date]);
    if (record.date !== undefined && record.date !== date || record.unit !== undefined && record.unit !== 'kWh') continue;
    const amount = nonnegative(record.solar_today); if (amount !== null) return amount;
  }
  return null;
}
function produced(ctx) {
  return frame('energy_produced', 'Energy Produced', `<div class="widget-metrics widget-three">${metric('Month', periodSolar(ctx, 'month'), 'kWh', 'solar')}${metric('Year', periodSolar(ctx, 'year'), 'kWh', 'solar')}${metric('Lifetime', energy(ctx, ['solar_lifetime', 'solar_energy_lifetime', 'total_pv_generation']), 'kWh', 'solar')}</div>${link('energy_produced', 'Energy statistics')}`);
}

const currency = value => ({ '€': 'EUR', '$': 'USD', '£': 'GBP' })[value] ?? (typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : null);
function mappedMoney(ctx, keys) {
  const today = calendar(ctx).date;
  for (const key of keys) {
    if (!Object.hasOwn(object(ctx.entities), key)) continue;
    const reading = state(ctx, key), unit = currency(reading?.attributes?.unit_of_measurement), amount = number(reading?.state);
    if (!knownState(reading) || unit === null || amount === null || reading.attributes?.date !== undefined && reading.attributes.date !== today) continue;
    return { value: amount, currency: unit };
  }
  return null;
}
function completeCosts(ctx) {
  // Explicit measured interval energies and the rates applying to those intervals.
  const source = object(ctx.config?.energy_value_intervals), today = calendar(ctx), unit = currency(source.currency);
  const timestamp = raw => typeof raw === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ? Date.parse(raw) : NaN;
  const start = timestamp(source.start), end = timestamp(source.end);
  if (source.complete !== true || source.date !== today.date || !unit || !Array.isArray(source.intervals) || !source.intervals.length || !Number.isFinite(start) || !Number.isFinite(end) || start >= end || end > today.now || today.now - end > 300000 || calendar(ctx, start).date !== today.date || !calendar(ctx, start).midnight || calendar(ctx, end - 1).date !== today.date) return null;
  const actualImport = energy(ctx, 'grid_import_today'), actualExport = energy(ctx, 'grid_export_today');
  if (actualImport === null || actualExport === null) return null;
  let previous = start, imported = 0, exported = 0, cost = 0, revenue = 0;
  for (const interval of source.intervals) {
    if (!interval || typeof interval !== 'object') return null;
    const from = timestamp(interval.start), until = timestamp(interval.end), buy = number(interval.buy_price_per_kwh), sell = number(interval.sell_price_per_kwh), incoming = nonnegative(interval.import_kwh), outgoing = nonnegative(interval.export_kwh);
    if (from !== previous || !Number.isFinite(until) || until <= from || until > end || buy === null || sell === null || incoming === null || outgoing === null) return null;
    imported += incoming; exported += outgoing; cost += incoming * buy; revenue += outgoing * sell; previous = until;
  }
  if (previous !== end || ![cost, revenue].every(Number.isFinite) || Math.abs(imported - actualImport) > .001 || Math.abs(exported - actualExport) > .001) return null;
  return { imported: { value: cost, currency: unit }, exported: { value: revenue, currency: unit } };
}
function moneyMetric(label, amount) { return metric(label, amount?.value ?? null, amount?.currency ?? ''); }
function energyValue(ctx, detail = false) {
  const calculated = completeCosts(ctx), imported = mappedMoney(ctx, ['import_cost_today', 'energy_import_cost_today']) ?? calculated?.imported, exported = mappedMoney(ctx, ['export_revenue_today', 'energy_export_revenue_today']) ?? calculated?.exported;
  const net = mappedMoney(ctx, ['net_cost_today', 'energy_net_cost_today']) ?? (imported && exported && imported.currency === exported.currency ? { value: imported.value - exported.value, currency: imported.currency } : null);
  return frame('energy_value', 'Energy Value', `<div class="widget-metrics widget-three">${moneyMetric('Import cost', imported)}${moneyMetric('Export income', exported)}${moneyMetric('Net cost', net)}</div>${link('tariffs', 'Buying & selling tariffs')}${detail ? link('revenue_calendar', 'Revenue calendar') + link('statistics', 'Period energy totals') : ''}`, 'Today', detail);
}
function environment(ctx, detail = false) {
  const prefs = object(ctx.interfaceOptions?.environment ?? ctx.config?.environmental_factors), lifetime = prefs.energy_period === 'lifetime';
  const measured = energy(ctx, lifetime ? ['solar_lifetime', 'solar_energy_lifetime', 'total_pv_generation'] : 'solar_today');
  const factors = [['CO₂ avoided', 'co2_kg_per_kwh', 'kg'], ['Coal equivalent', 'coal_kg_per_kwh', 'kg'], ['Tree equivalent', 'trees_per_kwh', 'trees']];
  let estimated = false;
  const values = factors.map(([label, key, unit]) => { const factor = Object.hasOwn(prefs, key) ? nonnegative(prefs[key]) : null; const amount = measured !== null && factor !== null ? measured * factor : null; const valid = amount !== null && Number.isFinite(amount) ? amount : null; if (valid !== null) estimated = true; return metric(label, valid, unit); }).join('');
  const factorList = detail ? `<h3 class="widget-factor-heading">Conversion factors</h3><dl class="widget-factor-list">${factors.map(([label, key, unit]) => `<dt>${esc(label)}</dt><dd>${esc(formatted(Object.hasOwn(prefs, key) ? nonnegative(prefs[key]) : null, `${unit}/kWh`))}</dd>`).join('')}</dl>` : '';
  const badge = detail ? `${lifetime ? 'Lifetime' : 'Today'}${estimated ? ' · Estimate' : ''}` : estimated ? 'Estimate' : '';
  return frame('environment', 'Environmental Benefits', `<div class="widget-bottom-total"><small>${lifetime ? 'Lifetime solar production' : 'Solar today'}</small><strong>${esc(formatted(measured, 'kWh'))}</strong></div><div class="widget-metrics widget-three">${values}</div>${factorList}${detail ? link('solar', 'Solar production') + link('energy_produced', 'Period energy totals') : link('environment', 'Environmental benefits')}`, badge, detail);
}
function currentText(ctx, keys) { for (const key of keys) { const reading = state(ctx, key); if (knownState(reading)) return String(reading.state).replaceAll('_', ' '); } return '—'; }
function ai(ctx) {
  const soc = scalar(ctx, 'battery_soc', 'soc'), validSoc = soc !== null && soc >= 0 && soc <= 100 ? soc : null;
  return frame('ai', 'Energy Assistant', `<div class="widget-ai-status"><div><small>Current mode</small><strong>${esc(currentText(ctx, ['cloud_mode', 'native_mode']))}</strong></div>${metric('Battery SOC', validSoc, '%', 'battery')}</div><div class="widget-links">${link('ai', 'AI overview')}${link('strategies', 'Personal strategies')}<button type="button" class="widget-link" data-manual="charge"><span>Instant manual control</span><span aria-hidden="true">›</span></button></div>`);
}
function strategies(ctx) {
  const records = object(ctx.interfaceOptions?.strategy), clock = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : '—';
  const entries = Object.entries(records).filter(([id, item]) => /^[a-zA-Z0-9_.:-]{1,80}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id) && item && typeof item === 'object' && !Array.isArray(item));
  const rows = entries.map(([id, item]) => `<button type="button" class="widget-strategy" data-detail="strategy" data-id="${esc(id)}"><span><strong>${esc(typeof item.name === 'string' && item.name.trim() ? item.name : '—')}</strong><small>${esc(clock(item.start))}–${esc(clock(item.end))}</small></span><span class="widget-badge">Draft</span></button>`).join('');
  return frame('strategies', 'Personal Strategies', `<div class="widget-strategies">${rows || '<div class="widget-empty">No strategies saved</div>'}</div>${link('strategy', 'Add personal strategy', 'new')}`);
}

export function renderSummaryWidget(route, ctx = {}) {
  const renderers = { energy_value: energyValue, production: context => routingWidget('production', context), consumption: context => routingWidget('consumption', context), energy_produced: produced, environment, ai, strategies };
  return Object.hasOwn(renderers, route) ? renderers[route](ctx) : '';
}

export function renderSummaryDetail(route, ctx = {}) {
  if (route === 'energy_value') return { title: 'Energy Value', body: energyValue(ctx, true) };
  if (route === 'environment') return { title: 'Environmental Benefits', body: environment(ctx, true) };
  return null;
}

export const WIDGET_STYLE = `
.widget-detail-period{display:flex;justify-content:flex-end;margin-bottom:12px}.widget-factor-heading{font-size:14px;font-weight:500;margin:26px 0 12px}.widget-factor-list{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0;margin:0 0 20px}.widget-factor-list dt,.widget-factor-list dd{border-bottom:1px solid var(--line,#e1e9ef);padding:12px 0;margin:0;overflow-wrap:anywhere}.widget-factor-list dt{color:var(--muted,#657a99);padding-right:16px}.widget-factor-list dd{font-variant-numeric:tabular-nums;text-align:right}
.sigen-summary-widget{min-width:0}.widget-heading-actions{display:flex;gap:8px;align-items:center}.widget-expand{border:0;border-radius:50%;width:34px;height:34px;background:transparent;color:var(--muted,#657a99);font-size:22px;cursor:pointer}.widget-badge{font-size:10px;line-height:1.3;padding:6px 9px;border-radius:20px;background:color-mix(in srgb,#17c5c8 12%,transparent);color:var(--muted,#657a99);white-space:nowrap}.widget-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:16px 0}.widget-three{grid-template-columns:repeat(3,minmax(0,1fr))}.widget-metric{min-width:0;padding:14px 12px;border-radius:14px;background:var(--surface,rgba(255,255,255,.65));border:1px solid var(--line,#e1e9ef)}.widget-metric small,.widget-bottom-total small,.widget-ai-status small{display:block;color:var(--muted,#657a99);font-size:11px}.widget-metric strong{display:block;font-size:clamp(16px,2.2cqi,25px);line-height:1.25;font-weight:600;letter-spacing:-.035em;margin-top:9px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.widget-tone-solar{box-shadow:inset 0 3px #efc90055}.widget-tone-battery{box-shadow:inset 0 3px #26c9c855}.widget-production-body{display:flex;align-items:center;justify-content:center;gap:24px;padding:16px 0}.widget-ring{flex-shrink:0;width:150px;height:150px;border-radius:50%;padding:14px;background:var(--widget-ring,#e9bf00);box-shadow:0 8px 25px #1437530b}.widget-ring>div{height:100%;border-radius:50%;background:var(--sigen-ring-bg,var(--card-background-color,#f5f9fc));display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;padding:8px}.widget-ring strong{font-size:21px;font-weight:600;letter-spacing:-.04em;font-variant-numeric:tabular-nums}.widget-ring small{color:var(--muted,#657a99);font-size:11px;margin-top:7px}.widget-allocation-list{display:grid;gap:11px;min-width:0;flex:1;max-width:260px}.widget-allocation-list>div{display:grid;grid-template-columns:8px minmax(0,1fr) auto;align-items:center;gap:8px;font-size:11px}.widget-allocation-list i{height:8px;width:8px;border-radius:50%;background:var(--widget-dot)}.widget-allocation-list strong{font-variant-numeric:tabular-nums;font-weight:600}.widget-bottom-total{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 2px;margin-top:4px;border-top:1px solid var(--line,#e1e9ef)}.widget-bottom-total strong{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}.widget-link{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:11px 4px;border:0;border-top:1px solid var(--line,#e1e9ef);background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer}.widget-link>span:last-child{font-size:21px;color:var(--muted,#657a99)}.widget-link:hover,.widget-strategy:hover{color:#00a9b5}.widget-ai-status{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(110px,1fr);align-items:center;gap:16px;margin:10px 0 14px}.widget-ai-status>div>strong{display:block;font-size:19px;font-weight:600;margin-top:8px}.widget-ai-status .widget-metric{margin:0}.widget-strategies{display:grid;gap:8px;margin:12px 0}.widget-strategy{display:flex;justify-content:space-between;align-items:center;gap:12px;border:1px solid var(--line,#e1e9ef);border-radius:13px;background:var(--surface,rgba(255,255,255,.65));color:inherit;padding:13px;text-align:left;font:inherit;cursor:pointer}.widget-strategy strong{display:block;font-size:13px;font-weight:600}.widget-strategy small{display:block;font-size:11px;color:var(--muted,#657a99);margin-top:6px}.widget-empty{padding:18px 4px;color:var(--muted,#657a99);font-size:12px}.widget-expand:focus-visible,.widget-link:focus-visible,.widget-strategy:focus-visible{outline:3px solid #00bdc7;outline-offset:2px}@container(max-width:480px){.widget-three{grid-template-columns:repeat(2,minmax(0,1fr))}.widget-three .widget-metric:last-child{grid-column:1/-1}.widget-production-body{gap:14px}.widget-ring{width:136px;height:136px;padding:12px}.widget-ring strong{font-size:19px}.widget-allocation-list>div{grid-template-columns:8px minmax(0,1fr);gap:6px}.widget-allocation-list strong{grid-column:2}.widget-ai-status{grid-template-columns:minmax(0,1fr) 110px}}
`;
