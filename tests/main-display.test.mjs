import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.HTMLElement = class { attachShadow() { this.shadowRoot = { innerHTML: '', querySelectorAll: () => [] }; } };
globalThis.window = {};
globalThis.customElements = { get: () => undefined, define: () => {} };
const {SigenHybridCard, MAIN_DISPLAYS} = await import('../custom_components/sigen_hybrid/frontend/sigen-hybrid-card.js');

test('Photo house is the default and all displays are selected through settings with no dashboard picker', () => {
  const card = new SigenHybridCard(); card.setConfig({show_display_picker:true});
  card._house = () => 'ORIGINAL'; card._flow = () => 'SIMPLE'; card._photo = () => 'PHOTO';
  assert.deepEqual(Object.keys(MAIN_DISPLAYS), ['house', 'flow', 'photo']);
  assert.equal(card._mainDisplay, 'photo');
  for (const [value, content] of [['house','ORIGINAL'], ['flow','SIMPLE'], ['photo','PHOTO']]) {
    card.setConfig({main_display:value,show_display_picker:true});
    assert.equal(card._sceneContent(), content);
    assert.equal(card._sceneSwitcher(),'');
  }
  assert.ok(!SigenHybridCard.getConfigForm().schema.some(field=>field.name==='show_display_picker'));
});

test('a regular dashboard renders only its settings-selected display and no testing picker', () => {
  const card = new SigenHybridCard(); card.setConfig({main_display:'photo'});
  const calls=[]; card._house=()=>{calls.push('house');return 'ORIGINAL';}; card._flow=()=>{calls.push('flow');return 'SIMPLE';};card._photo=()=>{calls.push('photo');return 'PHOTO';};
  assert.equal(card._sceneSwitcher(),''); assert.equal(card._sceneContent(),'PHOTO'); assert.deepEqual(calls,['photo']);
});

test('house status badges fit their own escaped text instead of a fixed-width rectangle', () => {
  const card = new SigenHybridCard(); card.setConfig({entities:{ac_power:'sensor.ac',ac_state:'sensor.ac_state',grid_power:'sensor.grid',grid_status:'sensor.status'}});
  card._hass={states:{'sensor.ac_state':{state:'Connection unknown <long>'},'sensor.status':{state:'Normal | On Grid'}}};
  const html=card._house();
  assert.ok(html.includes('class="house-ac-status">Connection unknown &lt;long&gt;</span>'));
  assert.ok(html.includes('class="house-reading-status">Unavailable</span>'));
  assert.ok(!html.includes('width="157" height="29"'));
  assert.ok(!html.includes('<long>'));
});

test('compact overview keeps controls below the scene and places mode and strategy links beneath sidebar battery level', () => {
  const card = new SigenHybridCard();card.setConfig({main_display:'flow',devices:[{id:'ac-one',type:'ac'}]});
  const html=card._overviewFrame();
  assert.ok(html.includes('<aside class="overview-sidebar"'));
  assert.ok(html.includes('Instant manual control'));
  assert.equal((html.match(/class="overview-energy-metric"/g)??[]).length,6);
  assert.ok(html.includes('Battery level'));
  assert.ok(html.indexOf('Solar forecast') < html.indexOf("Today's energy"));
  const main=html.slice(0,html.indexOf('<aside'));
  const aside=html.slice(html.indexOf('<aside'));
  assert.match(html,/overview-aligned-controls/);
  assert.match(aside,/class="overview-summary-stack"/);
  assert.doesNotMatch(html,/<h2>Home energy<\/h2>|Current Battery Level/);
  assert.ok(main.indexOf('main-display-stage') < main.indexOf('Instant manual control'));
  assert.doesNotMatch(main,/overview-device-links|data-overview-mode|My Energy Profile|Personal Strategies/);
  assert.doesNotMatch(aside,/Instant manual control|Start AC charger charging/);
  assert.match(aside,/Solar forecast[\s\S]*Today's energy[\s\S]*Battery level[\s\S]*overview-device-links[\s\S]*data-overview-mode[\s\S]*My Energy Profile[\s\S]*Personal Strategies/);
  assert.equal((html.match(/data-overview-mode/g)??[]).length,1);
  assert.equal((html.match(/data-detail="energy_profile"/g)??[]).length,1);
  assert.equal((html.match(/data-detail="strategies"/g)??[]).length,1);
  assert.match(main,/Start AC charger charging/);
  assert.doesNotMatch(main,/Start DC charger charging/);
  assert.ok(!html.includes('soc-ring'));
  assert.ok(!html.includes('portal-scene'));
  assert.ok(!html.includes('sigen-photo-scene'));
  const hidden=card._overviewFrame(['today']);
  assert.ok(!hidden.includes('Instant manual control'));
  assert.ok(!hidden.includes('Battery level'));
  assert.doesNotMatch(hidden,/overview-device-links|data-overview-mode|My Energy Profile|Personal Strategies/);
  const batteryOnly=card._overviewFrame(['current_mode_battery']);
  assert.doesNotMatch(batteryOnly,/Instant manual control|Solar forecast|Today's energy/);
  assert.match(batteryOnly,/<aside[^>]*>[\s\S]*Battery level[\s\S]*data-overview-mode[\s\S]*My Energy Profile[\s\S]*Personal Strategies[\s\S]*<\/aside>/);
});

test('every overview display shares the revised layout while hidden modules stay hidden',()=>{
  const card=new SigenHybridCard();
  for(const display of Object.keys(MAIN_DISPLAYS)){
    card.setConfig({main_display:display});
    const html=card._overviewFrame(['manual_controls']);
    assert.match(html,new RegExp(`data-display="${display}"`));
    assert.match(html,/overview-without-sidebar/);
    assert.equal((html.match(/Instant manual control/g)??[]).length,1);
    assert.doesNotMatch(html,/overview-device-links|overview-sidebar|<h2>Home energy/);
  }
});

test('overview contains only its main frame even with analytics configured or a preview preset selected',()=>{
  const card=new SigenHybridCard();card.setConfig({main_display:'photo',entities:{solar_power:'sensor.solar',battery_soc:'sensor.soc'},overview_sections:['statistics','power','today','tariff','solar_chart']});
  card._render=()=>{};
  const verify=()=>{
    const html=card._content();
    assert.ok(html.endsWith('</aside></div>'));
    assert.equal((html.match(/class="main-display-stage"/g)??[]).length,1);
    assert.equal((html.match(/Today's energy/g)??[]).length,2); // Section and accessible name.
    assert.doesNotMatch(html,/extended-energy-grid|Energy statistics|Power metrics|Tariffs &amp; strategy|sigen-history-chart|class="totals"/);
    assert.doesNotMatch(html,/overview-preview-toolbar/);
  };
  verify();
  for(const preset of ['classic','advanced']){
    card._changeOverviewPreview({dataset:{previewLayout:preset},hasAttribute:()=>false});verify();
  }
  card._tab='energy';assert.match(card._content(),/Energy statistics/);
  card._tab='charts';assert.match(card._content(),/chart-catalog/);assert.match(card._content(),/data-chart-panel="power"/);
  card.setConfig({view:'statistics'});assert.match(card._content(),/Energy statistics/);
});

test('saved display settings prevail over configuration defaults and legacy temporary switches', () => {
  const card = new SigenHybridCard(); card.setConfig({entities:{control_status:'sensor.status'}});
  card._hass = {states:{'sensor.status':{state:'locked',attributes:{dashboard:{main_display:'photo'}}}}};
  let saved = {route:'display_settings',local_only:true};
  card._detailContext = () => ({interfaceOptions:{display_settings:saved}});
  assert.equal(card._mainDisplay, 'photo'); // Legacy layout never forces House.
  saved.main_display = 'flow'; assert.equal(card._mainDisplay, 'flow');
  saved.local_only = false; assert.equal(card._mainDisplay, 'photo');
  saved.local_only = true;
  card.setConfig({main_display:'house',entities:{control_status:'sensor.status'}});
  assert.equal(card._mainDisplay, 'flow');
  card._scene = 'photo'; assert.equal(card._mainDisplay, 'flow');
  saved.local_only=false;card.setConfig({main_display:'house'});assert.equal(card._mainDisplay,'house');
  card.setConfig({main_display:'flow'}); assert.equal(card._mainDisplay, 'flow');
  assert.throws(() => card.setConfig({main_display:'<script>'}), /supported main display/);
});

test('photo scene uses normalized measurements and the frozen measurement clock', () => {
  const card = new SigenHybridCard();
  card.setConfig({main_display:'photo',appearance:'night',snapshot_at:'2026-10-27T01:00:00Z',entities:{grid_power:'sensor.grid',battery_soc:'sensor.soc'}});
  card._hass = {states:{'sensor.grid':{state:'2000',last_updated:'2026-10-27T01:00:00Z',attributes:{unit_of_measurement:'W'}},'sensor.soc':{state:'0',attributes:{unit_of_measurement:'%'}}}};
  const html=card._photo();
  assert.ok(html.includes('2 kW'));
  assert.ok(!/NaN|Infinity/.test(html));
  assert.ok(html.includes('data-detail="grid"'));
  assert.ok(!html.includes('data-detail="dc"'));
});

test('temporary scene and appearance previews override saved choices and reset without changing plant data',()=>{
  const card=new SigenHybridCard();card.setConfig({main_display:'photo',appearance:'auto'});
  card._hass={states:{'sun.sun':{state:'below_horizon'}},themes:{darkMode:false}};
  card._savedHomepageAppearance=()=> 'auto';
  assert.equal(card._night(),true);assert.match(card._photo(),/overview-house-night-v1\.webp/);
  card._previewAppearance='day';card._previewMainDisplay='flow';
  assert.equal(card._night(),false);assert.equal(card._mainDisplay,'flow');
  assert.match(card._photo(),/overview-house-day-v1\.webp/);
  assert.equal(card._config.appearance,'auto');assert.equal(card._config.main_display,'photo');
  card._previewAppearance=undefined;card._previewMainDisplay=undefined;
  assert.equal(card._night(),true);assert.equal(card._mainDisplay,'photo');
  card._hass.states['sun.sun'].state='above_horizon';
  assert.equal(card._night(),false);assert.match(card._photo(),/overview-house-day-v1\.webp/);
});


test('standalone selections render without the full dashboard and retain direct controls',()=>{
 const card=new SigenHybridCard();card._render=()=>{};
 for(const view of ['energy_today','energy_summary','power_summary','forecast_summary','mode_control','connections_card','quick_controls','ac','dc','devices','photo']){
  card.setConfig({view,config_entry:'own-entry'});const html=card._content();assert.ok(html.length>50,view);assert.doesNotMatch(html,/class="overview-grid|compact-overview/);assert.equal(card._header(),'');
 }
 card.setConfig({view:'quick_controls'});assert.match(card._content(),/data-preview="battery_export"/);assert.doesNotMatch(card._content(),/overview-charger-controls/);
 card.setConfig({view:'battery',quick_controls:true});assert.match(card._content(),/data-preview="charge"/);assert.doesNotMatch(card._content(),/overview-device-links/);
 card.setConfig({view:'chart',chart_kind:'pv_current'});assert.match(card._content(),/data-chart="pv_current"/);
 assert.throws(()=>card.setConfig({view:'chart',chart_kind:'unknown'}));assert.throws(()=>card.setConfig({view:'controls',controls_layout:'unsafe'}));
});
