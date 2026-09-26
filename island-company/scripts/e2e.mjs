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

// Blind sign-off (a real job at tier 2+): a wrong move is accepted silently. No "Wrong",
// no hint of the right answer, and the job carries on; the score still counts it.
{
  const lab = await ctx.newPage();
  lab.on('pageerror', (e) => errors.push(String(e)));
  const statuses = () => lab.evaluate(() => window.__lab.statuses);
  const labShot = async (name) => {
    await lab.waitForTimeout(300);
    await lab.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-${name}.png` });
  };
  // torque, 6 bolts: tap two neighbours (a star pattern never goes to the neighbour next), both are taken
  await lab.goto(`${base}/lab.html?p=torque&tier=3&seed=5&blind=1&notimer=1`);
  await lab.waitForFunction(() => window.__lab);
  const box = await lab.locator('#stage').boundingBox();
  const fr = Math.min(box.width * 0.36, box.height * 0.19);
  for (const i of [0, 1]) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI * 2;
    await lab.mouse.click(box.x + box.width / 2 + Math.cos(a) * fr * 0.72, box.y + box.height * 0.23 + Math.sin(a) * fr * 0.72);
    await lab.waitForTimeout(200);
  }
  await labShot('blind-torque-out-of-order');
  const ts = await statuses();
  const tr = await lab.evaluate(() => window.__lab.timeUp());
  if (ts.some((x) => /wrong|sequence|order/i.test(x)) || !/^Bolt 2 of 6/.test(ts[ts.length - 1] ?? '') || !/out of sequence/.test(tr.summary))
    throw new Error(`blind torque gave a verdict or refused a bolt: ${ts.join(' | ')} / ${tr.summary}`);
  // safety wire: thread bolt 1 the loosening way; it's kept, and the job moves on to the twist
  await lab.goto(`${base}/lab.html?p=safetywire&tier=3&seed=5&blind=1&notimer=1`);
  await lab.waitForFunction(() => window.__lab);
  const path = await lab.evaluate(async () => {
    const mod = await import('/src/puzzles/safetywire.ts');
    const m = mod.generateWire(5, 3);
    const el = document.getElementById('stage').getBoundingClientRect();
    const [w, h] = [el.width, el.height];
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    // the puzzle's own layout (safetywire.ts geo())
    const padR = clamp(Math.min(w * 0.25, h * 0.14), 58, 96);
    const room = h - padR - 22 - padR - 18 - 52;
    const ppi = Math.min((w - 24) / m.plate.w, (room - 118) / m.plate.h);
    const spare = Math.max(0, room - m.plate.h * ppi - 118);
    const px = el.left + (w - m.plate.w * ppi) / 2;
    const py = el.top + 56 + spare * 0.12;
    const R = clamp(ppi * 0.28, 22, 32);
    const b = m.bolts[0];
    const c = { x: px + b.x * ppi, y: py + b.y * ppi };
    const s = -mod.tighteningDir(m.bolts, 0); // the wrong way
    const u = { x: Math.cos(b.hole) * s, y: Math.sin(b.hole) * s };
    const start = { x: px + m.start.x * ppi, y: py + m.start.y * ppi };
    // go round to the entry side without touching the head, then straight through the hole
    const side = { x: -u.y, y: u.x };
    const k = (start.x - c.x) * side.x + (start.y - c.y) * side.y >= 0 ? 1 : -1;
    const around = { x: c.x + side.x * k * (R + 70), y: c.y + side.y * k * (R + 70) };
    const entry = { x: c.x - u.x * (R + 26), y: c.y - u.y * (R + 26) };
    const exit = { x: c.x + u.x * (R + 26), y: c.y + u.y * (R + 26) };
    return [start, around, entry, exit];
  });
  await lab.mouse.move(path[0].x, path[0].y);
  await lab.mouse.down();
  for (const q of path.slice(1)) await lab.mouse.move(q.x, q.y, { steps: 14 });
  await lab.mouse.up();
  await labShot('blind-safetywire-wrong-way');
  const ws = await statuses();
  const wr = await lab.evaluate(() => window.__lab.timeUp());
  if (ws.some((x) => /wrong|back out/i.test(x)) || !/^Span 1 of/.test(ws[ws.length - 1] ?? '') || wr.data?.wrongWay !== 1)
    throw new Error(`blind safety wire gave a verdict or refused the thread: ${ws.join(' | ')} / wrongWay ${wr.data?.wrongWay}`);
  console.log('blind check: torque and safety wire take a wrong move silently');
  await lab.close();
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
