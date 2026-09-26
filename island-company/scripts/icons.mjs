// Render PNG app icons from public/icons/icon.svg (run once; outputs are committed).
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
for (const [size, name, pad] of [
  [192, 'icon-192.png', 0],
  [512, 'icon-512.png', 0],
  [512, 'maskable-512.png', 0.12],
  [180, 'apple-touch-icon.png', 0],
]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(
    `<html><body style="margin:0;background:#1F5E72;display:grid;place-items:center;width:${size}px;height:${size}px">` +
      `<div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  await page.screenshot({ path: `public/icons/${name}` });
}
await browser.close();
console.log('icons written');
