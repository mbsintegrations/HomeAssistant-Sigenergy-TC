/* Optional browser regression check: npm install --no-save playwright && node tools/check_layout.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');

async function run() {
  const server = http.createServer(async (req, res) => {
    try {
      const target = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
      if (!target.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
      res.setHeader('Content-Type', mime[path.extname(target)] ?? 'text/plain');
      res.end(await fs.readFile(target));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const report = [];
  try {
    for (const [name, width, height, dpr] of [
      ['desktop-overview', 1920, 1080, 1], ['tablet-overview', 1280, 900, 1],
      ['tablet-landscape', 1024, 768, 2], ['tablet-portrait', 800, 1280, 2], ['phone-overview', 412, 915, 2],
    ]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/tools/gallery.html`);
      await page.waitForFunction(() => window.galleryReady);
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => {
        const root = document.querySelector('sigen-hybrid-card').shadowRoot;
        const rect = node => { const r = node.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
        const rings = [...root.querySelectorAll('.overview-summary-ring')].map(rect);
        const contained = [...root.querySelectorAll('.overview-summary-ring,.overview-ring-centre strong,.overview-circle-label')].every(node => {
          const r = node.getBoundingClientRect(), parent = node.parentElement.getBoundingClientRect();
          return r.left >= parent.left - 1 && r.right <= parent.right + 1 && node.scrollWidth <= node.clientWidth + 1;
        });
        const forecast = root.querySelector('[data-display-module=forecast]'), heading = forecast.querySelector('h2').getBoundingClientRect(), badges = forecast.querySelector('.forecast-source-badges').getBoundingClientRect();
        const collision = heading.left < badges.right - 1 && heading.right > badges.left + 1 && heading.top < badges.bottom - 1 && heading.bottom > badges.top + 1;
        const panels = [...root.querySelectorAll('.overview-side-module>.panel')].map(rect);
        const tilesContained = [...root.querySelectorAll('.overview-energy-metric,.overview-side-module .tile')].every(node => {
          const r=node.getBoundingClientRect(), p=node.closest('.panel').getBoundingClientRect();
          return r.left>=p.left-1 && r.right<=p.right+1 && r.top>=p.top-1 && r.bottom<=p.bottom+1 && node.scrollHeight<=node.clientHeight+1;
        });
        return { rings, panels, contained, tilesContained, forecastHeaderOverlaps:collision,
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
          cardOverflow:root.querySelector('ha-card').scrollWidth > root.querySelector('ha-card').clientWidth + 1,
          today:forecast.querySelector('.tile strong').textContent,
          viewportHeight:innerHeight, pageHeight:document.documentElement.scrollHeight };
      });
      await page.screenshot({ path: path.join(root, 'docs/images', name + '.png'), fullPage: true });
      report.push({ name, width, height, dpr, errors, ...layout });
      assert.deepEqual(errors, [], name + ': JavaScript errors');
      assert.equal(layout.pageOverflow || layout.cardOverflow, false, name + ': horizontal overflow');
      assert.equal(layout.contained, true, name + ': overlapping/clipped ring content');
      assert.equal(layout.tilesContained, true, name + ': energy tiles escape their panel');
      assert.equal(layout.forecastHeaderOverlaps, false, name + ': forecast header collision');
      assert.equal(layout.today, '29.6 kWh', name + ': forecast fixture lost its unit');
      if (name === 'tablet-overview') assert.ok(layout.pageHeight <= height, '1280px tablet overview should fit vertically');
      for (let i = 0; i < layout.rings.length - 1; i++) assert.ok(layout.rings[i].right <= layout.rings[i + 1].x + 1, name + ': rings overlap');
      if (name === 'desktop-overview') {
        const card = page.locator('sigen-hybrid-card');
        await card.locator('[data-preview="charge"]').click();
        const manual = card.locator('dialog.sigen-manual-dialog');
        await manual.waitFor({ state: 'visible' });
        await page.screenshot({ path: path.join(root, 'docs/images/manual-control.png') });
        await manual.getByRole('button', { name: 'Cancel', exact: true }).click();
        await card.locator('[data-tab="charts"]').click();
        await card.locator('sigen-history-chart').first().waitFor({ state: 'visible' });
        await page.screenshot({ path: path.join(root, 'docs/images/charts.png') });
        assert.deepEqual(errors, [], 'desktop controls and charts: JavaScript errors');
      }
      await context.close();
    }
    for (const [width, height, sidebar, tallHeader] of [[1280,1100],[1280,900],[1180,820],[1024,768],[800,1280],[600,960],[412,915],[1380,900,true],[1280,800,true],[1200,800,true],[1024,768,true],[1224,800,true,true],[1280,800,true,true]]) {
      for (const display of ['photo','house','flow']) {
        const context = await browser.newContext({viewport:{width,height}});
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/tools/gallery.html?shell=1&inventory_only=1&override=hold&display=${display}${sidebar?'&sidebar=1':''}${tallHeader?'&tall_header=1':''}`);
        await page.waitForFunction(() => window.galleryReady);
        await page.evaluate(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const check = async () => page.evaluate(() => {
          const card=document.querySelector('sigen-hybrid-card'),r=card.shadowRoot,box=r.querySelector('ha-card'),b=box.getBoundingClientRect();
          const panel=r.querySelector('.overview-primary-controls'),stage=r.querySelector('.main-display-stage'),s=stage.getBoundingClientRect();
          const frame=r.querySelector('.sigen-photo-frame'),f=frame?.getBoundingClientRect();
          const labels=[...r.querySelectorAll('.sigen-photo-node')].filter(n=>getComputedStyle(n).display!=='none');
          const labelsInside=labels.every(n=>{const q=n.getBoundingClientRect();return q.left>=s.left-1&&q.right<=s.right+1&&q.top>=s.top-1&&q.bottom<=s.bottom+1;});
          const panels=[...r.querySelectorAll('.overview-summary-stack .overview-side-module>.panel,.overview-sidebar>.overview-device-links')].map(n=>n.getBoundingClientRect());
          const panelOverlap=panels.some((a,i)=>panels.slice(i+1).some(b=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1));
          const tilesContained=[...r.querySelectorAll('.overview-summary-stack .overview-energy-metric,.overview-summary-stack .tile')].every(n=>{const a=n.getBoundingClientRect(),p=n.closest('.panel').getBoundingClientRect();return a.left>=p.left-1&&a.right<=p.right+1&&a.top>=p.top-1&&a.bottom<=p.bottom+1&&n.scrollHeight<=n.clientHeight+2;});
          box.scrollTop=box.scrollHeight;
          return {top:b.top,bottom:b.bottom,viewport:innerHeight,overflow:box.scrollWidth>box.clientWidth+1,wide:[...r.querySelectorAll('main,.compact-overview,.hero,.overview-sidebar,.main-display-stage,.overview-summary-stack,.overview-side-module,.panel,.primary-navigation')].filter(n=>n.getBoundingClientRect().right>b.right+1).map(n=>[n.className,n.getBoundingClientRect().width,n.getBoundingClientRect().right]),
            controlsReachable:panel.getBoundingClientRect().bottom<=box.getBoundingClientRect().bottom+1,
            compact:card.hasAttribute('data-sigen-compact-fit'),allFits:box.scrollHeight<=box.clientHeight+2,scrollHeight:box.scrollHeight,clientHeight:box.clientHeight,controlHeight:panel.getBoundingClientRect().height,overviewHeight:r.querySelector('.compact-overview').getBoundingClientRect().height,rows:getComputedStyle(r.querySelector('.compact-overview')).gridTemplateRows,summary:[...r.querySelectorAll('.overview-summary-stack .panel,.overview-energy-metric,.overview-circle-label,.overview-circle-storage')].map(n=>({cls:n.className,h:n.getBoundingClientRect().height,scroll:n.scrollHeight,min:getComputedStyle(n).minHeight,padding:getComputedStyle(n).padding})),photoHeight:f?.height,sceneHeight:r.querySelector('.sigen-photo-scene')?.getBoundingClientRect().height,blurred:r.querySelector('.sigen-photo-scene')?getComputedStyle(r.querySelector('.sigen-photo-scene'),'::before').content!=='none':false,
            overrideVisible:Boolean(r.querySelector('.manual-override')?.textContent.includes('Hold battery')),overrideInside:[...r.querySelectorAll('.manual-override')].every(n=>{const a=n.getBoundingClientRect(),p=n.closest('.panel').getBoundingClientRect();return a.left>=p.left-1&&a.right<=p.right+1&&a.top>=p.top-1&&a.bottom<=p.bottom+1&&n.scrollWidth<=n.clientWidth+1;}),labelsInside,panelOverlap,tilesContained,photoRatio:f?f.width/f.height:null,artFitsFrame:!f||r.querySelector('.sigen-photo-plane').getBoundingClientRect().height<=f.height+1,hasAc:Boolean(r.querySelector('.sigen-photo-node [data-detail=ac],.mobile-power-grid [data-detail=ac],.flow [data-detail=ac],.house-reading [data-detail=ac]')),hasDc:Boolean(r.querySelector('.sigen-photo-node [data-detail=dc],.mobile-power-grid [data-detail=dc],.flow [data-detail=dc],.house-reading [data-detail=dc]'))};
        });
        let result=await check();
        const initialResult=result,resizes=[];
        assert.ok(result.top>=100&&result.bottom<=height-12,`${width} ${display}: ignores host header/bounds ${JSON.stringify(result)}`);
        assert.equal(result.overflow,false,`${width} ${display}: horizontal overflow ${JSON.stringify(result)}`);
        assert.equal(result.controlsReachable,true,`${width} ${display}: unreachable controls`);
        assert.equal(result.overrideVisible&&result.overrideInside,true,`${width} ${display}: active override hidden or clipped`);
        assert.equal(result.panelOverlap,false,`${width} ${height} ${sidebar} ${display}: summary panels overlap ${JSON.stringify(result)}`);
        assert.equal(result.tilesContained,true,`${width} ${height} ${display}: energy tiles escape their panel ${JSON.stringify(result)}`);
        if(result.compact)assert.equal(result.allFits,true,`${width} ${height} ${display}: landscape controls cut off ${JSON.stringify(result)}`);
        assert.equal(result.blurred,false,'Photo has blurred padding');
        if(display==='photo'&&width>=1024){assert.equal(result.labelsInside,true,`${width}: photo labels clipped ${JSON.stringify(result)}`);assert.equal(result.artFitsFrame,true,'Photo artwork cropped independently of labels');assert.ok(Math.abs(result.photoRatio-1490/673)<.02,'Photo artwork/labels lost their aspect ratio');}
        assert.ok(result.hasAc&&result.hasDc,`${width} ${display}: charger details missing`);
        if(width===1380&&height===900&&sidebar&&display==='photo'){
          await page.evaluate(()=>{document.querySelector('sigen-hybrid-card').shadowRoot.querySelector('ha-card').scrollTop=0;});
          await page.screenshot({path:path.join(root,'docs/images/embedded-tablet.png'),fullPage:false});
        }
        if(width===1280){
          await page.setViewportSize({width:900,height:700});
          await page.evaluate(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          result=await check();
          assert.ok(result.bottom<=688&&!result.overflow&&result.controlsReachable,'Live resize left clipped controls');
          assert.equal(result.panelOverlap,false,'Live resize made summary panels overlap');
          assert.equal(result.overrideVisible&&result.overrideInside,true,'Live resize clipped active override');
          assert.equal(result.tilesContained,true,'Live resize moved energy tiles outside their panel');
          resizes.push({width:900,height:700,...result});
          await page.setViewportSize({width,height});
          await page.evaluate(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          result=await check();
          assert.equal(result.panelOverlap,false,'Returning to the original size left summary panels overlapping');
          assert.equal(result.overrideVisible&&result.overrideInside,true,'Returning size clipped active override');
          assert.equal(result.tilesContained,true,'Returning to the original size left energy tiles outside their panel');
          assert.equal(result.overflow,false,'Returning to the original size left horizontal overflow');
          resizes.push({width,height,...result});
        }
        report.push({embedded:true,width,height,display,...initialResult,resizes});await context.close();
      }
    }
    console.log(JSON.stringify(report));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
