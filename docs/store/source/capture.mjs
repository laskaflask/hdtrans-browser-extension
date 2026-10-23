// Captures the raw shots for the store screenshots with the real extension.
import { chromium } from 'playwright';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const [build, out] = process.argv.slice(2);
const HOST = 'tabi-note.example.jp';
// A copy of the build that may open the demo host (browser automation cannot grant activeTab).
const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'hdtrans-ext-'));
fs.cpSync(build, ext, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(`${ext}/manifest.json`, 'utf8'));
manifest.host_permissions = [...(manifest.host_permissions ?? []), `http://${HOST}/*`];
fs.writeFileSync(`${ext}/manifest.json`, JSON.stringify(manifest));
const html = fs.readFileSync(new URL('./demo.html', import.meta.url));
const server = http.createServer((_q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(html); });
await new Promise((ok) => server.listen(0, ok));
const url = `http://${HOST}:${server.address().port}/kyoto/arashiyama-autumn`;

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pw-')), {
  channel: 'chromium', headless: true, executablePath: process.env.CHROMIUM,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--host-resolver-rules=MAP ${HOST} 127.0.0.1`],
  viewport: { width: 1100, height: 720 }, deviceScaleFactor: 2,
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const id = new URL(sw.url()).host;

await sw.evaluate(() => chrome.storage.local.set({
  dictRules: [
    { id: 'travel', name: '여행 블로그', enabled: true, matchType: 'host', pattern: 'tabi-note.example.jp', entries: [
      { ja: 'こもれび茶房', ko: '코모레비 찻집', pos: 'name' },
      { ja: '旅のノート', ko: '여행 노트', pos: 'n' },
      { ja: '嵯峨野トロッコ列車', ko: '사가노 토롯코 열차', pos: 'name' },
    ] },
    { id: 'common', name: '공통 용어', enabled: true, matchType: 'all', pattern: '', entries: [
      { ja: '抹茶パフェ', ko: '말차 파르페', pos: 'n' },
    ] },
  ],
}));
const setSettings = (patch) => sw.evaluate((patch) => chrome.storage.local.get('settings').then(({ settings }) =>
  chrome.storage.local.set({ settings: { speech: 'strict', translateAttributes: true, observeMutations: true, showProgress: true, bilingual: false, ...settings, ...patch } })), patch);
const send = (type) => sw.evaluate(async ([type, host]) => {
  const [tab] = await chrome.tabs.query({ url: `http://${host}/*` });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/translator.js'] });
  return chrome.tabs.sendMessage(tab.id, { type }, { frameId: 0 });
}, [type, HOST]);
const state = () => send('get-state').then((s) => s.state);
const settle = async () => {
  for (let i = 0; i < 100 && (await state()) !== 'translated'; i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 400));
};

const page = await ctx.newPage();
await page.goto(url);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `${out}/original.png` });

await setSettings({ bilingual: false });
await send('translate-page');
await settle();
await page.screenshot({ path: `${out}/translated.png` });

// The popup, pointed at the demo tab (opened as a page it would see itself as the active tab).
const popup = await ctx.newPage();
await popup.setViewportSize({ width: 300, height: 400 });
await popup.addInitScript((host) => {
  const query = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = () => query({ url: `http://${host}/*` });
}, HOST);
await popup.goto(`chrome-extension://${id}/popup.html`);
await popup.waitForSelector('.switch');
await popup.waitForTimeout(300);
await popup.locator('main').screenshot({ path: `${out}/popup.png` });
await popup.close();

await send('restore-page');
await setSettings({ bilingual: true });
await page.bringToFront();
await send('translate-page');
await settle();
await page.screenshot({ path: `${out}/bilingual.png` });
// Without the illustration, more of the paired text fits in the shot.
await page.addStyleTag({ content: 'figure { display: none; }' });
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/bilingual-text.png` });

const options = await ctx.newPage();
await options.setViewportSize({ width: 1100, height: 900 });
await options.goto(`chrome-extension://${id}/options.html`);
await options.waitForSelector('.rule-item');
await options.waitForTimeout(800);
await options.screenshot({ path: `${out}/options.png` });
// The dictionary editor alone: the settings above it are left out of this shot.
await options.evaluate(() => {
  for (const h of document.querySelectorAll('h2')) if (h.textContent.includes('번역 설정')) h.closest('section').style.display = 'none';
});
await options.waitForTimeout(200);
await options.screenshot({ path: `${out}/options-dict.png` });

await ctx.close();
server.close();
