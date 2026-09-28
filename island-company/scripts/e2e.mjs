// End-to-end playtest in a real browser: create a pass-and-play island,
// play week 0 for all three seats (the techs walk one alert through the job
// flow), play week 1 across the seats (the techs take alerts through the
// manual, the IPC or catalog, stock and Send; the mechanic asks Stores for a
// line; the analyst sees it at once and buys it, approves the cards, hires),
// resolve, and check week 2 (the line landed: on hand), the review and board.
//   BASE=http://localhost:5173 node scripts/e2e.mjs out-dir [desktop]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { executablePath } from './chromium.mjs';

const out = process.argv[2] ?? 'e2e-shots';
const desktop = process.argv[3] === 'desktop';
mkdirSync(out, { recursive: true });
const base = process.env.BASE ?? 'http://localhost:5173';
const browser = await chromium.launch({ executablePath });
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
  // a mechanic job on a plane opens its detail first (the manual), then Start
  await page.waitForTimeout(300);
  const start = page.locator('.sheet button:has-text("Start the job")');
  if (!(await page.locator('.phost-body').count()) && (await start.count())) await start.first().click();
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

const onFail = async (e) => {
  console.log('FAILED:', String(e).split('\n')[0]);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  await page.screenshot({ path: `${out}/zz-failure.png` }).catch(() => {});
  await browser.close();
  process.exit(1);
};
// a throw after a top-level await surfaces as an uncaught exception
process.on('unhandledRejection', onFail);
process.on('uncaughtException', onFail);
const fail = (msg) => {
  throw new Error(msg);
};

// --- the job flow's sheet (src/ui/flow): drive one alert from wherever it opens to Send, at the teaching tier
const sheet = () => page.locator('.jf-sheet').first();
const sheetOpen = async () => (await page.locator('.jf-sheet').count()) > 0;
const closeSheet = async () => {
  const x = page.locator('.jf-sheet .jf-x[aria-label="Close"]').first();
  if (await x.count()) await x.click();
  await page.waitForTimeout(300);
};
/**
 * Investigate → Manual (the likely task) → Use this task → each slot's likely row (a slot with no marked row
 * is an "if needed" one this fault doesn't need: back out of it) → Check stock → Send. Returns what Send said.
 */
const driveAlert = async () => {
  const skipped = new Set();
  let slot = '';
  for (let step = 0; step < 24; step++) {
    await page.waitForTimeout(250);
    const b = (name) => sheet().getByRole('button', { name });
    if (await b(/^Send ▸/).count()) {
      const label = (await b(/^Send ▸/).first().innerText()).trim();
      await b(/^Send ▸/).first().click();
      await page.waitForTimeout(700);
      const banner = (await page.locator('.jf-sheet .jf-note.ok').first().innerText().catch(() => '')).trim();
      return { label, banner };
    }
    if (await b(/^Find the (task|procedure)/).count()) {
      await b(/^Find the (task|procedure)/).first().click();
      continue;
    }
    if (await b(/^Use this task/).count()) {
      await b(/^Use this task/).first().click();
      continue;
    }
    // a slot open on its search (the IPC or the catalog): the likely row, else back out of it
    const back = sheet().locator('.jf-back');
    if (slot && (await back.count())) {
      const likely = sheet().locator('.jf-row.likely');
      if (await likely.count()) await likely.first().click();
      else {
        skipped.add(slot);
        await back.first().click();
      }
      slot = '';
      continue;
    }
    // the Parts step: the next empty slot not skipped, else on to Stock
    const empty = sheet().locator('.jf-slot-main', { has: page.locator('.jf-fill.empty') });
    let opened = false;
    for (let i = 0; i < (await empty.count()); i++) {
      const label = (await empty.nth(i).getAttribute('aria-label')) ?? String(i);
      if (skipped.has(label)) continue;
      slot = label;
      await empty.nth(i).click();
      opened = true;
      break;
    }
    if (opened) continue;
    if (await b(/^Check stock/).count()) {
      await b(/^Check stock/).first().click();
      continue;
    }
    // the Manual step's list: the likely task, else the first
    const likely = sheet().locator('.jf-row.likely');
    const rows = sheet().locator('.jf-row');
    if (await likely.count()) await likely.first().click();
    else if (await rows.count()) await rows.first().click();
    else break;
  }
  return null;
};
/**
 * a tech's first Your move row that isn't a Start: open it, make a hazard safe, plan it. A finding that can't
 * duplicate the fault ("It's the dryer", "Could not duplicate") has no job to plan: the next alert, else close that
 * one with no fault found
 */
const planFirst = async (tag) => {
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  // an alert's row (the week's revenue work, a load sheet or a ground power start, is a row of its own: not an alert)
  const rows = page.locator('.jf-your .jf-arow:not(.rev):not(:has(.jf-start)) .jf-arow-main');
  const count = await rows.count();
  let nff = -1;
  for (let i = 0; i < count; i++) {
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await rows.nth(i).click();
    await page.waitForTimeout(500);
    if (!(await sheetOpen())) fail(`${tag}: the alert row opened no job sheet`);
    if (await sheet().getByRole('button', { name: 'No fault found · close' }).count()) {
      if (nff < 0) nff = i;
      await closeSheet();
      continue;
    }
    await shot(`${tag}-alert`);
    const safe = sheet().getByRole('button', { name: 'Make it safe' });
    if (await safe.count()) {
      await safe.click();
      await sheet().getByRole('button', { name: /: off and tag it$/ }).first().click(); // the alert's own breaker ("The kitchen's 20 A breaker: off and tag it")
      await page.waitForTimeout(500);
      await shot(`${tag}-made-safe`);
    }
    const sent = await driveAlert();
    await shot(`${tag}-sent`);
    await closeSheet();
    return sent;
  }
  if (nff < 0) return null;
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await rows.nth(nff).click();
  await page.waitForTimeout(500);
  await shot(`${tag}-alert-nff`);
  await sheet().getByRole('button', { name: 'No fault found · close' }).click();
  await sheet().getByRole('button', { name: 'Close it: no fault found' }).click();
  await page.waitForTimeout(700);
  // the sheet turns to the closed card ("Closed: no fault found. Week 1.")
  const banner = (await page.locator('.jf-sheet .jf-stage.closed b').first().innerText().catch(() => '')).trim();
  if (!/no fault found/i.test(banner)) fail(`${tag}: the alert didn't close with no fault found (${banner || 'no closed card'})`);
  await shot(`${tag}-nff-closed`);
  await closeSheet();
  return { label: 'No fault found', banner };
};
/** Start a ready job from Your move (the host runs the install check) and hand in the puzzle */
const startReady = async (tag) => {
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  const start = page.locator('.jf-your .jf-start').first();
  if (!(await start.count())) return false;
  await start.click();
  await page.waitForTimeout(600);
  // radio work (and a ground power start) needs a charged cart hooked up to the plane: the carts' sheet opens
  // instead of the job. Hook one up, close the sheet and start again
  const gse = page.locator('.sheet', { hasText: 'Ground power' });
  if (await gse.count()) {
    await shot(`${tag}-needs-cart`);
    const hook = gse.getByRole('button', { name: /^Hook up to / });
    if (!(await hook.count())) return false;
    await hook.first().click();
    await page.waitForTimeout(400);
    const close = page.locator('.sheet').getByRole('button', { name: 'Close', exact: true });
    if (await close.count()) await close.first().click();
    await page.waitForTimeout(400);
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await page.locator('.jf-your .jf-start').first().click();
    await page.waitForTimeout(600);
  }
  if (await page.locator('.sheet', { hasText: 'Work stopped' }).count()) {
    await shot(`${tag}-stopped`);
    await page.keyboard.press('Escape');
    return false;
  }
  await shot(`${tag}-puzzle`);
  await finishPuzzle();
  return true;
};
const endTurn = async () => {
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await click('End turn', { wait: 400 });
  if (await page.locator('.sheet').count()) await page.locator('.sheet button', { hasText: 'End turn' }).last().click();
  await page.waitForTimeout(600);
};
const passTo = async (label) => {
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.locator('button:has-text("Pass")').first().click();
  await page.waitForTimeout(300);
  await page.locator('.sheet button', { hasText: label }).first().click();
  await page.waitForTimeout(600);
};
/** the mechanic's Stores: the first shelf row (its P/N and how many are on hand) */
const storesRow = async (pn) => {
  await page.locator('.jf-stores').first().scrollIntoViewIfNeeded();
  await page.locator('.jf-stores').first().click();
  await page.waitForTimeout(500);
  const rows = page.locator('.sheet .jf-inv-row', { has: page.locator('.jf-badge') });
  const row = pn ? rows.filter({ hasText: pn }).first() : rows.first();
  const text = (await row.innerText()).replace(/\n/g, ' | ');
  const m = /(\d+)(?: [a-z]+)? on hand/.exec(text);
  return { row, text, pn: text.split(' ')[0], on: m ? Number(m[1]) : 0 };
};

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
    await finishPuzzle();
  } else {
    // the job flow's walk-through: one scripted alert, on a copy of the island (nothing is written)
    await click('Open the alert');
    await page.waitForTimeout(400);
    const sent = await driveAlert();
    if (!sent) fail(`week 0 (${seat}): the walk-through never reached Send`);
    await page.waitForTimeout(400);
    await shot(`week0-${seat}-walkthrough`);
    await click('Next', { exact: true });
  }
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
await shot('week1-fin-first-look');

// --- week 1, the mechanic: an alert through the flow, a ready job started, a line asked of Stores
await passTo('Mechanic');
await shot('week1-mech');
const dockMech = (await page.locator('.dock .primary').first().innerText()).replace(/\n/g, ' | ');
// an alert, or this week's revenue work first when no alert is due this week (the load sheet, a ground power start)
if (!/^Next: |^Start: |^Load sheet · |^Ground power start · /.test(dockMech)) fail(`the mechanic's Dock should lead to an alert or this week's revenue work, got "${dockMech}"`);
const mechSent = await planFirst('mech');
console.log('mechanic sent:', JSON.stringify(mechSent));
if (!mechSent) fail('the mechanic could not take an alert to Send');
await startReady('mech');
const before = await storesRow();
await shot('mech-stores');
await before.row.getByRole('button', { name: 'Request' }).click();
await page.waitForTimeout(300);
await page.locator('.sheet').getByRole('button', { name: /^Send the request/ }).click();
await page.waitForTimeout(500);
await shot('mech-stores-requested');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
console.log(`mechanic asked for 1 × ${before.pn} (${before.on} on hand)`);
await endTurn();

// --- the analyst: the request is on the desk at once; buy it, approve the cards, hire, a desk task
await passTo('Analyst');
await shot('week1-fin-desk');
const dockFin = (await page.locator('.dock .primary').first().innerText()).replace(/\n/g, ' | ');
if (!/to approve/.test(dockFin)) fail(`the analyst's Dock should count the request, got "${dockFin}"`);
await page.evaluate(() => document.getElementById('approvals')?.scrollIntoView());
await page.waitForTimeout(300);
const desk = await page.locator('.pdesk').first().innerText();
if (!desk.includes(before.pn)) fail(`the mechanic's request for ${before.pn} isn't on the analyst's desk`);
await shot('fin-request-on-desk');
for (let i = 0; i < 4; i++) {
  const b = page.getByRole('button', { name: /^Approve \$/ });
  if (!(await b.count())) break;
  await b.first().click();
  await page.waitForTimeout(500);
}
const reqBtn = page.getByRole('button', { name: /^Approve \d+ ·/ });
if (!(await reqBtn.count())) fail('no Approve button for the requests');
await reqBtn.first().click();
await page.waitForTimeout(600);
await shot('fin-after-approvals');
for (let i = 0; i < 2; i++) {
  const b = page.getByRole('button', { name: 'Approve', exact: true });
  if (!(await b.count())) break;
  await b.first().click();
  await page.waitForTimeout(450);
}
// the Staff tab: the payroll and the hiring board; hire the first candidate
await page.locator('.pd-tabs button', { hasText: 'Staff' }).first().click();
await page.waitForTimeout(400);
await shot('fin-staff');
const crewBefore = await page.locator('.st-list .st-row').count();
const hire = page.locator('.st-cand').getByRole('button', { name: 'Hire', exact: true });
if (await hire.count()) {
  await hire.first().click();
  await page.waitForTimeout(300);
  await page.locator('.sheet').getByRole('button', { name: /^Hire .+ · \$/ }).click();
  await page.waitForTimeout(500);
  const crewAfter = await page.locator('.st-list .st-row').count();
  if (crewAfter !== crewBefore + 1) fail(`the hire didn't join the crew (${crewBefore} → ${crewAfter})`);
  await shot('fin-hired');
}
await page.locator('.pd-tabs button', { hasText: 'Approvals' }).first().click();
await page.waitForTimeout(300);
const task = page.locator('.order.ready').first();
if (await task.count()) {
  await task.click();
  await finishPuzzle();
}
await endTurn();

// --- the electrician ends the week: an alert through the flow, a ready job started
await passTo('Electrician');
await shot('week1-elec');
const elecSent = await planFirst('elec');
console.log('electrician sent:', JSON.stringify(elecSent));
if (!elecSent) fail('the electrician could not take an alert to Send');
await startReady('elec');
await endTurn();
await page.waitForTimeout(900);
await shot('review');
const reviewText = await page.locator('.overlay').first().innerText().catch(() => '');
if (await page.getByRole('button', { name: 'Onward' }).count()) await click('Onward');
if (await page.locator('.overlay button[aria-label="Close"]').count()) await page.locator('.overlay button[aria-label="Close"]').first().click();
await page.waitForTimeout(300);
await shot('week2-home');

// --- week 2: the line the analyst bought landed at the resolve: the badge says it's on hand
await passTo('Mechanic');
const after = await storesRow(before.pn);
await shot('week2-mech-stores');
console.log(`week 2: ${before.pn} ${before.on} → ${after.on} on hand`);
if (after.on <= before.on) {
  // about one OEM part line in 50 comes without its paperwork and receiving quarantines it a week (stock.ts
  // receivePo): the review said why, Stores says it lands tonight, and it's on hand once week 2 resolves
  const why = /quarantined|waits a week/.test(reviewText);
  console.log(`${before.pn} is held a week (the review said why: ${why}): ending week 2 to see it land`);
  if (!why || !/on order, lands tonight/.test(after.text)) fail(`the request for ${before.pn} didn't land: ${before.on} → ${after.on} on hand (${after.text})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await endTurn();
  await passTo('Electrician');
  await endTurn();
  await passTo('Analyst');
  await endTurn();
  await page.waitForTimeout(900);
  if (await page.getByRole('button', { name: 'Onward' }).count()) await click('Onward');
  if (await page.locator('.overlay button[aria-label="Close"]').count()) await page.locator('.overlay button[aria-label="Close"]').first().click();
  await page.waitForTimeout(300);
  await passTo('Mechanic');
  const landed = await storesRow(before.pn);
  await shot('week3-mech-stores');
  console.log(`week 3: ${before.pn} ${before.on} → ${landed.on} on hand`);
  if (landed.on <= before.on) fail(`the request for ${before.pn} didn't land after its week in quarantine (${landed.text})`);
}
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
// the bottom tabs themselves: an alert row's name can hold the word ("the outboard shoulder")
const tab = async (name) => {
  await page.locator('nav.tabs button', { hasText: new RegExp(`^${name}`) }).first().click();
  await page.waitForTimeout(200);
};
await tab('Board');
await shot('board');
await tab('Me');
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

  // crack hunt, hydraulic servicing, ground power start: nothing drawn on the canvas gives a verdict.
  // The lab page records every fillText (and the receptacle's pins) in page coordinates.
  const drawn = await ctx.newPage();
  drawn.on('pageerror', (e) => errors.push(String(e)));
  await drawn.addInitScript(() => {
    const P = CanvasRenderingContext2D.prototype;
    const wrap = (orig, kind) =>
      function (...a) {
        if (this.canvas.isConnected) {
          const m = this.getTransform();
          const r = this.canvas.getBoundingClientRect();
          const k = this.canvas.width / r.width;
          const [x, y] = kind === 'text' ? [a[1], a[2]] : [a[0], a[1]];
          (window.__drawn ??= []).push({ kind, text: kind === 'text' ? String(a[0]) : '', r: a[2], t: performance.now(), x: r.left + (m.a * x + m.c * y + m.e) / k, y: r.top + (m.b * x + m.d * y + m.f) / k });
        }
        return orig.apply(this, a);
      };
    P.fillText = wrap(P.fillText, 'text');
    P.arc = wrap(P.arc, 'arc');
  });
  const since = (t) => drawn.evaluate((t0) => window.__drawn.filter((d) => d.kind === 'text' && d.t >= t0).map((d) => d.text), t);
  const where = async (text) => {
    const d = await drawn.evaluate((s) => window.__drawn.filter((e) => e.text === s).pop(), text);
    if (!d) throw new Error(`"${text}" was never drawn`);
    return d;
  };
  const nowT = () => drawn.evaluate(() => performance.now());
  const VERDICT = /✓|✗|missed|tool mark|swabs off|open metal|bleed-out|porosity|specks|STOP|CONTAMINATED|hazard|Not this system|At FULL|Plugged in live|Fault:/;
  const open = async (p) => {
    await drawn.goto(`${base}/lab.html?p=${p}&tier=3&seed=3&blind=1&notimer=1`);
    await drawn.waitForFunction(() => window.__lab && window.__drawn?.length);
  };
  // crack: circle whatever is under a few taps, then sign off: no rings judged, no missed cracks, no labels
  await open('crack');
  const cb = await drawn.locator('#stage canvas').boundingBox();
  for (const [fx, fy] of [[0.3, 0.3], [0.5, 0.45], [0.7, 0.6], [0.4, 0.72], [0.6, 0.22]]) {
    await drawn.mouse.click(cb.x + cb.width * fx, cb.y + cb.height * fy);
    await drawn.waitForTimeout(120);
  }
  const sign = await where('Sign off');
  const t0 = await nowT();
  await drawn.mouse.click(sign.x, sign.y);
  await drawn.waitForTimeout(1500);
  await drawn.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-blind-crack-signed.png` });
  const crackV = (await since(t0)).filter((s) => VERDICT.test(s));
  if (crackV.length || !/no verdict/.test(await drawn.locator('#res').textContent())) throw new Error(`blind crack hunt revealed: ${crackV.join(', ')}`);
  // hydraulics: oxygen on the charging hose charges like nitrogen; no STOP card, the job carries on
  await open('hydraulics');
  for (const name of ['Accum.', 'OXYGEN']) {
    const b = await where(name);
    await drawn.mouse.click(b.x, b.y);
    await drawn.waitForTimeout(200);
  }
  const wheel = await where('CHARGE · hold');
  const t1 = await nowT();
  await drawn.mouse.move(wheel.x, wheel.y - 16);
  await drawn.mouse.down();
  await drawn.waitForTimeout(1200);
  await drawn.mouse.up();
  await drawn.waitForTimeout(400);
  const hydV = (await since(t1)).filter((s) => VERDICT.test(s));
  if (hydV.length || (await drawn.evaluate(() => window.__lab.result))) throw new Error(`blind hydraulics called out the oxygen: ${hydV.join(', ')}`);
  // gpu: cart ON, then plug in live. Sparks (the world), no "Plugged in live", and it still scores
  await open('gpu');
  const outSw = await where('OUTPUT');
  await drawn.mouse.click(outSw.x, outSw.y + 41);
  await drawn.waitForTimeout(300);
  const cart = await where('GROUND POWER');
  const pin = await drawn.evaluate(() => {
    const p = window.__drawn.filter((d) => d.kind === 'arc' && d.r === 4.5);
    return p.reverse().find((a) => p.some((b) => Math.abs(b.x - a.x - 18) < 0.5 && Math.abs(b.y - a.y) < 0.5));
  });
  const t2 = await nowT();
  await drawn.mouse.move(cart.x - 40, cart.y - 35);
  await drawn.mouse.down();
  await drawn.mouse.move(cart.x - 20, cart.y - 55, { steps: 3 });
  await drawn.mouse.move(pin.x + 9, pin.y + 4 + 34, { steps: 8 });
  await drawn.mouse.up();
  await drawn.waitForTimeout(500);
  const gpuV = (await since(t2)).filter((s) => VERDICT.test(s));
  const gr = await drawn.evaluate(() => window.__lab.timeUp());
  await drawn.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}-blind-gpu-live-plug.png` });
  if (gpuV.length || !gr.data?.errors?.includes('arcIn')) throw new Error(`blind ground power start: ${gpuV.join(', ')} / ${gr.data?.errors}`);
  console.log('blind check: crack hunt, hydraulics and ground power start draw no verdict');
  await drawn.close();
  await lab.close();
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
