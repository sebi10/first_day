// Screenshot a page on a phone-sized viewport.
// node scripts/shot.mjs "/lab.html?p=torque&tier=3" out.png [taps as x,y;x,y]
import { chromium } from 'playwright-core';

const [path = '/', out = 'shot.png', taps = ''] = process.argv.slice(2);
const base = process.env.BASE ?? 'http://localhost:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(base + path);
await page.waitForTimeout(600);
for (const t of taps.split(';').filter(Boolean)) {
  const [x, y] = t.split(',').map(Number);
  await page.mouse.click(x, y);
  await page.waitForTimeout(250);
}
await page.screenshot({ path: out });
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
await browser.close();
