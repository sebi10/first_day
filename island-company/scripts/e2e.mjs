// End-to-end playtest in a real browser: create a pass-and-play island,
// play week 0 for all three seats, play week 1, resolve, review.
//   BASE=http://localhost:5173 node scripts/e2e.mjs out-dir [desktop]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? 'e2e-shots';
const desktop = process.argv[3] === 'desktop';
mkdirSync(out, { recursive: true });
const base = process.env.BASE ?? 'http://localhost:5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext(
  desktop ? { viewport: { width: 1280, height: 820 } } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
let n = 0;
const shot = async (name) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: false });
};
const click = async (name, opts = {}) => {
  const b = page.getByRole('button', { name, exact: opts.exact ?? false }).first();
  await b.waitFor({ state: 'visible', timeout: opts.timeout ?? 5000 });
  await b.click();
  await page.waitForTimeout(opts.wait ?? 200);
};
const finishPuzzle = async () => {
  await page.waitForSelector('.phost-body', { timeout: 5000 });
  await page.waitForTimeout(400);
  // dismiss first-encounter overlay if present
  if (await page.locator('.howto').count()) await page.locator('.howto').click();
  await page.waitForTimeout(300);
  // first touch starts the clock (before it, X is a free Back)
  await page.locator('.phost-body .pz').click({ position: { x: 12, y: 12 } });
  await click('Hand in', { exact: true });
  await click('Hand in now');
  await click('Continue', { wait: 300 });
};

process.on('unhandledRejection', async (e) => {
  console.log('FAILED:', String(e).split('\n')[0]);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  await page.screenshot({ path: `${out}/zz-failure.png` });
  await browser.close();
  process.exit(1);
});
await page.goto(base + '/');
await page.evaluate(() => localStorage.clear());
await page.goto(base + '/');
await page.getByPlaceholder('e.g. Seb').fill('Seb');
await shot('start');
await click('New island');
await page.getByRole('radio', { name: '1 device · pass & play' }).click();
await page.getByRole('radio', { name: /Mechanic/ }).click();
await shot('new-island');
await click('Found the island', { wait: 600 });

for (const seat of ['mech', 'elec', 'fin']) {
  await shot(`week0-${seat}`);
  await click('Try a job');
  await click('Start', { exact: true });
  await shot(`week0-${seat}-puzzle`);
  await finishPuzzle();
  if (seat === 'fin') {
    await click('Approve', { exact: true });
    await click('Next: buy a part');
  } else {
    await page.waitForTimeout(1800);
    await click('Do the job');
  }
  await finishPuzzle();
  await click('Got it');
  await click('Finish week 0', { wait: 600 });
  if (seat !== 'fin') {
    await shot(`lobby-after-${seat}`);
    await page.locator('button:has-text("Pass")').first().click();
    await page.waitForTimeout(300);
    const next = seat === 'mech' ? 'Electrician' : 'Analyst';
    await page.locator('.sheet button', { hasText: next }).first().click();
    await page.waitForTimeout(500);
  }
}
await shot('week1-fin-desk');
await page.mouse.wheel(0, 700);
await shot('week1-fin-desk-scrolled');
await page.mouse.wheel(0, -2000);
// analyst: approve two cards, set a rate
for (let i = 0; i < 2; i++) {
  const b = page.getByRole('button', { name: 'Approve', exact: true });
  if (await b.count()) {
    await b.first().click();
    await page.waitForTimeout(450);
  }
}
await shot('fin-after-approvals');
// do one desk task
const task = page.locator('.order.ready').first();
if (await task.count()) {
  await task.click();
  await finishPuzzle();
}
await click('End turn', { wait: 400 });
if (await page.locator('.sheet').count()) await page.locator('.sheet button', { hasText: 'End turn' }).click();
await page.waitForTimeout(500);

// mechanic
await page.locator('button:has-text("Pass")').first().click();
await page.locator('.sheet button', { hasText: 'Mechanic' }).first().click();
await page.waitForTimeout(500);
await shot('week1-mech');
const mo = page.locator('.order.ready').first();
if (await mo.count()) {
  await mo.click();
  await page.waitForTimeout(400);
  await shot('mech-puzzle');
  await finishPuzzle();
}
await click('End turn', { wait: 400 });
if (await page.locator('.sheet').count()) await page.locator('.sheet button', { hasText: 'End turn' }).click();
await page.waitForTimeout(500);

// electrician ends → week resolves
await page.locator('button:has-text("Pass")').first().click();
await page.locator('.sheet button', { hasText: 'Electrician' }).first().click();
await page.waitForTimeout(500);
await shot('week1-elec');
const eo = page.locator('.order.ready').first();
if (await eo.count()) {
  await eo.click();
  await finishPuzzle();
}
await click('End turn', { wait: 400 });
if (await page.locator('.sheet').count()) await page.locator('.sheet button', { hasText: 'End turn' }).click();
await page.waitForTimeout(900);
await shot('review');
if (await page.getByRole('button', { name: 'Onward' }).count()) await click('Onward');
await shot('week2-home');
await click('Board');
await shot('board');
await click('Me');
await shot('me');
await page.mouse.wheel(0, 900);
await shot('me-scrolled');

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
