/* SPDX-License-Identifier: GPL-3.0-only
 * Recorded HA history charts. No provider requests or device commands.
 */
const PALETTE = ['#e9bf00', '#27bfc0', '#6896fa', '#a36af1', '#b96767', '#ce9528'];
const DAY = 86400000;
const dateFormatters = new Map();
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;

const pendingScrollFrames=new WeakMap();
export function preserveChartScroll(host, render) {
  const positions=[];
  for(let node=host;node;node=node.parentElement??node.getRootNode?.()?.host){
    if(node.scrollTop||node.scrollLeft)positions.push([node,node.scrollTop,node.scrollLeft]);
  }
  try{return render();}finally{
    for(const [node,top,left] of positions.reverse()){node.scrollTop=top;node.scrollLeft=left;}
    // Browser scroll anchoring can run after the synchronous DOM update.
    // Stabilize once before paint, but never override a new user scroll.
    const doc=host.ownerDocument;
    if(positions.length&&doc&&typeof requestAnimationFrame==='function'&&!pendingScrollFrames.has(doc)){
      const events=['wheel','touchmove','pointerdown','keydown'];let cancelled=false;
      const cancel=()=>{cancelled=true;};
      for(const type of events)doc.addEventListener(type,cancel,{passive:true,capture:true});
      pendingScrollFrames.set(doc,true);
      requestAnimationFrame(()=>{
        pendingScrollFrames.delete(doc);for(const type of events)doc.removeEventListener(type,cancel,true);
        if(!cancelled)for(const [node,top,left] of positions){node.scrollTop=top;node.scrollLeft=left;}
      });
    }
  }
}

function dateParts(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  if (!match) throw new RangeError('Choose a valid calendar date');
  const [year, month, day] = match.slice(1).map(Number);
  const value = new Date(0);
  value.setUTCHours(0, 0, 0, 0); value.setUTCFullYear(year, month - 1, day);
  if (year < 1 || value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) throw new RangeError('Choose a valid calendar date');
  return { year, month, day, value };
}

const dateText = date => `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
export function dateAt(time, timezone = 'UTC') {
  if (number(time) === null) throw new RangeError('Invalid timestamp');
  if (!dateFormatters.has(timezone)) dateFormatters.set(timezone, new Intl.DateTimeFormat('en-CA', { timeZone: timezone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' }));
  const parts = Object.fromEntries(dateFormatters.get(timezone).formatToParts(time).filter(p => ['year', 'month', 'day'].includes(p.type)).map(p => [p.type, p.value]));
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
}

function localDayStart(date, timezone) {
  const target = dateParts(date).value.getTime();
  // Search a local date boundary rather than assuming every day has 24 hours.
  // This also handles a timezone whose daylight-saving change skips midnight.
  let low = target - 36 * 3600000, high = target + 36 * 3600000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (dateAt(mid, timezone) < date) low = mid + 1; else high = mid;
  }
  if (dateAt(low, timezone) !== date) throw new RangeError('This local calendar date does not exist');
  return low;
}

export function shiftDate(date, period, amount) {
  if (!Number.isInteger(amount)) throw new RangeError('Calendar shifts need whole periods');
  const {year, month, day, value} = dateParts(date);
  if (period === 'day' || period === 'week') value.setUTCDate(day + amount * (period === 'week' ? 7 : 1));
  else if (period === 'month' || period === 'year') {
    const months = year * 12 + month - 1 + amount * (period === 'year' ? 12 : 1);
    const targetYear = Math.floor(months / 12), targetMonth = (months % 12 + 12) % 12;
    const last = new Date(0); last.setUTCFullYear(targetYear, targetMonth + 1, 0);
    value.setUTCFullYear(targetYear, targetMonth, Math.min(day, last.getUTCDate()));
  } else throw new RangeError('Unsupported calendar period');
  return dateText(value);
}

export function periodRange({period = 'day', date, timezone = 'UTC', now = Date.now(), firstTime = 0, weekStart = 1}) {
  if (number(now) === null) throw new RangeError('Invalid current time');
  date = date ?? dateAt(now, timezone);
  const parts = dateParts(date);
  if (period === 'lifetime') return {start: number(firstTime) !== null ? Math.min(firstTime, now) : 0, end: now};
  let first = date;
  if (period === 'week') {
    if (!Number.isInteger(weekStart) || weekStart < 0 || weekStart > 6) throw new RangeError('Week start must be a weekday from 0 to 6');
    first = shiftDate(date, 'day', -((parts.value.getUTCDay() - weekStart + 7) % 7));
  }
  else if (period === 'month') first = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-01`;
  else if (period === 'year') first = `${String(parts.year).padStart(4, '0')}-01-01`;
  else if (period !== 'day') throw new RangeError('Unsupported calendar period');
  return {start: localDayStart(first, timezone), end: localDayStart(shiftDate(first, period, 1), timezone)};
}

export function sunEvents({sunrise, sunset, period = 'day', date, timezone = 'UTC', now = Date.now(), locale} = {}) {
  if (period !== 'day' || number(now) === null) return [];
  try {
    if (date !== dateAt(now, timezone)) return [];
    const formatter = new Intl.DateTimeFormat(locale, {timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', numberingSystem: 'latn'});
    return [['sunrise', 'Sunrise', sunrise], ['sunset', 'Sunset', sunset]].flatMap(([key, label, stamp]) => {
      if (typeof stamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(stamp)) return [];
      try { dateParts(stamp.slice(0, 10)); } catch { return []; }
      const time = Date.parse(stamp);
      return Number.isFinite(time) && dateAt(time, timezone) === date ? [{key, label, stamp, time, clock: formatter.format(time)}] : [];
    });
  } catch { return []; }
}

export function normalizeSeries(input) {
  if (!Array.isArray(input)) return [];
  const used = new Set();
  return input.filter(s => s && typeof s === 'object').map((series, index) => {
    let unit = String(series.unit ?? ''), factor = 1;
    const units = { W:['kW', .001], kW:['kW', 1], MW:['kW', 1000], Wh:['kWh', .001], kWh:['kWh', 1], MWh:['kWh', 1000] };
    if (units[unit]) [unit, factor] = units[unit];
    else if (/^(?:c|ct|cent|cents|p)\/kWh$/.test(unit)) { unit = `${series.currency || 'currency'}/kWh`; factor = .01; }
    else if (/^(?:EUR|USD|GBP|€|\$|£)\/MWh$/.test(unit)) { unit = unit.replace('/MWh', '/kWh'); factor = .001; }
    const points = new Map();
    for (const point of Array.isArray(series.points) ? series.points : []) {
      if (!point || number(point.time) === null) continue;
      const raw = point.value;
      const value = typeof raw === 'number' ? number(raw) : typeof raw === 'string' && raw.trim() ? number(Number(raw)) : null;
      const scaled = value === null ? null : number(factor < 1 ? value / (1 / factor) : value * factor);
      points.set(point.time, {time: point.time, value: scaled});
    }
    const base = String(series.key ?? `series_${index}`);
    let key = base, duplicate = 2;
    while (used.has(key)) key = `${base}_${duplicate++}`;
    used.add(key);
    const forecast = series.forecast === true;
    const requestedDash = typeof series.dash === 'string' ? series.dash.trim() : '';
    const safeDash = requestedDash.length <= 40 && /^\d+(?:\.\d+)?(?:[ ,]+\d+(?:\.\d+)?)*$/.test(requestedDash)
      && requestedDash.split(/[ ,]+/).every(value => Number(value) <= 100)
      && requestedDash.split(/[ ,]+/).some(value => Number(value) > 0);
    const dash = safeDash ? requestedDash : forecast ? '6 5' : null;
    return {key, label: String(series.label ?? (forecast ? 'Forecast' : base)), color: /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(series.color ?? '') ? series.color : PALETTE[index % PALETTE.length], unit, points: [...points.values()].sort((a,b) => a.time - b.time), maxGapMs: number(series.maxGapMs) > 0 ? series.maxGapMs : null, forecast, dash};
  });
}

function cadence(points) {
  const steps = points.slice(1).map((point, i) => point.time - points[i].time).filter(value => value > 0).sort((a,b) => a-b);
  return steps.length ? steps[Math.floor((steps.length - 1) / 2)] : null;
}

export function nearestPoint(points, target, maxDistance = Infinity) {
  if (!Array.isArray(points) || !points.length || number(target) === null || !(maxDistance >= 0)) return null;
  let low = 0, high = points.length;
  while (low < high) { const mid = (low + high) >> 1; if (points[mid].time < target) low = mid + 1; else high = mid; }
  const candidates = [points[low - 1], points[low]].filter(Boolean);
  const result = candidates.sort((a,b) => Math.abs(a.time-target) - Math.abs(b.time-target) || a.time-b.time)[0];
  return result && Math.abs(result.time - target) <= maxDistance ? result : null;
}

export function gapPaths(points, {x = value => value, y = value => value, maxGapMs} = {}) {
  const limit = number(maxGapMs) > 0 ? maxGapMs : (cadence(points) ?? Infinity) * 1.8;
  const paths = []; let path = '', previous = null;
  const finish = () => { if (path) paths.push(path); path = ''; previous = null; };
  for (const point of points) {
    if (number(point?.time) === null || number(point?.value) === null) { finish(); continue; }
    const px = x(point.time), py = y(point.value);
    if (number(px) === null || number(py) === null) { finish(); continue; }
    if (previous !== null && point.time - previous > limit) finish();
    path += `${path ? ' L' : 'M'}${px.toFixed(2)},${py.toFixed(2)}`;
    previous = point.time;
  }
  finish(); return paths;
}

export function csvEscape(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = String(value ?? '');
  if (/^[\t\r\n ]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCSV(input, {start = -Infinity, end = Infinity} = {}) {
  const rows = normalizeSeries(input).flatMap((series, order) => series.points.filter(point => point.time >= start && point.time <= end).map(point => ({...point, label: series.label, unit: series.unit, order})));
  rows.sort((a,b) => a.time - b.time || a.order - b.order);
  return ['timestamp_utc,series,value,unit', ...rows.map(row => [new Date(row.time).toISOString(), row.label, row.value, row.unit].map(csvEscape).join(','))].join('\r\n');
}

export const CHART_STYLE = `
:host{display:block;min-width:0;color:var(--ink,#1e2b43);font-family:inherit}.chart{background:var(--surface,#fff);border:1px solid var(--line,#dce6ee);border-radius:24px;padding:18px;min-width:0;box-sizing:border-box}.heading,.controls,.legend,.table-controls{display:flex;align-items:center;gap:10px}.heading{justify-content:space-between;margin-bottom:16px}.compact .heading{justify-content:flex-end}.heading h2{font-size:17px;font-weight:600;margin:0;letter-spacing:.1px}.heading button{font-size:20px}.controls{flex-wrap:wrap;margin-bottom:12px}.date-controls{display:flex;flex:1;gap:6px;min-width:185px}.date-controls input{min-width:100px;flex:1}button,input,select{font:inherit;color:inherit;background:var(--surface,#f9fcff);border:1px solid var(--line,#dce6ee);border-radius:12px;box-sizing:border-box}button{cursor:pointer;padding:9px 12px;min-height:38px}button:disabled{opacity:.4;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,.plot:focus-visible{outline:2px solid #00b7c4;outline-offset:3px}input,select{padding:8px 10px;font-size:13px}select{min-width:112px}.legend{min-height:var(--sigen-chart-legend-height,0);align-content:start;flex-wrap:wrap;margin:0 0 7px}.legend button{display:flex;align-items:center;gap:7px;font-size:12px;min-height:32px;border-color:transparent;padding:5px 8px;background:transparent}.legend button[aria-pressed=false]{opacity:.4}.swatch{width:10px;height:10px;border-radius:50%;display:inline-block;box-shadow:0 0 0 4px var(--line,#e5edf6)}.plot{position:relative;min-width:0;border-radius:10px;touch-action:pan-y}.plot svg{width:100%;display:block;overflow:visible}.grid{stroke:var(--line,#dce6ee);stroke-dasharray:4 5;stroke-width:1}.axis{fill:var(--muted,#657a99);font-size:11px}.unit{fill:var(--ink,#1e2b43);font-size:12px}.trace{fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}.dot{stroke:var(--surface,#fff);stroke-width:1.5}.crosshair{stroke:var(--muted,#657a99);stroke-dasharray:3 4;stroke-width:1}.now-line{stroke:var(--muted,#657a99);stroke-dasharray:2 5;stroke-width:1;opacity:.4}[hidden]{display:none!important}.tooltip{position:absolute;top:5px;max-width:min(280px,85%);pointer-events:none;background:var(--sigen-chart-tooltip,#223247);color:var(--sigen-chart-tooltip-text,#fff);border-radius:12px;box-shadow:0 6px 20px #0002;padding:10px 12px;z-index:3;font-size:12px}.tooltip time{display:block;margin-bottom:6px;font-weight:600}.tooltip-row{display:flex;gap:14px;justify-content:space-between;line-height:1.8}.tooltip-row span:first-child{display:flex;align-items:center;gap:7px}.tooltip .swatch{width:7px;height:7px;box-shadow:none}.sun-events{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-top:12px;padding:12px 16px;border-radius:24px;background:var(--sigen-chart-sun-bg,var(--surface,#fff));color:var(--muted,#657a99);font-size:12px}.caption{font-size:11px;line-height:1.6;color:var(--muted,#657a99);margin:8px 0 0}.empty{min-height:190px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--muted,#657a99);gap:8px}.empty strong{color:var(--ink,#1e2b43);font-weight:500}.error{color:#bc4d4d}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.footer{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-top:13px}.footer details{min-width:0;flex:1}.footer summary{cursor:pointer;font-size:12px;color:var(--muted,#657a99);padding:9px 0}.download{font-size:12px;padding:6px 10px;min-height:32px}.table-wrap{overflow:auto;max-height:390px;margin-top:7px;border-radius:10px;border:1px solid var(--line,#dce6ee)}table{border-collapse:collapse;width:100%;font-size:11px;white-space:nowrap}th,td{padding:8px 10px;text-align:right;border-bottom:1px solid var(--line,#dce6ee)}th:first-child,td:first-child{text-align:left}th{position:sticky;top:0;background:var(--sigen-chart-table-header,#f2f6fa);color:var(--sigen-chart-table-ink,#1e2b43);font-weight:500}.table-controls{justify-content:space-between;font-size:11px;color:var(--muted,#657a99);margin-top:8px}.table-controls button{padding:5px 8px;font-size:11px;min-height:29px}dialog{max-width:none;width:min(1500px,calc(100vw - 36px));max-height:calc(100dvh - 36px);padding:0;background:var(--sigen-chart-dialog,#f4f8fc);color:inherit;border:1px solid var(--line,#dce6ee);border-radius:26px;overflow:auto}dialog::backdrop{background:#081422a8;backdrop-filter:blur(5px)}dialog .chart{border:0;min-height:min(80dvh,900px)}@media(pointer:coarse){button,input,select,.legend button,.download,.table-controls button,.footer summary{min-height:44px}.legend button{font-size:12px}}@media(max-width:450px){.chart{padding:12px;border-radius:20px}.heading h2{font-size:15px}.controls{gap:7px}.date-controls{min-width:170px}.legend button{font-size:11px;padding:5px}.caption{font-size:10px}.tooltip{font-size:11px}dialog{width:calc(100vw - 16px);max-height:calc(100dvh - 16px)}}

:host{color-scheme:var(--sigen-chart-color-scheme,normal)}.controls input,.controls select{background:var(--sigen-chart-control-bg,var(--surface,#edf4fa));color:var(--sigen-chart-control-fg,var(--ink,#1e2b43))}.controls select option{background:var(--sigen-chart-control-bg,#edf4fa);color:var(--sigen-chart-control-fg,#1e2b43)}
`;

const BaseElement = globalThis.HTMLElement ?? class {};
export class SigenHistoryChart extends BaseElement {
  constructor() {
    super(); this.attachShadow?.({mode:'open'}); this._visible = new Set(); this._data = null; this._version = 0; this._tablePage = 0;
  }
  connectedCallback() {
    this._active = true;
    this._mount();
    if (typeof ResizeObserver !== 'undefined' && !this._resize) {
      this._resize = new ResizeObserver(() => { const width = Math.round(this.clientWidth); if (width && width !== this._lastWidth) { this._lastWidth = width; this._render(); } });
      this._resize.observe(this);
    }
    this._render(); this._autoLoad();
  }
  disconnectedCallback() { this._active=false;this._resize?.disconnect();this._resize=null;queueMicrotask(()=>{if(!this._active){this._version++;this._loading=false;this._pendingLoad=false;}}); }
  set data(next) {
    if (!next || typeof next !== 'object') return;
    const previousSelection=this._selectionKey(),loaded=this._data?.series,visibility=new Set(this._visible);
    const previous = new Set(this._data?.series.map(series => series.key) ?? []);
    this._data = {...next, series: normalizeSeries(next.series)};
    this._data.series.forEach(series => { if (!previous.has(series.key)) this._visible.add(series.key); });
    this._visible = new Set([...this._visible].filter(key => this._data.series.some(series => series.key === key)));
    this._period = next.period ?? this._period ?? 'day';
    this._weekStart = next.weekStart ?? this._weekStart ?? 1;
    this._timezone = next.timezone || this._timezone || 'UTC';
    this._now = number(next.now) ?? Date.now();
    try {
      dateAt(this._now,this._timezone);
      if(!['day','week','month','year','lifetime'].includes(this._period))throw new RangeError('Unsupported period');
      this._date = next.date ?? this._date ?? dateAt(this._now, this._timezone);
      this._range = number(next.start) !== null && number(next.end) !== null && next.end > next.start ? {start:next.start, end:next.end} : periodRange({period:this._period,date:this._date,timezone:this._timezone,now:this._now,weekStart:this._weekStart});
      this._error = '';
    } catch { this._error = 'The selected date or timezone is invalid.'; this._timezone='UTC';this._period='day';this._date=dateAt(this._now,'UTC');this._range = {start:this._now-DAY,end:this._now}; }
    const sameSelection=previousSelection===this._selectionKey();
    if(sameSelection&&next.loadKey&&(this._historyLoaded||this._pendingLoad)&&loaded){this._data.series=loaded;this._visible=new Set(loaded.filter(series=>visibility.has(series.key)||!previous.has(series.key)).map(series=>series.key));}
    if(!sameSelection){this._version++;this._loading=false;this._pendingLoad=false;this._historyLoaded=false;this._loadedAt=0;}
    this._hoverTime = null; this._render(); this._autoLoad();
  }
  get data() { return this._data ? {...this._data, period:this._period,date:this._date,timezone:this._timezone,weekStart:this._weekStart,...this._range} : null; }
  _selectionKey(){return JSON.stringify([this._data?.loadKey??this._data?.title,this._period,this._date,this._timezone,this._weekStart]);}
  _autoLoad(){
    if(!this._active||typeof this._data?.load!=='function'||this._pendingLoad||Date.now()-(this._loadedAt??0)<60000||this._autoQueued)return;
    this._autoQueued=true;queueMicrotask(()=>{this._autoQueued=false;if(this._active&&!this._pendingLoad&&typeof this._data?.load==='function'&&Date.now()-(this._loadedAt??0)>=60000)this._change(this._period,this._date);});
  }
  _mount() {
    if (!this.shadowRoot || this.shadowRoot.querySelector('.main')) return;
    this.shadowRoot.innerHTML = `<style>${CHART_STYLE}</style><div class="main"></div><dialog aria-label="Expanded history chart"><div class="modal-body"></div></dialog>`;
    const dialog = this.shadowRoot.querySelector('dialog');
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
  }
  _dialogTheme(dialog) {
    if(typeof getComputedStyle!=='function')return;
    const style=getComputedStyle(this),specified=style.getPropertyValue('--sigen-chart-dialog').trim();
    const channels=style.color.match(/[\d.]+/g)?.slice(0,3).map(Number)??[];
    const dark=channels.length===3&&(channels[0]*.2126+channels[1]*.7152+channels[2]*.0722)>155;
    dialog.style.backgroundColor=specified||(dark?'#1b2837':'#f4f8fc');
  }
  _selected() { return (this._data?.series ?? []).filter(series => this._visible.has(series.key)); }
  _times() { return [...new Set(this._selected().flatMap(series => series.points.filter(point => point.time >= this._range.start && point.time <= this._range.end).map(point => point.time)))].sort((a,b) => a-b); }
  _formatTime(time, detailed = false) {
    try { return new Intl.DateTimeFormat(undefined, {timeZone:this._timezone, ...(detailed ? {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset'} : this._period === 'day' ? {hour:'2-digit',minute:'2-digit',hourCycle:'h23'} : this._period === 'week' ? {weekday:'short',month:'short',day:'numeric'} : this._period === 'month' ? {month:'short',day:'numeric'} : {year:'numeric',month:'short'})}).format(time); } catch { return new Date(time).toISOString(); }
  }
  _formatValue(value) { return number(value) === null ? 'Unavailable' : new Intl.NumberFormat(undefined,{maximumFractionDigits:3}).format(value); }
  _template(expanded) {
    const title = this._data?.title || 'Recorded history', selected = this._selected();
    const compact = this._data?.compact === true && !expanded;
    const maxTime = number(this._data?.maxFuture) ?? this._now;
    let nextDisabled = this._period === 'lifetime';
    try { if (!nextDisabled) nextDisabled = periodRange({period:this._period,date:shiftDate(this._date,this._period,1),timezone:this._timezone,now:this._now,weekStart:this._weekStart}).start > maxTime; } catch { nextDisabled = true; }
    const body = this._plot(expanded);
    const events = sunEvents({...this._data, period:this._period, date:this._date, timezone:this._timezone, now:this._now});
    const sun = events.length ? `<div class="sun-events">${events.map(event => `<span>${event.label} <time datetime="${escape(event.stamp)}">${escape(event.clock)}</time></span>`).join('')}</div>` : '';
    return `<section class="chart${compact ? ' compact' : ''}" aria-label="${escape(title)}" aria-busy="${Boolean(this._loading)}"><div class="heading"><h2${compact ? ' class="sr-only"' : ''}>${escape(title)}</h2><button class="expand" type="button" aria-label="${expanded?'Close expanded chart':'Expand chart'}" title="${expanded?'Close':'Expand'}">${expanded?'×':'⤢'}</button></div><div class="controls" ${this._data?.hideControls&&!expanded?'hidden':''}><div class="date-controls"><button type="button" class="previous" aria-label="Previous ${escape(this._period)}" ${this._period==='lifetime'?'disabled':''}>‹</button><input class="date" type="date" aria-label="Chart date" value="${escape(this._date)}" max="${escape(dateAt(maxTime,this._timezone))}" ${this._period==='lifetime'?'disabled':''}><button type="button" class="next" aria-label="Next ${escape(this._period)}" ${nextDisabled?'disabled':''}>›</button></div><select class="period" aria-label="Chart period">${[['day','Day'],['week','Week'],['month','Month'],['year','Year'],['lifetime','Lifetime']].map(([value,label])=>`<option value="${value}" ${this._period===value?'selected':''}>${label}</option>`).join('')}</select></div><div class="legend" aria-label="Chart series">${(this._data?.series??[]).map((series,i)=>`<button type="button" data-series="${i}" aria-pressed="${this._visible.has(series.key)}"><span class="swatch" style="background:${series.color}"></span>${escape(series.label)}</button>`).join('')}</div>${this._error?`<p class="caption error" role="alert">${escape(this._error)}</p>`:''}${this._loading?'<p class="caption" role="status">Loading…</p>':''}${body}${sun}<p class="caption">${escape(this._timezone)} · ${escape({day:'Day',week:'Week',month:'Month',year:'Year',lifetime:'Lifetime'}[this._period])}</p><output class="sr-only" aria-live="polite"></output><div class="footer"><details class="data-details"><summary>View recorded values as a table</summary><div class="table-content"></div></details><button type="button" class="download" ${!selected.some(s=>s.points.length)?'disabled':''}>Download CSV</button></div></section>`;
  }
  _plot(expanded) {
    const selected = this._selected(), values = selected.flatMap(series => series.points.filter(point => point.time >= this._range.start && point.time <= this._range.end && point.value !== null));
    if (!values.length) return `<div class="empty"><strong>${this._data?.series?.length&&!selected.length?'Select a series':/forecast/i.test(this._data?.title||'')?'No forecast data for this period':'No history for this period'}</strong></div>`;
    const width = Math.max(280, Math.round(expanded ? Math.min(1460, (globalThis.innerWidth || this.clientWidth || 800)-76) : (this.clientWidth || 760)-38));
    const left = width < 420 ? 46 : 58, right = 18, top = 25;
    const units = [...new Set(selected.map(series => series.unit))];
    const compactUnits=!expanded&&units.length>1,paneHeight=expanded?255:185/units.length;
    const height = top + units.length * paneHeight + 24;
    const x = time => left + (time - this._range.start) / Math.max(1,this._range.end-this._range.start) * (width-left-right);
    const geometry = {width,height,left,right,top,paneHeight,x,groups:[]};
    let svg = '';
    units.forEach((unit,index) => {
      const series = selected.filter(item => item.unit === unit), startY = top + index*paneHeight, bottom = startY+paneHeight-(compactUnits?12:30);
      const samples = series.flatMap(item => item.points.filter(p=>p.time>=this._range.start&&p.time<=this._range.end&&p.value!==null).map(p=>p.value));
      let min = samples.length ? samples.reduce((value,sample)=>Math.min(value,sample),Infinity) : 0, max = samples.length ? samples.reduce((value,sample)=>Math.max(value,sample),-Infinity) : 1;
      if (unit === '%') { min=Math.min(0,min); max=Math.max(100,max); }
      else { min=Math.min(0,min); max=Math.max(0,max); const pad=(max-min)*.08||Math.max(Math.abs(max)*.1,.1); min-=min<0?pad:0; max+=pad; }
      const y = value => bottom - (value-min)/Math.max(.000001,max-min)*(paneHeight-(compactUnits?25:48));
      geometry.groups.push({unit,series,y,top:startY,bottom});
      svg += `<text class="unit" x="${left}" y="${startY-7}">${escape(unit || 'Value')}</text>`;
      const ticks=compactUnits?2:4;
      for(let tick=0;tick<ticks;tick++){const value=min+(max-min)*tick/(ticks-1),py=y(value);svg+=`<line class="grid" x1="${left}" x2="${width-right}" y1="${py}" y2="${py}"/><text class="axis" text-anchor="end" x="${left-8}" y="${py+4}">${escape(new Intl.NumberFormat(undefined,{maximumFractionDigits:Math.abs(max-min)<1?3:1}).format(value))}</text>`;}
      const bar=this._data?.chartType==='bar',stamps=[...new Set(series.flatMap(item=>item.points.map(point=>point.time)))].sort((a,b)=>a-b),slot=Math.min(100,(width-left-right)/Math.max(1,stamps.length)*.8),barWidth=Math.max(1,slot/Math.max(1,series.length));
      for(const [order,item] of series.entries()){
        const points=item.points.filter(p=>p.time>=this._range.start&&p.time<=this._range.end);
        if(bar)svg+=points.filter(p=>p.value!==null).map(p=>{const center=Math.max(left+slot/2,Math.min(width-right-slot/2,x(p.time))),topY=Math.min(y(0),y(p.value));return `<rect class="bar" data-series-key="${escape(item.key)}" fill="${item.color}" x="${center-slot/2+order*barWidth}" y="${topY}" width="${barWidth*.9}" height="${Math.max(.6,Math.abs(y(p.value)-y(0)))}" rx="2"/>`;}).join('');
        else{svg+=gapPaths(points,{x,y,maxGapMs:item.maxGapMs}).map(path=>`<path class="trace" stroke="${item.color}"${item.dash ? ` stroke-dasharray="${escape(item.dash)}"` : ''} d="${path}"/>`).join('');svg+=points.filter(p=>p.value!==null).map(p=>`<circle class="dot" fill="${item.color}" cx="${x(p.time)}" cy="${y(p.value)}" r="1.5"/>`).join('');}
        svg+=`<circle class="hover-dot" data-marker="${escape(item.key)}" fill="${item.color}" stroke="var(--surface,#fff)" stroke-width="2" r="4" hidden/>`;
      }
    });
    const count = width < 450 ? 3 : width < 800 ? 5 : 7;
    for(let i=0;i<count;i++){const time=this._range.start+(this._range.end-this._range.start)*i/(count-1);svg+=`<text class="axis" x="${x(time)}" y="${height-4}" text-anchor="${i===0?'start':i===count-1?'end':'middle'}">${escape(this._formatTime(time))}</text>`;}
    if(this._now>this._range.start&&this._now<this._range.end)svg+=`<line class="now-line" x1="${x(this._now)}" x2="${x(this._now)}" y1="${top-5}" y2="${height-34}"/>`;
    this._geometries ??= new Map(); this._geometries.set(expanded,geometry);
    return `<div class="plot" tabindex="0" role="group" aria-label="${escape(this._data?.title||'Recorded history')}. Use left and right arrows to inspect recorded values."><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Recorded values, with separate scales for ${escape(units.join(', '))}">${svg}<line class="crosshair" x1="0" x2="0" y1="${top-5}" y2="${height-34}" hidden/></svg><div class="tooltip" hidden></div></div>`;
  }
  _render() {
    return preserveChartScroll(this,()=>this._renderContent());
  }
  _renderContent() {
    if (!this._data || !this.shadowRoot) return;
    this._mount(); const main = this.shadowRoot.querySelector('.main'); if (!main) return;
    const tableOpen=main.querySelector('.data-details')?.open;
    main.innerHTML = this._template(false); this._bind(main,false);
    if(tableOpen){main.querySelector('.data-details').open=true;this._table(main);}
    const dialog = this.shadowRoot.querySelector('dialog');
    if(dialog?.open){this._dialogTheme(dialog);const body=dialog.querySelector('.modal-body'),open=body.querySelector('.data-details')?.open;body.innerHTML=this._template(true);this._bind(body,true);if(open){body.querySelector('.data-details').open=true;this._table(body);}}
  }
  _bind(root,expanded) {
    root.querySelector('.expand').addEventListener('click',()=>{
      const dialog=this.shadowRoot.querySelector('dialog');
      if(expanded){dialog.close();return;}
      this._dialogTheme(dialog);const body=dialog.querySelector('.modal-body');body.innerHTML=this._template(true);this._bind(body,true);dialog.showModal();
    });
    root.querySelector('.previous').addEventListener('click',()=>this._change(this._period,shiftDate(this._date,this._period,-1),true));
    root.querySelector('.next').addEventListener('click',()=>this._change(this._period,shiftDate(this._date,this._period,1),true));
    root.querySelector('.date').addEventListener('change',event=>{if(event.target.value)this._change(this._period,event.target.value,true);});
    root.querySelector('.period').addEventListener('change',event=>this._change(event.target.value,this._date,true));
    root.querySelectorAll('[data-series]').forEach(button=>button.addEventListener('click',()=>{const series=this._data.series[Number(button.dataset.series)];if(this._visible.has(series.key))this._visible.delete(series.key);else this._visible.add(series.key);this._tablePage=0;this._render();}));
    const plot=root.querySelector('.plot');
    if(plot){
      const pick=event=>{const r=plot.getBoundingClientRect(),g=this._geometries.get(expanded),px=(event.clientX-r.left)/Math.max(1,r.width)*g.width;const time=this._range.start+Math.max(0,Math.min(1,(px-g.left)/(g.width-g.left-g.right)))*(this._range.end-this._range.start);this._hover(time,root,expanded,event.type==='pointerdown');};
      plot.addEventListener('pointermove',pick);plot.addEventListener('pointerdown',pick);
      plot.addEventListener('pointerleave',event=>{if(event.pointerType!=='touch')this._clearHover(root);});
      plot.addEventListener('keydown',event=>{
        if(event.key==='Escape'){this._clearHover(root);return;}
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();const times=this._times();if(!times.length)return;
        let index=times.indexOf(this._hoverTime);if(index<0)index=event.key==='ArrowLeft'?times.length: -1;
        index=event.key==='Home'?0:event.key==='End'?times.length-1:Math.max(0,Math.min(times.length-1,index+(event.key==='ArrowLeft'?-1:1)));
        this._hover(times[index],root,expanded,true);
      });
    }
    root.querySelector('.download').addEventListener('click',()=>{
      const csv=toCSV(this._selected(),this._range),blob=new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=`sigenergy-${this._period}-${this._date}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    root.querySelector('.data-details').addEventListener('toggle',event=>{if(event.target.open)this._table(root);});
  }
  _acceptHistory(response,period) {
    const supplied=Array.isArray(response)?response:response?.series;
    if(!Array.isArray(supplied))throw new Error('No series returned');
    const previous=new Set(this._data.series.map(series=>series.key));this._data.series=normalizeSeries(supplied);
    this._data.chartType=!Array.isArray(response)&&response.chartType==='bar'?'bar':'line';
    this._data.source=Array.isArray(response)?'local_recorder':response.source;
    this._historyLoaded=true;this._loadedAt=Date.now();
    this._data.series.forEach(series=>{if(!previous.has(series.key))this._visible.add(series.key);});
    if(!Array.isArray(response)&&number(response.start)!==null&&number(response.end)!==null&&response.end>response.start)this._range={start:response.start,end:response.end};
    else if(period==='lifetime'){const times=this._data.series.flatMap(series=>series.points.filter(p=>p.value!==null).map(p=>p.time));if(times.length)this._range={start:times.reduce((a,b)=>Math.min(a,b),Infinity),end:times.reduce((a,b)=>Math.max(a,b),this._now)};}
  }
  async _change(period,date,notify=false) {
    let range;
    try {range=periodRange({period,date,timezone:this._timezone,now:this._now,firstTime:number(this._data?.lifetimeStart)??0,weekStart:this._weekStart});}
    catch {this._error='Choose a valid date and period.';this._render();return;}
    const maxTime=number(this._data?.maxFuture)??this._now;
    if(range.start>maxTime){this._error='No data for this date.';this._render();return;}
    this._period=period;this._date=date;this._range=range;this._tablePage=0;this._hoverTime=null;this._error='';
    if(notify&&typeof this.dispatchEvent==='function'&&typeof CustomEvent==='function')this.dispatchEvent(new CustomEvent('sigen-chart-range-change',{detail:{period,date},bubbles:true,composed:true}));
    if(typeof this._data.load!=='function'){this._render();return;}
    const version=++this._version;this._pendingLoad=true;this._loading=true;this._render();let partial=false;
    try{
      const response=await this._data.load({...range,period,date,timezone:this._timezone,weekStart:this._weekStart,onUpdate:response=>{
        if(version!==this._version)return;
        const supplied=Array.isArray(response)?response:response?.series;
        if(!supplied?.some(line=>line.points?.some(point=>Number.isFinite(point.value))))return;
        this._acceptHistory(response,period);partial=true;this._loading=false;this._render();
      }});
      if(version!==this._version)return;
      this._acceptHistory(response,period);
    }catch{if(version===this._version){if(!partial){this._data.series=[];this._error='Unable to load this period. Try again.';}this._loadedAt=Date.now();}}
    finally{if(version===this._version){this._loading=false;this._pendingLoad=false;this._render();}}
  }
  _hover(target,root,expanded,announce) {
    const times=this._times(),nearest=nearestPoint(times.map(time=>({time})),target);if(!nearest)return;
    const time=nearest.time,g=this._geometries.get(expanded),px=g.x(time),tooltip=root.querySelector('.tooltip');this._hoverTime=time;
    const rows=[];const spoken=[];
    for(const group of g.groups){for(const series of group.series){const maxDistance=(cadence(series.points)??0)*.6;const point=nearestPoint(series.points,time,maxDistance||0),value=point?.value??null;const marker=[...root.querySelectorAll('[data-marker]')].find(el=>el.dataset.marker===series.key);if(marker){marker.toggleAttribute('hidden',value===null);if(value!==null){marker.setAttribute('cx',g.x(point.time));marker.setAttribute('cy',group.y(value));}}rows.push(`<div class="tooltip-row"><span><i class="swatch" style="background:${series.color}"></i>${escape(series.label)}</span><span>${escape(this._formatValue(value))}${value===null?'':' '+escape(series.unit)}</span></div>`);spoken.push(`${series.label}: ${this._formatValue(value)} ${value===null?'':series.unit}`);}}
    const line=root.querySelector('.crosshair');line.removeAttribute('hidden');line.setAttribute('x1',px);line.setAttribute('x2',px);
    tooltip.innerHTML=`<time>${escape(this._formatTime(time,true))}</time>${rows.join('')}`;tooltip.hidden=false;tooltip.style.left=px/g.width>.58?'auto':`${Math.min(70,px/g.width*100+2)}%`;tooltip.style.right=px/g.width>.58?`${Math.max(0,100-px/g.width*100+2)}%`:'auto';
    if(announce)root.querySelector('output').textContent=`${this._formatTime(time,true)}. ${spoken.join('. ')}`;
  }
  _clearHover(root){root.querySelectorAll('.crosshair,.tooltip,.hover-dot').forEach(el=>{el.setAttribute('hidden','');});}
  _table(root) {
    const selected=this._selected(),times=this._times(),size=100,last=Math.max(0,Math.ceil(times.length/size)-1);this._tablePage=Math.min(last,this._tablePage);const from=this._tablePage*size,shown=times.slice(from,from+size),container=root.querySelector('.table-content');
    const lookup=selected.map(series=>new Map(series.points.map(point=>[point.time,point.value])));
    container.innerHTML=`<div class="table-wrap"><table><caption class="sr-only">Recorded values in ${escape(this._timezone)}. Missing values remain unavailable.</caption><thead><tr><th scope="col">Time</th>${selected.map(series=>`<th scope="col">${escape(series.label)}${series.unit?' ('+escape(series.unit)+')':''}</th>`).join('')}</tr></thead><tbody>${shown.map(time=>`<tr><th scope="row">${escape(this._formatTime(time,true))}</th>${lookup.map(points=>`<td>${escape(this._formatValue(points.get(time)))}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${selected.length+1}">No recorded values for this period.</td></tr>`}</tbody></table></div><div class="table-controls"><button class="table-prev" ${this._tablePage===0?'disabled':''}>Previous rows</button><span>${times.length?`${from+1}–${Math.min(from+size,times.length)} of ${times.length}`:'0 rows'}</span><button class="table-next" ${this._tablePage>=last?'disabled':''}>Next rows</button></div>`;
    container.querySelector('.table-prev').addEventListener('click',()=>{this._tablePage--;this._table(root);});container.querySelector('.table-next').addEventListener('click',()=>{this._tablePage++;this._table(root);});
  }
}

if(globalThis.customElements&&!globalThis.customElements.get('sigen-history-chart'))globalThis.customElements.define('sigen-history-chart',SigenHistoryChart);
