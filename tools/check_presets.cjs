/* Optional browser checks for native settings: NODE_PATH=<playwright location> node tools/check_presets.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

async function run() {
  const server = http.createServer(async (req, res) => {
    try {
      const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
      if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
      res.setHeader('Content-Type', {'.html':'text/html','.js':'text/javascript','.webp':'image/webp','.png':'image/png'}[path.extname(file)] ?? 'text/plain');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
  const results = [];
  try {
    for (const [width,height,dpr] of [[1920,1080,1],[1024,768,2],[412,915,3]]) {
      const context = await browser.newContext({viewport:{width,height},deviceScaleFactor:dpr});
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/tools/gallery.html`);
      await page.waitForFunction(() => window.galleryReady);
      for (const route of ['strategies','tariffs','network','battery_preheating','charging_mode']) {
        await page.evaluate(route => {
          const card=document.querySelector('sigen-hybrid-card');
          const inventory=[{id:'EC-EXAMPLE',serial:'EC-EXAMPLE',type:'inverter',installed:true},{id:'DC-EXAMPLE',serial:'DC-EXAMPLE',type:'dc',installed:true}];
          card._deviceInventory=()=>inventory; card._config.devices=inventory;
          card._loadPlantConfiguration=async()=>{}; card._loadOwnerConfiguration=async()=>{};
          card._detailDirty=false;card._closeDetail();
          const id=route==='network'?'EC-EXAMPLE':route==='charging_mode'?'DC-EXAMPLE':undefined;
          card._openDetail(route,id);
          const data={
            strategies:{section:'strategies',value:{rules:[{personalizationRuleId:17,personalizationRuleName:'Night charging',ruleCondition:'Every day 02:00–05:00, trigger when SOC ≤ 40%',ruleEffect:'Force charge'}]}},
            tariffs:{section:'tariffs',value:{currency:{currencyCode:'EUR',currencyMinName:'Cent'},plan:{buySellTariff:{buyTariff:{staticConfig:{providerName:'Home Energy',planName:'EV night plan',combinedPrices:[{monthRange:'01–12',weekPrices:[{weekRange:'1–7',timeRange:[{timeRange:'00:00–02:00',price:25},{timeRange:'02:00–05:00',price:9},{timeRange:'05:00–24:00',price:30}]}]}]}},sellTariff:{staticConfig:{providerName:'Home Energy',planName:'Export',combinedPrices:[{weekPrices:[{weekRange:'1–7',timeRange:[{timeRange:'00:00–24:00',price:18}]}]}]}}}},taxes_and_fees:{}}},
            network:{section:'network',value:{ipAddress:'192.0.2.5',wifiSsid:'Home energy network',wifiSignalStrength:85,ethernetStatus:2}},
            battery_preheating:{section:'preheating',value:{packPreheatingSwitch:0,packPreheatingVOList:[{startTime:60,duration:60,periodConfig:[1,2,3,4,5,6,7],chargingPower:'',dischargePower:''}]}}
          };
          if(data[route])card._plantConfiguration={...data[route],route,id};
          if(route==='charging_mode')card._ownerConfiguration={route,id,setting:'dc_charge_mode',value:{mode:2,battery_boost:true,cutoff_soc:20,grid_charging:null,max_grid_power_kw:null,discharge_power_kw:25,stop_discharging_soc:20}};
          card._openDetail(route,id,true);
        },route);
        const result=await page.evaluate(()=>{
          const dialog=document.querySelector('sigen-hybrid-card')._detailDialog,body=dialog.querySelector('.detail-body');
          dialog.scrollTop=dialog.scrollHeight;
          return {horizontalOverflow:body.scrollWidth>body.clientWidth+1,scrolls:dialog.scrollHeight<=dialog.clientHeight+1||dialog.scrollTop>0,text:body.textContent,selected:body.querySelector('select[name=mode]')?.value};
        });
        assert.equal(result.horizontalOverflow,false,`${width} ${route}: horizontal clipping`);
        assert.equal(result.scrolls,true,`${width} ${route}: content unreachable`);
        if(route==='strategies')assert.match(result.text,/Night charging/);
        if(route==='charging_mode')assert.equal(result.selected,'2','Existing V2X must not silently select Fast');
        if(width===1920&&['strategies','tariffs'].includes(route)) {
          await page.evaluate(()=>document.querySelector('sigen-hybrid-card')._detailDialog.scrollTop=0);
          await page.screenshot({path:path.join(root,'docs/images',`native-${route}.png`)});
        }
        results.push({width,height,dpr,route,horizontalOverflow:result.horizontalOverflow,scrolls:result.scrolls});
      }
      assert.deepEqual(errors,[]);
      await context.close();
    }
    console.log(JSON.stringify({passed:results.length,results}));
  } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
