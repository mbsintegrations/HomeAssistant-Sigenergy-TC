import { renderSceneWeather, renderWeatherEffects } from './sigen-hybrid-house.js?v=0.2.0';
/*
 * Copyright 2025-2026 Jean-Yves Avenard
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* Scene renderer adapted from jyavenard/sigenergy-flow-card v54, commit
 * 86f82a214c7a. See THIRD_PARTY_NOTICES.md.
 * Modified for Sigenergy TC: newly generated day/night house artwork,
 * remapped equipment anchors and responsive framing; no upstream image assets.
 * Pure scene-only rendering uses host readings, freshness, appearance,
 * animation preference and read-only detail actions. Upstream charts, history,
 * statistics, network access and controls are omitted. Coordinated pulses use
 * CSS animation instead of an animation-frame loop.
 */

// Local generated assets load only when the host renders the selected scene.
// Constructing a URL neither fetches an image nor registers an extra resource.
const ARTWORK = Object.freeze({
  day: new URL('./assets/overview-house-day-v1.webp', import.meta.url).href,
  night: new URL('./assets/overview-house-night-v1.webp', import.meta.url).href,
});

const PHOTO = Object.freeze({ width: 1676, height: 557, top: 56, bottom: 60, bleed: 100 });
const SCENE = Object.freeze({ width: PHOTO.width, height: PHOTO.top + PHOTO.height + PHOTO.bottom });
const FADE = Object.freeze({ topEnd: 140, bottomStart: 533 });
// Cover the whole scene with real image pixels. Equipment paths share the same
// transform, so eliminating reserved header/footer bands cannot detach a wire.
const COVER = Object.freeze({ scale: SCENE.height / PHOTO.height, x: SCENE.width / 2 * (1 - SCENE.height / PHOTO.height), y: -PHOTO.top * SCENE.height / PHOTO.height });
const coverPoint = ([x, y]) => [x * COVER.scale + COVER.x, y * COVER.scale + COVER.y];
const coveredSolar = coverPoint([838, 239]), coveredHome = coverPoint([1186, 337]);
const coveredBattery = coverPoint([820, 491]), coveredGrid = coverPoint([1100, 535]);
const READINGS = Object.freeze({ solar: [coveredSolar[0] + 12, 16], home: [coveredHome[0] + 12, 16], lower: [coveredBattery[0] + 12, coveredGrid[0] + 12, 628] });
const LEADERS = [`M${number(coveredSolar[0], 3)} 18 V${number(coveredSolar[1], 3)}`, `M${number(coveredHome[0], 3)} 18 V${number(coveredHome[1], 3)}`, `M${number(coveredBattery[0], 3)} ${number(coveredBattery[1], 3)} V641`, `M${number(coveredGrid[0], 3)} ${number(coveredGrid[1], 3)} V641`];
const FLOWS = Object.freeze({
  solarFlow: { path: 'M838 239 V267 Q838 274 832 280 V389', length: 152.7 },
  inverterFlow: { path: 'M854 442 L858 449 Q860 453 864 449 L866 438', length: 25.5, gateway: 'end' },
  homeFlow: { path: 'M890 438 V466 Q890 474 898 474 H1178 Q1186 474 1186 466 V337', length: 462.1, gateway: 'start' },
  homeBranch: { path: 'M1186 404 H1210', length: 24, parent: 'homeFlow', fork: 395.1 },
  gridFlow: { path: 'M878 453 V486 Q878 492 886 494 L1100 535', length: 261.4, gateway: 'start' },
});
// Distances follow the remapped local paths. A shared cycle carries the pulse
// through the inverter/gateway to HOME without traversing the open sky.
const PULSE = Object.freeze({ toGateway: 90, cycle: 670, length: 130, speed: [110, 65] });
const COMET_LAYERS = [1, .78, .56, .36, .18];
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
function number(value, places = 2) { return Number(value.toFixed(places)).toString(); }

function reading(ctx, key, quantity = 'power') {
  let value;
  try { value = finite(ctx.value?.(key, quantity)); } catch { return null; }
  return quantity === 'soc' && value !== null && (value < 0 || value > 100) ? null : value;
}
function configured(ctx, key) {
  try { return ctx.has?.(key) === true; } catch { return false; }
}
function activeReading(ctx, key, value) {
  if (value === null || Math.abs(value) < .025) return false;
  // The host owns timestamps and paused-cloud/snapshot freshness rules.
  try { const activity = ctx.activity?.(key); return activity?.active === true && activity.fresh !== false; } catch { return false; }
}
function freshReading(ctx, key, value) {
  if (value === null) return false;
  try {
    if (typeof ctx.fresh === 'function') return ctx.fresh(key) === true;
    const activity = ctx.activity?.(key);
    // Without a freshness bit a nonzero active reading proves freshness. An
    // idle zero needs the host's explicit fresh:true; never infer it from zero.
    return activity?.fresh === true || activity?.fresh === undefined && activity?.active === true;
  } catch { return false; }
}
function power(value) {
  if (value === null) return '—';
  const magnitude = Math.abs(value);
  return magnitude > 0 && magnitude < 1 ? `${Math.round(magnitude * 1000)} W` : `${number(magnitude)} kW`;
}
function status(value, positive, negative) {
  return value === null ? '' : value > .025 ? positive : value < -.025 ? negative : 'Idle';
}
function chargerState(ctx) {
  let value;
  try { value = ctx.state?.('ac_state'); } catch { return ''; }
  value = value && typeof value === 'object' ? value.state : value;
  return value === undefined || value === null || ['unknown', 'unavailable', 'none', ''].includes(String(value).trim().toLowerCase()) ? '' : String(value);
}

/** Pure visual model. Power is normalized kW; positive battery is charging and
 * positive grid is importing. No entity discovery or host mutation occurs. */
export function photoSceneModel(ctx = {}) {
  const solar = reading(ctx, 'solar_power'), home = reading(ctx, 'home_power');
  const battery = reading(ctx, 'battery_power'), soc = reading(ctx, 'battery_soc', 'soc');
  const grid = reading(ctx, 'grid_power'), ac = reading(ctx, 'ac_power'), dc = reading(ctx, 'dc_power');
  const hasAc = configured(ctx, 'ac_power') || configured(ctx, 'ac_state'), hasDc = configured(ctx, 'dc_power');
  const solarActive = activeReading(ctx, 'solar_power', solar);
  const homeActive = activeReading(ctx, 'home_power', home), gridActive = activeReading(ctx, 'grid_power', grid);
  // Match the upstream SigenStor AC-output calculation. A configured charger
  // with unavailable power prevents an invented net-output value.
  const primary = solar !== null && battery !== null && (!hasDc || dc !== null);
  const inverter = primary ? solar - battery - (hasDc ? dc : 0) : home !== null && grid !== null ? home - grid : null;
  const inverterFresh = primary
    ? freshReading(ctx, 'solar_power', solar) && freshReading(ctx, 'battery_power', battery) && (!hasDc || freshReading(ctx, 'dc_power', dc))
    : freshReading(ctx, 'home_power', home) && freshReading(ctx, 'grid_power', grid);
  const inverterActive = inverter !== null && Math.abs(inverter) >= .025 && inverterFresh;
  const flow = (value, active, reverse = value !== null && value < 0) => ({ value, active, reverse });
  return {
    night: ctx.night === true, animations: ctx.animations !== false,
    values: { solar, home, battery, soc, grid, ac, dc, inverter },
    hasAc, hasDc, acState: chargerState(ctx),
    batteryStatus: status(battery, 'Charging', 'Discharging'), gridStatus: status(grid, 'Importing', 'Exporting'),
    flows: {
      solarFlow: flow(solar, solarActive), inverterFlow: flow(inverter, inverterActive),
      homeFlow: flow(home, homeActive), homeBranch: flow(home, homeActive),
      // This cable's path points from gateway to grid.
      gridFlow: flow(grid === null ? null : -grid, gridActive, grid !== null && grid > 0),
    },
    duration: PULSE.cycle / (PULSE.speed[0] + PULSE.speed[1] * Math.sqrt(homeActive ? Math.abs(home) : 0)),
  };
}

function label(route, title, value, detail = '', className = '', style = '') {
  return `<div class="sigen-photo-node ${className}"${style ? ` style="${style}"` : ''}><button type="button" data-detail="${route}" aria-label="${escape(`${title}: ${value}${detail ? `, ${detail}` : ''}. Open details`)}"><strong>${escape(value)}</strong><small>${escape(title)} <span aria-hidden="true">›</span></small>${detail ? `<em>${escape(detail)}</em>` : ''}</button></div>`;
}
function place([x, y]) { return `left:${number(x / SCENE.width * 100, 5)}%;top:${number(y / SCENE.height * 100, 5)}%`; }
function pulseStyle(id, state, length, model, layer) {
  const definition = FLOWS[id], parent = definition.parent ? FLOWS[definition.parent] : definition;
  const start = id === 'solarFlow' ? PULSE.cycle - definition.length - PULSE.length / 2 : parent.gateway && (parent.gateway === 'start') !== state.reverse ? PULSE.toGateway : 0;
  const travelStart = start + (definition.fork ?? 0) + PULSE.length / 2;
  const from = state.reverse ? length / 2 - definition.length - travelStart : length / 2 + travelStart;
  const to = from + (state.reverse ? PULSE.cycle : -PULSE.cycle);
  return `--photo-pulse-from:${number(from, 3)};--photo-pulse-to:${number(to, 3)};--photo-pulse-duration:${number(model.duration, 3)}s;stroke-dasharray:${number(length, 3)} ${number(PULSE.cycle - length, 3)};${layer === 'glow' ? '' : `opacity:${number(.14 + (1 - COMET_LAYERS.indexOf(layer) / COMET_LAYERS.length) * .17, 3)}`}`;
}
function flowMarkup(id, model) {
  const definition = FLOWS[id], state = model.flows[id];
  const classes = `sigen-photo-flow${state.active ? ' is-active' : ''}${state.active && model.animations ? ' is-moving' : ''}${state.reverse ? ' is-reverse' : ''}`;
  const attributes = `d="${definition.path}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  return `<g class="${classes}" data-photo-flow="${id}" data-active="${state.active}" data-reverse="${state.reverse}"><path class="sigen-photo-wire" ${attributes} stroke="#657377" stroke-width="3"/><path class="sigen-photo-glow" ${attributes} stroke="#63d6c1" stroke-width="9" style="${pulseStyle(id, state, PULSE.length * .6, model, 'glow')}"/>${COMET_LAYERS.map(layer => `<path class="sigen-photo-comet" ${attributes} stroke="#8ff5e1" stroke-width="3.4" style="${pulseStyle(id, state, PULSE.length * layer, model, layer)}"/>`).join('')}</g>`;
}

/** Render only local artwork, host-provided readings and detail navigation.
 * idPrefix may identify a scene when several share the same DOM tree. */
export function renderPhotoScene(ctx = {}) {
  const model = photoSceneModel(ctx), values = model.values, variant = model.night ? 'night' : 'day';
  const image = ARTWORK[variant];
  const prefix = typeof ctx.idPrefix === 'string' && /^[A-Za-z][\w-]{0,63}$/.test(ctx.idPrefix) ? ctx.idPrefix : 'sigen-photo';
  const gradient = name => `${prefix}-${name}`;
  const coverTransform = `translate(${number(COVER.x, 6)} ${number(COVER.y, 6)}) scale(${number(COVER.scale, 6)})`;
  const lower = `left:${number(READINGS.lower[0] / SCENE.width * 100, 5)}%;width:${number((SCENE.width - READINGS.lower[0]) / SCENE.width * 100, 5)}%;bottom:${number((SCENE.height - READINGS.lower[2]) / SCENE.height * 100, 5)}%;grid-template-columns:${number((READINGS.lower[1] - READINGS.lower[0]) / (SCENE.width - READINGS.lower[0]) * 100, 5)}% auto`;
  const soc = values.soc === null ? '—' : `${number(values.soc, 1)}%`;
  return `<section class="sigen-photo-scene${model.night ? ' is-night' : ''}" aria-label="Home energy flow"><div class="sigen-photo-frame">${renderWeatherEffects(ctx)}<div class="sigen-photo-weather">${renderSceneWeather(ctx)}</div><div class="sigen-photo-plane"><svg viewBox="0 0 ${SCENE.width} ${SCENE.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Energy flow between solar panels, SigenStor, home and grid"><defs><linearGradient id="${gradient('top')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="sigen-photo-fade" stop-opacity=".6"/><stop offset=".5" class="sigen-photo-fade" stop-opacity=".35"/><stop offset="1" class="sigen-photo-fade" stop-opacity="0"/></linearGradient><linearGradient id="${gradient('bottom')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="sigen-photo-fade" stop-opacity="0"/><stop offset=".45" class="sigen-photo-fade" stop-opacity=".4"/><stop offset="1" class="sigen-photo-fade" stop-opacity=".65"/></linearGradient><linearGradient id="${gradient('left')}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" class="sigen-photo-fade" style="stop-opacity:var(--photo-fade-left)"/><stop offset="1" class="sigen-photo-fade" stop-opacity="0"/></linearGradient></defs><g class="sigen-photo-cover-image" transform="${coverTransform}"><image class="sigen-photo-art" href="${escape(image)}" x="0" y="${PHOTO.top}" width="${PHOTO.width}" height="${PHOTO.height}" preserveAspectRatio="xMidYMid meet"/></g><rect x="0" y="-${PHOTO.bleed}" width="${SCENE.width}" height="${FADE.topEnd + PHOTO.bleed}" class="sigen-photo-fade-rect" fill="url(#${gradient('top')})"/><rect x="0" y="${FADE.bottomStart}" width="${SCENE.width}" height="${SCENE.height - FADE.bottomStart + PHOTO.bleed}" class="sigen-photo-fade-rect" fill="url(#${gradient('bottom')})"/><rect x="0" y="-${PHOTO.bleed}" width="520" height="${SCENE.height + 2 * PHOTO.bleed}" fill="url(#${gradient('left')})"/><g class="sigen-photo-cover-flows" transform="${coverTransform}">${Object.keys(FLOWS).map(id => flowMarkup(id, model)).join('')}</g></svg></div><svg class="sigen-photo-label-leaders" viewBox="0 0 ${SCENE.width} ${SCENE.height}" preserveAspectRatio="none" aria-hidden="true">${LEADERS.map(path => `<path class="sigen-photo-leader" d="${path}" fill="none" stroke="#d5e1e5" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('')}</svg><div class="sigen-photo-labels">${label('solar', 'SOLAR', power(values.solar), '', 'sigen-photo-lead', place(READINGS.solar))}${label('load', 'HOME', power(values.home), '', 'sigen-photo-lead', place(READINGS.home))}<div class="sigen-photo-lower" style="${lower}">${label('battery', `SigenStor · ${soc}`, power(values.battery), model.batteryStatus)}${label('grid', 'GRID', power(values.grid), model.gridStatus)}</div>${model.hasAc || model.hasDc ? `<div class="sigen-photo-chargers">${model.hasAc ? label('ac', 'AC CHARGER', power(values.ac), model.acState) : ''}${model.hasDc ? label('dc', 'DC CHARGER', power(values.dc), status(values.dc, 'Charging', 'Discharging')) : ''}</div>` : ''}</div></div></section>`;
}

export const PHOTO_STYLE = `
.sigen-photo-scene{container-type:inline-size;position:relative;width:100%;overflow:hidden;border-radius:20px;background:#193747;--photo-fade:#193747;--photo-fade-opacity:.95;--photo-fade-left:.6;--photo-node-fg:#fff;--photo-node-sub:#f2f6f8;--photo-node-em:#c4f6ea;--photo-node-shadow:0 0 2px #000c,0 1px 3px #000,0 2px 10px #000d;--photo-leader:rgba(255,255,255,.7);--photo-wire-on:rgba(18,184,166,.9);--photo-comet:#5eead4}
.sigen-photo-scene.is-night{background:#11191d;--photo-fade:#11191d;--photo-fade-opacity:1;--photo-fade-left:.7;--photo-node-fg:#edf3f6;--photo-node-sub:#d0dade;--photo-node-em:#a5ecd9;--photo-node-shadow:0 1px 2px #000,0 2px 10px #000c;--photo-leader:rgba(225,234,236,.55);--photo-wire-on:rgba(99,214,193,.85);--photo-comet:#8ff5e1}
.sigen-photo-frame{position:relative;aspect-ratio:1490/673;width:100%}.sigen-photo-plane{position:absolute;top:0;left:-4.026846%;width:112.483221%;height:100%}.sigen-photo-plane>svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.sigen-photo-labels,.sigen-photo-label-leaders{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.sigen-photo-labels button{pointer-events:auto}.sigen-photo-fade{stop-color:var(--photo-fade)}.sigen-photo-fade-rect{opacity:var(--photo-fade-opacity)}.sigen-photo-leader{fill:none;stroke:var(--photo-leader);vector-effect:non-scaling-stroke}.sigen-photo-wire{fill:none;stroke:rgba(18,26,30,.4);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.sigen-photo-flow.is-active .sigen-photo-wire{stroke:var(--photo-wire-on)}
.sigen-photo-glow,.sigen-photo-comet{fill:none;stroke:var(--photo-comet);stroke-linecap:round;stroke-linejoin:round;display:none;stroke-dashoffset:var(--photo-pulse-from)}.sigen-photo-glow{filter:blur(3px);opacity:.6}.sigen-photo-flow.is-moving .sigen-photo-glow,.sigen-photo-flow.is-moving .sigen-photo-comet{display:inline;animation:sigen-photo-pulse var(--photo-pulse-duration,5s) linear infinite}@keyframes sigen-photo-pulse{from{stroke-dashoffset:var(--photo-pulse-from)}to{stroke-dashoffset:var(--photo-pulse-to)}}
.sigen-photo-node{position:absolute;z-index:2;color:var(--photo-node-fg);white-space:nowrap;line-height:1.2;text-shadow:var(--photo-node-shadow)}.sigen-photo-node button{all:unset;pointer-events:auto;display:block;cursor:pointer;max-width:100%;min-height:40px;font:inherit;color:inherit;text-shadow:inherit}.sigen-photo-node button:focus-visible{outline:2px solid #71d3d1;outline-offset:5px;border-radius:3px}.sigen-photo-node button:hover small{text-decoration:underline;text-underline-offset:3px}.sigen-photo-node strong{display:block;font-size:clamp(14px,2.33cqi,30px);font-weight:580;line-height:1.2}.sigen-photo-node small,.sigen-photo-node em{display:block;font-weight:500}.sigen-photo-node small{font-size:clamp(11px,1.64cqi,20px);color:var(--photo-node-sub);margin-top:.15em;letter-spacing:.3px}.sigen-photo-node small span{display:inline;font:inherit;opacity:.75}.sigen-photo-node em{font-size:clamp(10px,1.12cqi,14px);font-style:normal;color:var(--photo-node-em);margin-top:.2em;white-space:normal;overflow-wrap:anywhere;max-width:14em}.sigen-photo-node em:empty{display:none}
.sigen-photo-lower{position:absolute;z-index:2;display:grid;align-items:start}.sigen-photo-lower .sigen-photo-node{position:static;min-width:0}.sigen-photo-lower .sigen-photo-node button{box-sizing:border-box;width:100%;padding-right:6px}.sigen-photo-lower .sigen-photo-node small{white-space:normal}.sigen-photo-chargers{position:absolute;left:14.916468%;top:51%;transform:translateY(-50%);z-index:2;display:flex;flex-direction:column;justify-content:space-between;gap:max(14px,2.07cqi);min-height:15.86cqi;max-width:18%}.sigen-photo-chargers .sigen-photo-node{position:static;border-left:1px solid var(--photo-leader);padding-left:max(6px,.86cqi)}
@container (max-width:560px){.sigen-photo-frame{aspect-ratio:1360/673}.sigen-photo-plane{left:-10.294118%;width:123.235294%}.sigen-photo-lead{transform:translateX(calc(-100% - 2.89cqi));text-align:right}.sigen-photo-node strong{font-size:clamp(14px,3.26cqi,27px)}.sigen-photo-node small{font-size:clamp(11px,2.29cqi,19px)}.sigen-photo-node em{font-size:clamp(10px,1.57cqi,13px)}.sigen-photo-chargers{left:14.916468%;min-height:22.17cqi;gap:max(12px,2.89cqi);max-width:18%}}
@media(prefers-reduced-motion:reduce){.sigen-photo-flow.is-moving .sigen-photo-glow,.sigen-photo-flow.is-moving .sigen-photo-comet{display:none;animation:none}}

.sigen-photo-weather{position:absolute;top:3%;left:3%;z-index:4;color:var(--photo-node-fg);text-shadow:var(--photo-node-shadow)}.sigen-photo-weather .house-weather{appearance:none;display:flex;align-items:center;gap:10px;min-height:36px;border:0;border-radius:14px;padding:7px 12px;background:#12253370;color:inherit;cursor:pointer;font:inherit;backdrop-filter:blur(5px)}.sigen-photo-weather .house-temperature{font-size:clamp(16px,2.4cqi,32px)}.sigen-photo-weather .house-weather-icon{width:clamp(28px,4cqi,48px);height:clamp(28px,4cqi,48px)}.sigen-photo-weather .house-weather-symbol{font-size:clamp(28px,4cqi,48px)}.sigen-photo-frame>.scene-weather-effects{z-index:1}.sigen-photo-weather button:focus-visible{outline:2px solid #71d3d1;outline-offset:3px}
`;
