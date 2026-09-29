// Screenshot every island-lab scenario at phone and desktop card widths, and
// check the node budget; or measure the map's frame times.
//   BASE=http://localhost:5173 node scripts/island-shots.mjs out-dir
//   BASE=http://localhost:5173 node scripts/island-shots.mjs out-dir perf
//
// The budget (docs/EXPANSION.md 5.7): every scene listed in BUDGET stays at or
// under 1,500 SVG nodes at 358 px, drawn plain and through the map (camera and
// hotspots in: they add no SVG nodes). A listed scene the lab doesn't have yet
// (stage 3's) is skipped.
//
// perf (5.6): a phone (390 x 844, dpr 2, touch) with the CPU throttled 4x (a mid
// phone), the ambient motion on; frame times (requestAnimationFrame deltas)
// during a 1 s pinch and a 1 s two-finger pan on the inline map, and a 1 s
// one-finger drag in Explore, on the heaviest scenes. Median <= 16.7 ms and
// p95 <= 33 ms, or it reports an error.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { executablePath } from './chromium.mjs';

const BUDGET = ['beaten', 'beaten-storm-night', 'beaten-reno', 'home-fleet', 'tern-busy', 'adair-busy', 'region'];
const PERF = ['beaten', 'beaten-storm-night'];
const LIMIT = { scene: 1500, region: 400 };

const out = process.argv[2] ?? 'island-shots';
const perf = process.argv[3] === 'perf';
mkdirSync(out, { recursive: true });
const base = process.env.BASE ?? 'http://localhost:5173';
const browser = await chromium.launch({ executablePath });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!perf) {
  for (const [label, w, dpr] of [
    ['phone', 358, 2],
    ['desk', 600, 1],
  ]) {
    const page = await browser.newPage({ viewport: { width: w + 40, height: 900 }, deviceScaleFactor: dpr });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && !m.text().includes('403') && errors.push(m.text()));
    await page.goto(`${base}/islandlab.html?w=${w}`);
    await page.waitForSelector('.scn svg', { timeout: 20000 });
    await page.waitForTimeout(1200);
    const ids = await page.$$eval('.scn', (els) => els.map((e) => e.getAttribute('data-id')));
    for (const id of ids) {
      const el = page.locator(`.scn[data-id="${id}"]`);
      await el.scrollIntoViewIfNeeded();
      await el.screenshot({ path: `${out}/${label}-${id}.png` });
    }
    const nodes = Object.fromEntries(await page.$$eval('.scn', (els) => els.map((e) => [e.getAttribute('data-id'), e.querySelectorAll('svg *').length])));
    console.log(label, 'svg nodes per scenario', JSON.stringify(nodes));
    // the same scenes through the map (MapView: the camera, the controls, the hotspots)
    await page.goto(`${base}/islandlab.html?w=${w}&map=1`);
    await page.waitForSelector('.scn svg.island-svg', { timeout: 20000 });
    await page.waitForTimeout(1200);
    const mapped = Object.fromEntries(await page.$$eval('.scn', (els) => els.map((e) => [e.getAttribute('data-id'), e.querySelectorAll('svg *').length])));
    for (const id of BUDGET) {
      if (!(id in nodes)) continue;
      const lim = id === 'region' ? LIMIT.region : LIMIT.scene;
      for (const [how, n] of [['plain', nodes[id]], ['map', mapped[id]]]) {
        console.log(`${label} ${id} (${how}): ${n} SVG nodes`);
        if (n > lim) errors.push(`${label}: the ${id} scene (${how}) has ${n} SVG nodes (budget ${lim})`);
      }
    }
    await page.close();
  }
} else {
  const stats = (a) => {
    const s = [...a].sort((x, y) => x - y);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { frames: s.length, median: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1) };
  };
  for (const scene of PERF) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${base}/islandlab.html?w=358&map=1&only=${scene}`);
    await page.waitForSelector('.map-vp svg.island-svg', { timeout: 20000 });
    await sleep(800);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const record = () =>
      page.evaluate(() => {
        const w = window;
        w.__ft = [];
        w.__rec = true;
        let last = performance.now();
        const f = (t) => {
          w.__ft.push(t - last);
          last = t;
          if (w.__rec) requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      });
    const stop = () => page.evaluate(() => ((window.__rec = false), window.__ft.slice(1)));
    /** 60 moves over about a second, one every 16.7 ms */
    const moves = async (at) => {
      const t0 = Date.now();
      for (let i = 1; i <= 60; i++) {
        await touch('touchMove', at(i / 60));
        await sleep(Math.max(0, t0 + i * 16.7 - Date.now()));
      }
    };
    const box = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const r = await box('.map-vp');
    const cx = r.x + r.w * 0.6, cy = r.y + r.h * 0.5;
    const res = {};
    await record();
    await touch('touchStart', [{ x: cx - 30, y: cy, id: 1 }, { x: cx + 30, y: cy, id: 2 }]);
    await moves((t) => [{ x: cx - 30 - 70 * t, y: cy, id: 1 }, { x: cx + 30 + 70 * t, y: cy, id: 2 }]);
    res.pinch = stats(await stop());
    await touch('touchEnd', []);
    await sleep(700);
    await record();
    await touch('touchStart', [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }]);
    await moves((t) => [{ x: cx - 40 - 120 * t, y: cy, id: 1 }, { x: cx + 40 - 120 * t, y: cy, id: 2 }]);
    res.pan = stats(await stop());
    await touch('touchEnd', []);
    await sleep(700);
    await page.evaluate(() => document.querySelector('.map-ctl button[aria-label="Explore full screen"]').click());
    await sleep(900);
    await page.evaluate(() => document.querySelector('.map-ctl button[aria-label="Zoom in"]').click());
    await sleep(900);
    const e = await box('.map-explore .map-vp');
    const ex = e.x + e.w / 2, ey = e.y + e.h / 2;
    await record();
    await touch('touchStart', [{ x: ex, y: ey, id: 1 }]);
    await moves((t) => [{ x: ex - 150 * t, y: ey + 60 * t, id: 1 }]);
    res.exploreDrag = stats(await stop());
    await touch('touchEnd', []);
    await sleep(500);
    console.log(scene, JSON.stringify(res));
    for (const [what, st] of Object.entries(res)) if (st.median > 16.8 || st.p95 > 33) errors.push(`${scene} ${what}: median ${st.median} ms, p95 ${st.p95} ms (want <= 16.7 and <= 33)`);
    await ctx.close();
  }
}
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no errors');
await browser.close();
