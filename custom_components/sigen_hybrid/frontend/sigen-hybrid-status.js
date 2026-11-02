/* Report device connection and temporary control independently of power. */
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function chargerStatus(ctx,kind){
  let raw;try{raw=ctx.state?.(`${kind}_state`);}catch{}
  const value=String(raw&&typeof raw==='object'?raw.state:raw??'').trim().toLowerCase().replaceAll('_',' ');
  const common={'not connected':'Not connected','not plugged-in':'Not connected',charging:'Charging',discharging:'Discharging',fault:'Fault',error:'Fault',alarm:'Fault',unavailable:'Unavailable',initializing:'Initializing'};
  const states=kind==='ac'?{reserving:'Connected · waiting',preparing:'Connected · preparing','ev ready':'Connected · ready'}:{idle:'Not connected',occupied:'Connected · waiting','preparing comm':'Connected · preparing','preparing insulation':'Connected · preparing',scheduled:'Connected · scheduled',ended:'Connected · finished'};
  return Object.hasOwn(common,value)?common[value]:Object.hasOwn(states,value)?states[value]:value&&!['unknown','none'].includes(value)?String(raw&&typeof raw==='object'?raw.state:raw):'Unknown';
}
export function overrideModel(operation={},now=Date.now()){
  const mode=operation.mode==='discharge'&&operation.export_requested?'battery_export':operation.mode;
  const labels={charge:'Charge battery',discharge:'Discharge to Home',battery_export:'Discharge to Grid',hold:'Hold battery',self_consumption:'Self-consumption'},label=Object.hasOwn(labels,mode)?labels[mode]:null;
  if(!label||['idle','restored','superseded','committed'].includes(operation.phase))return null;
  const expires=Date.parse(operation.expires_at),requested=Date.parse(operation.requested_at),elapsed=Number.isFinite(requested)?Math.max(0,Math.floor((now-requested)/1000)):null;
  const active=operation.phase==='confirmed'&&Number.isFinite(expires)&&expires>now;
  const status=active?`${Math.ceil((expires-now)/60000)} min remaining${operation.power_check==='not_settled'?' · Check battery power':operation.power_check==='awaiting_reading'?' · Awaiting reading':''}`:operation.phase==='confirmed'?'Ending override…':operation.phase==='cancelling'?'Releasing…':operation.phase==='queued'?`${operation.stage==='applying'?'Applying':'Checking'}…${elapsed===null?'':` ${elapsed}s`}`:operation.phase==='recovery_pending'?'Checking previous override…':'Needs attention';
  return {mode,label,status,active,phase:operation.phase,cancellable:operation.submitted!==false&&!['failed','cancelling'].includes(operation.phase)};
}
export function renderOverride(operation,now){
  const model=overrideModel(operation,now);if(!model)return '';
  return `<span class="override-label" role="status">${escape(model.label)} · ${escape(model.status)}</span>${model.cancellable?'<button type="button" data-override-cancel>Cancel override</button>':''}`;
}
export const STATUS_STYLE=`.manual-override{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;min-width:0;font-size:12px;color:var(--ink)}.manual-override:empty{display:none}.manual-override button{font:inherit;color:inherit;border:1px solid var(--line);background:var(--surface);border-radius:12px;padding:6px 10px;min-height:36px}.battery-control-buttons button.is-active{border-color:#26c9c8!important;box-shadow:inset 0 0 0 1px #26c9c8}.override-label{overflow-wrap:anywhere}@media(max-width:600px){.instant-manual-panel>.section-title{align-items:flex-start;flex-wrap:wrap}.manual-override{justify-content:flex-start;font-size:12px}}`;
