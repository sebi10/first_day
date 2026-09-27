// Online playtest against the Firebase emulators: three players on separate
// devices (two phones + a laptop), plus the mechanic linking a second device
// with the seat code and seeing the same seat. The job flow across devices: the
// mechanic takes an alert through the flow and asks Stores for a line on his
// laptop; his phone sees the job and the analyst's laptop sees the request at
// once; she buys it; the week resolves everywhere and the line is on hand.
// Requires:
//   firebase emulators:start --only firestore,auth --project demo-island
//   VITE_FB_API_KEY=demo-key VITE_FB_PROJECT_ID=demo-island VITE_FB_EMULATOR=127.0.0.1 npx vite --port 5174
//   BASE=http://localhost:5174 node scripts/e2e-online.mjs out-dir
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? 'e2e-online';
mkdirSync(out, { recursive: true });
const base = process.env.BASE ?? 'http://localhost:5174';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const laptop = { viewport: { width: 1280, height: 820 } };
const errors = [];

async function device(name, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  page.on('console', (m) => m.type() === 'error' && !/404|WebChannel|transport errored/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  let n = 0;
  const d = {
    page,
    name,
    shot: async (label) => {
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${out}/${name}-${String(++n).padStart(2, '0')}-${label}.png` });
    },
    click: async (label, o = {}) => {
      const b = page.getByRole('button', { name: label, exact: o.exact ?? false }).first();
      await b.waitFor({ state: 'visible', timeout: o.timeout ?? 8000 });
      await b.click();
      await page.waitForTimeout(o.wait ?? 250);
    },
    finishPuzzle: async () => {
      // a mechanic job on a plane opens its detail first (the manual), then Start
      await page.waitForTimeout(300);
      const start = page.locator('.sheet button:has-text("Start the job")');
      if (!(await page.locator('.phost-body').count()) && (await start.count())) await start.first().click();
      await page.waitForSelector('.phost-body', { timeout: 8000 });
      await page.waitForTimeout(400);
      if (await page.locator('.howto').count()) await page.locator('.howto').click();
      await page.waitForTimeout(250);
      await page.locator('.phost-body .pz').click({ position: { x: 12, y: 12 } });
      await d.click('Hand in', { exact: true });
      await d.click('Hand in now');
      await d.click('Continue', { wait: 400 });
    },
    week0: async (role) => {
      await d.click('Try a job', { timeout: 15000 });
      await d.click('Start', { exact: true });
      await d.finishPuzzle();
      if (role === 'fin') {
        await d.click('Approve', { exact: true });
        await d.click('Next: buy a part');
        await d.finishPuzzle();
      } else {
        // the job flow's walk-through: one scripted alert on a copy of the island (nothing is written)
        await d.click('Open the alert');
        if (!(await d.driveAlert())) throw new Error(`${name}: week 0's walk-through never reached Send`);
        await d.click('Next', { exact: true });
      }
      await d.click('Got it');
      await d.click('Finish week 0', { wait: 1200 });
    },
    sheet: () => page.locator('.jf-sheet').first(),
    /** the job flow's sheet, from wherever it opens to Send, at the teaching tier (a slot with no marked row isn't needed: back out) */
    driveAlert: async () => {
      const skipped = new Set();
      let slot = '';
      const sheet = d.sheet;
      for (let step = 0; step < 24; step++) {
        await page.waitForTimeout(300);
        const b = (label) => sheet().getByRole('button', { name: label });
        if (await b(/^Send ▸/).count()) {
          const label = (await b(/^Send ▸/).first().innerText()).trim();
          await b(/^Send ▸/).first().click();
          await page.waitForTimeout(900);
          return { label, banner: (await page.locator('.jf-sheet .jf-note.ok').first().innerText().catch(() => '')).trim() };
        }
        if (await b(/^Find the (task|procedure)/).count()) {
          await b(/^Find the (task|procedure)/).first().click();
          continue;
        }
        if (await b(/^Use this task/).count()) {
          await b(/^Use this task/).first().click();
          continue;
        }
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
        const likely = sheet().locator('.jf-row.likely');
        const rows = sheet().locator('.jf-row');
        if (await likely.count()) await likely.first().click();
        else if (await rows.count()) await rows.first().click();
        else break;
      }
      return null;
    },
    closeSheet: async () => {
      const x = page.locator('.jf-sheet .jf-x[aria-label="Close"]').first();
      if (await x.count()) await x.click();
      await page.waitForTimeout(300);
    },
    /** Stores (the tech's read-only stock): the first shelf row, or the one for a P/N */
    stores: async (pn) => {
      await page.locator('.jf-stores').first().scrollIntoViewIfNeeded();
      await page.locator('.jf-stores').first().click();
      await page.waitForTimeout(600);
      const rows = page.locator('.sheet .jf-inv-row', { has: page.locator('.jf-badge') });
      const row = pn ? rows.filter({ hasText: pn }).first() : rows.first();
      const text = (await row.innerText()).replace(/\n/g, ' | ');
      const m = /(\d+)(?: [a-z]+)? on hand/.exec(text);
      return { row, text, pn: text.split(' ')[0], on: m ? Number(m[1]) : 0 };
    },
    endTurn: async () => {
      await d.click('End turn', { wait: 400 });
      if (await page.locator('.sheet').count()) await page.locator('.sheet button', { hasText: 'End turn' }).click();
      await page.waitForTimeout(800);
    },
  };
  return d;
}

const fail = async (e) => {
  console.log('FAILED:', String(e).split('\n')[0]);
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  for (const d of all) await d.page.screenshot({ path: `${out}/zz-${d.name}-failure.png` }).catch(() => {});
  await browser.close();
  process.exit(1);
};
const all = [];
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);

// 1. Seb creates an online island as mechanic on his phone
const seb = await device('seb-phone', phone);
all.push(seb);
await seb.page.goto(base + '/');
await seb.page.getByPlaceholder('e.g. Seb').fill('Seb');
await seb.click('New island');
await seb.page.getByRole('radio', { name: '3 devices · online' }).click();
await seb.page.getByRole('radio', { name: /Mechanic/ }).click();
await seb.click('Found the island', { wait: 500 });
await seb.page.waitForURL(/#\/i\/\w+/, { timeout: 20000 });
const code = /#\/i\/(\w+)/.exec(seb.page.url())[1];
console.log('island code', code);
await seb.shot('created');

// 2. Mia joins as electrician (phone), Ravi as analyst (laptop) via the invite link
const mia = await device('mia-phone', phone);
const ravi = await device('ravi-laptop', laptop);
all.push(mia, ravi);
for (const [d, role, label] of [
  [mia, 'elec', 'Residential electrician'],
  [ravi, 'fin', 'FP&A analyst'],
]) {
  await d.page.goto(`${base}/#/join/${code}`);
  await d.page.getByPlaceholder('e.g. Seb').last().fill(d.name.startsWith('mia') ? 'Mia' : 'Ravi');
  await d.page.locator('.sheet button', { hasText: label }).first().click({ timeout: 15000 });
  await d.click('Join', { exact: true, wait: 2000 });
  await d.shot('joined');
  await d.week0(role);
}
await seb.week0('mech');
await seb.page.waitForTimeout(2500);
await seb.shot('week1');
await ravi.shot('week1-desk');

// 3. Seb links his laptop to the mechanic seat with the seat code
await seb.click('Me', { exact: true });
const seatCode = (await seb.page.locator('b.code').nth(1).innerText()).trim();
console.log('seat code', seatCode);
await seb.shot('me-seat-code');
const sebLaptop = await device('seb-laptop', laptop);
all.push(sebLaptop);
await sebLaptop.page.goto(`${base}/#/join/${code}`);
await sebLaptop.page.getByPlaceholder('e.g. Seb').last().fill('Seb');
await sebLaptop.page.locator('.sheet button', { hasText: 'A&P mechanic' }).first().click({ timeout: 15000 });
await sebLaptop.page.locator('.sheet input[maxlength="6"]').fill(seatCode);
await sebLaptop.click('Link this device', { wait: 2500 });
await sebLaptop.shot('linked');

// 4. Seb takes an alert through the job flow on the laptop, and asks Stores for a line; his phone sees the job
await sebLaptop.page.evaluate(() => window.scrollTo({ top: 0 }));
const row = sebLaptop.page.locator('.jf-your .jf-arow:not(:has(.jf-start)) .jf-arow-main').first();
await row.waitFor({ state: 'visible', timeout: 15000 });
const alertText = (await row.locator('.jf-arow-sym').innerText()).trim();
await row.click();
await sebLaptop.page.waitForTimeout(600);
const safe = sebLaptop.sheet().getByRole('button', { name: 'Make it safe' });
if (await safe.count()) {
  await safe.click();
  await sebLaptop.sheet().getByRole('button', { name: 'Breaker off and tag it' }).click();
}
const sent = await sebLaptop.driveAlert();
console.log(`laptop: "${alertText}" sent: ${JSON.stringify(sent)}`);
if (!sent) throw new Error('the laptop could not take the alert to Send');
await sebLaptop.shot('flow-sent');
await sebLaptop.closeSheet();
const asked = await sebLaptop.stores();
await asked.row.getByRole('button', { name: 'Request' }).click();
await sebLaptop.page.waitForTimeout(300);
await sebLaptop.page.locator('.sheet').getByRole('button', { name: /^Send the request/ }).click();
await sebLaptop.page.waitForTimeout(800);
await sebLaptop.page.keyboard.press('Escape');
console.log(`laptop: asked for 1 × ${asked.pn} (${asked.on} on hand)`);
await seb.click('Island', { exact: true });
await seb.page.waitForTimeout(2500);
// the phone's Your move / inbox no longer shows the alert as a new one: it has its job (or went to the analyst)
const phoneRows = await seb.page.locator('.jf-arow').allInnerTexts();
const moved = phoneRows.some((t) => t.includes(alertText) && /Ready|Start|approve|Parts|buy|Done|Card|wk \d/i.test(t)) || !phoneRows.some((t) => t.startsWith(alertText));
console.log(`the laptop's plan → visible on the phone: ${moved}`);
if (!moved) throw new Error("the phone didn't see the laptop's plan");
await seb.shot('phone-after-laptop-plan');

// 5. Ravi sees the request on his laptop at once, approves the cards (→ on a card) and buys the request
await ravi.page.waitForTimeout(1500);
await ravi.page.evaluate(() => document.getElementById('approvals')?.scrollIntoView());
const desk = await ravi.page.locator('.pdesk').first().innerText();
console.log(`request for ${asked.pn} on the analyst's desk: ${desk.includes(asked.pn)}`);
if (!desk.includes(asked.pn)) throw new Error(`the analyst's desk doesn't show the request for ${asked.pn}`);
await ravi.shot('request-on-desk');
if (await ravi.page.getByRole('button', { name: /^Approve \$/ }).count()) {
  await ravi.page.keyboard.press('ArrowRight');
  await ravi.page.waitForTimeout(1500);
}
const buy = ravi.page.getByRole('button', { name: /^Approve \d+ ·/ });
if (!(await buy.count())) throw new Error('no Approve button for the request');
await buy.first().click();
await ravi.page.waitForTimeout(1500);
await ravi.shot('after-approvals');

// 6. Everyone ends their turn → week resolves on every device
await ravi.endTurn();
await mia.endTurn();
await sebLaptop.endTurn();
await seb.page.waitForTimeout(3500);
const reviews = await Promise.all([seb, mia, ravi, sebLaptop].map((d) => d.page.getByText('Board review').count()));
console.log('review visible on [seb-phone, mia, ravi, seb-laptop]:', reviews.map((c) => c > 0));
for (const d of [seb, mia, ravi, sebLaptop]) await d.shot('review');

// 7. Week 2: the line the analyst bought landed at the resolve, and Seb's phone shows it on hand
for (const d of [seb]) {
  if (await d.page.getByRole('button', { name: 'Onward' }).count()) await d.click('Onward');
  if (await d.page.locator('.overlay button[aria-label="Close"]').count()) await d.page.locator('.overlay button[aria-label="Close"]').first().click();
}
await seb.page.waitForTimeout(800);
const landed = await seb.stores(asked.pn);
console.log(`week 2 on the phone: ${asked.pn} ${asked.on} → ${landed.on} on hand`);
if (landed.on <= asked.on) throw new Error(`the request for ${asked.pn} didn't land (${landed.text})`);
await seb.shot('week2-stores');

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
