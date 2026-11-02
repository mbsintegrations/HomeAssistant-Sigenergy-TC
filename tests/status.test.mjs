import test from 'node:test';
import assert from 'node:assert/strict';
import {chargerStatus,overrideModel,renderOverride} from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-status.js';
import {renderPhotoScene} from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-photo.js';
import {renderHouseScene} from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-house.js';
import {renderMobilePower} from '../custom_components/sigen_hybrid/frontend/sigen-hybrid-overview.js';

const ctx=(ac,dc)=>({has:key=>['ac_power','dc_power','ac_state','dc_state'].includes(key),state:key=>key==='ac_state'?{state:ac}:key==='dc_state'?{state:dc}:undefined,value:()=>0});
test('a plugged-in waiting AC vehicle remains connected at zero power',()=>{
 const context=ctx('Reserving','Idle');assert.equal(chargerStatus(context,'ac'),'Connected · waiting');assert.equal(chargerStatus(context,'dc'),'Not connected');
 for(const render of [renderPhotoScene,renderHouseScene,renderMobilePower]){const html=render(context);assert.match(html,/Connected · waiting/);assert.match(html,/Not connected/);}
});
test('both kinds retain unknown, fault and connected preparation without power inference',()=>{
 assert.equal(chargerStatus(ctx('unknown','unavailable'),'ac'),'Unknown');
 assert.equal(chargerStatus(ctx('Fault','Discharging'),'ac'),'Fault');
 assert.equal(chargerStatus(ctx('Fault','Discharging'),'dc'),'Discharging');
 assert.equal(chargerStatus(ctx('EV Ready','Occupied'),'ac'),'Connected · ready');
 assert.equal(chargerStatus(ctx('Preparing','Scheduled'),'dc'),'Connected · scheduled');
});
const now=Date.parse('2026-11-02T01:00:00Z');
const active={mode:'hold',phase:'confirmed',requested_at:'2026-11-02T00:59:00Z',expires_at:'2026-11-02T02:00:00Z'};
test('active hold survives a new UI instance and counts down from authoritative expiry',()=>{
 assert.equal(overrideModel({...active},now).status,'60 min remaining');
 assert.equal(overrideModel({...active},now+61000).status,'59 min remaining');
 assert.match(renderOverride(active,now),/Hold battery/);assert.match(renderOverride(active,now),/data-override-cancel/);
});
test('queued and restart checks are never displayed as active',()=>{
 const pending=overrideModel({...active,phase:'queued',stage:'applying'},now);assert.equal(pending.active,false);assert.equal(pending.status,'Applying… 60s');
 const restart=overrideModel({...active,phase:'recovery_pending'},now);assert.equal(restart.active,false);assert.match(restart.status,/Checking previous/);
 assert.match(overrideModel({...active,power_check:'awaiting_reading'},now).status,/Awaiting reading/);
 assert.match(overrideModel({...active,power_check:'not_settled'},now).status,/Check battery power/);
});
test('expiry waits for actual release and owner restoration clears the override',()=>{
 assert.equal(overrideModel(active,now+3600000).status,'Ending override…');
 assert.equal(overrideModel({...active,phase:'cancelling'},now).cancellable,false);
 assert.equal(overrideModel({...active,phase:'restored'},now),null);
 assert.equal(overrideModel({...active,phase:'superseded'},now),null);
 assert.equal(overrideModel({...active,mode:'constructor'},now),null);
 assert.equal(overrideModel({...active,mode:'discharge',export_requested:true},now).label,'Discharge to Grid');
});
