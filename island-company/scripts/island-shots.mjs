// Screenshot every island-lab scenario at phone and desktop card widths.
//   BASE=http://localhost:5173 node scripts/island-shots.mjs out-dir
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? 'island-shots';
mkdirSync(out, { recursive: true });
const base = process.env.BASE ?? 'http://localhost:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
for (const [label, w, dpr] of [
  ['phone', 358, 2],
  ['desk', 600, 1],
]) {
  const page = await browser.newPage({ viewport: { width: w + 40, height: 900 }, deviceScaleFactor: dpr });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
  await page.goto(`${base}/islandlab.html?w=${w}`);
  await page.waitForSelector('.scn svg', { timeout: 20000 });
  await page.waitForTimeout(1200);
  const ids = await page.$$eval('.scn', (els) => els.map((e) => e.getAttribute('data-id')));
  for (const id of ids) {
    const el = page.locator(`.scn[data-id="${id}"]`);
    await el.scrollIntoViewIfNeeded();
    await el.screenshot({ path: `${out}/${label}-${id}.png` });
  }
  const nodes = await page.$$eval('.scn', (els) => els.map((e) => [e.getAttribute('data-id'), e.querySelectorAll('svg *').length]));
  console.log(label, 'svg nodes per scenario', JSON.stringify(Object.fromEntries(nodes)));
  // the node budget (docs/JOBFLOW.md 15.10): the busiest scene, the beaten island at night, stays at or under 1,500
  const beaten = Object.fromEntries(nodes).beaten;
  if (beaten > 1500) errors.push(`${label}: the beaten scene has ${beaten} SVG nodes (budget 1,500)`);
}
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no errors');
await browser.close();
