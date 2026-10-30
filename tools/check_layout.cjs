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
      await context.close();
    }
    console.log(JSON.stringify(report));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
