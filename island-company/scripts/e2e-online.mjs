// Online playtest against the Firebase emulators: three players on separate
// devices (two phones + a laptop), plus the mechanic linking a second device
// with the seat code and seeing the same seat. Requires:
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
      } else {
        await page.waitForTimeout(1800);
        await d.click('Do the job');
      }
      await d.finishPuzzle();
      await d.click('Got it');
      await d.click('Finish week 0', { wait: 1200 });
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

// 4. Seb does a job on the laptop; the phone sees it
const job = sebLaptop.page.locator('.order.ready').first();
const jobTitle = (await job.locator('b').first().innerText()).trim();
await job.click();
await sebLaptop.finishPuzzle();
await sebLaptop.page.waitForTimeout(1500);
await seb.click('Island', { exact: true });
await seb.page.waitForTimeout(2500);
const phoneSeesDone = await seb.page.locator('.order.done', { hasText: jobTitle }).count();
console.log(`job "${jobTitle}" done on laptop → visible on phone: ${phoneSeesDone > 0}`);
await seb.shot('phone-after-laptop-job');

// 5. Ravi approves on the laptop with the keyboard (→)
await ravi.page.keyboard.press('ArrowRight');
await ravi.page.waitForTimeout(1500);
await ravi.shot('after-keyboard-approve');

// 6. Everyone ends their turn → week resolves on every device
await ravi.endTurn();
await mia.endTurn();
await sebLaptop.endTurn();
await seb.page.waitForTimeout(3500);
const reviews = await Promise.all([seb, mia, ravi, sebLaptop].map((d) => d.page.getByText('Board review').count()));
console.log('review visible on [seb-phone, mia, ravi, seb-laptop]:', reviews.map((c) => c > 0));
for (const d of [seb, mia, ravi, sebLaptop]) await d.shot('review');

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
