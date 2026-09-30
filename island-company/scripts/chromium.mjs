// Where the scripts' Chromium lives: $CHROMIUM_PATH, else the cloud container's
// /opt/pw-browsers/chromium, else Playwright's own (npx playwright@1.56 install chromium).
import { existsSync } from 'node:fs';

export const executablePath =
  process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
