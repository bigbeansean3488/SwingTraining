// Shared helpers for headless browser checks against the system Chrome.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from './serve.mjs';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

export async function openApp({ headless = true } = {}) {
  const executablePath = CANDIDATES.find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error('No Chrome/Edge found; set CHROME_PATH');
  const server = await startServer(0);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await puppeteer.launch({
    executablePath,
    headless,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(base, { waitUntil: 'load' });
  const close = async () => { await browser.close(); server.close(); };
  return { page, browser, base, logs, close };
}

/** Start a practice session so the capture UI is available. */
export async function startSession(page, name = 'Check') {
  await page.waitForFunction(() => window.__appReady === true, { timeout: 30000 });
  if (await page.evaluate(() => !!window.__app.session)) return;
  await page.type('#player-name', name);
  await page.click('#start-session');
  await page.waitForFunction(() => !!window.__app.session);
}
