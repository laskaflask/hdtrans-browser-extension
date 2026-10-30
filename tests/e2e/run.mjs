// Runs the built extension in real browsers: translates page.html, restores it, and saves a user
// dictionary with a bad row on the options page. Chrome is driven over CDP, Firefox over WebDriver
// BiDi, both with puppeteer-core and a locally installed browser.
//
//   npm run build:all && node tests/e2e/run.mjs [chrome] [firefox]
//
// CHROMIUM, FIREFOX: browser executables (default: found on PATH and in the usual install folders).
// E2E_OUT: a folder to save a screenshot of each translated page in.
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const HOST = 'e2e.example.jp';
const FIREFOX_UUID = '5f0e7d2c-1a3b-4c5d-8e9f-0a1b2c3d4e5f';
// Good row first, then a row with an unknown POS: the engine skips only the bad row.
const DICTIONARY = [
  { ja: '東京', ko: '도오쿄오', pos: 'name' },
  { ja: '空', ko: '하늘님', pos: 'zzz' },
];

const EXPECTED = {
  inline: '유키 씨는 마도구를 썼다.',
  link: '자세하게는 이쪽을 봐 주세요.',
  ruby: '유키 씨는 [희롱하도록 ]마도구를 썼다.',
  letters: '이것은, 그런 스토리다.',
  dict: '도오쿄오의 하늘은 푸르다.',
  code: '今日は',
  alt: '아름다운 꽃',
};

function findExecutable(env, names, folders) {
  if (process.env[env]) return process.env[env];
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), ...folders];
  for (const dir of dirs) {
    for (const name of names) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) return file;
    }
  }
  throw new Error(`${env}: no ${names[0]} found; set ${env} to the browser executable`);
}

function chromiumPath() {
  // The Chromium that Playwright installs (preinstalled in Claude Code cloud sessions).
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  const folders = fs.existsSync(pw)
    ? fs.readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).map((d) => path.join(pw, d, 'chrome-linux64'))
    : [];
  return findExecutable('CHROMIUM', ['chromium', 'chromium-browser', 'chrome'], folders);
}

function firefoxPath() {
  return findExecutable('FIREFOX', ['firefox'], ['/opt/firefox', '/Applications/Firefox.app/Contents/MacOS']);
}

/** A copy of the build that may open the test host (browser automation cannot grant activeTab).
 *  `pages` are made reachable from the test host, for browsers that cannot be sent to them. */
function extensionCopy(build, pages = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdtrans-e2e-'));
  fs.cpSync(build, dir, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  manifest.host_permissions = [...(manifest.host_permissions ?? []), `http://${HOST}/*`];
  if (pages.length) {
    manifest.web_accessible_resources = [
      ...(manifest.web_accessible_resources ?? []),
      { resources: pages, matches: [`http://${HOST}/*`] },
    ];
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return { dir, manifest };
}

/** Launches the browser with the extension; returns it with a way to open extension pages. */
const browsers = {
  async chrome() {
    const { dir } = extensionCopy(path.join(root, '.output/chrome-mv3'));
    const browser = await puppeteer.launch({
      browser: 'chrome', executablePath: chromiumPath(), headless: true, enableExtensions: [dir],
      // Chromium has no sandbox for root (containers, CI).
      args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`, ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
    });
    const worker = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'));
    const id = new URL(worker.url()).host;
    const openPage = async (file) => {
      const page = await browser.newPage();
      await page.goto(`chrome-extension://${id}/${file}`);
      return page;
    };
    return { browser, openPage };
  },

  async firefox(url) {
    const pages = ['popup.html', 'options.html'];
    const { dir, manifest } = extensionCopy(path.join(root, '.output/firefox-mv3'), pages);
    const browser = await puppeteer.launch({
      browser: 'firefox', executablePath: firefoxPath(), headless: true,
      // Newer Firefox runs scripts in moz-extension:// pages only with system access.
      args: ['--remote-allow-system-access'],
      env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
      extraPrefsFirefox: {
        'extensions.webextensions.uuids': JSON.stringify({ [manifest.browser_specific_settings.gecko.id]: FIREFOX_UUID }),
        'network.dns.localDomains': HOST,
        'extensions.originControls.grantByDefault': true,
      },
    });
    await browser.installExtension(dir);
    // BiDi refuses to navigate to moz-extension:// pages, so the test page links to them.
    const openPage = async (file) => {
      const page = await browser.newPage();
      await page.goto(url);
      const to = `moz-extension://${FIREFOX_UUID}/${file}`;
      await page.evaluate((to) => { location.href = to; }, to);
      // Puppeteer reports no navigation into an extension page, so its arrival is polled.
      await until(page, (to) => location.href === to && document.readyState === 'complete', to, `${file} to open`);
      return page;
    };
    return { browser, openPage };
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `fn` in the page until it is true. Unlike page.waitForFunction, this follows the page
 *  into extension pages that Firefox navigated to without Puppeteer noticing. */
async function until(page, fn, arg, what, ms = 30_000) {
  for (const end = Date.now() + ms; !(await page.evaluate(fn, arg).catch(() => false)); await sleep(100)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
  }
}

async function run(name, url) {
  const { browser, openPage } = await browsers[name](url);
  const errors = [];
  const watch = (page, label) => {
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message ?? e}`));
    page.on('console', (msg) => msg.type() === 'error' && errors.push(`${label}: ${msg.text()}`));
  };
  try {
    // An extension page stands in for the background: it has the same extension APIs.
    const control = await openPage('popup.html');
    watch(control, 'popup');
    await control.evaluate((entries) => (globalThis.browser ?? chrome).storage.local.set({
      dictRules: [{ id: 'e2e', name: 'e2e', enabled: true, matchType: 'all', pattern: '', entries }],
    }), DICTIONARY);

    const page = await browser.newPage();
    watch(page, 'page');
    await page.goto(url);
    const send = (type) => control.evaluate(async (type, host) => {
      const api = globalThis.browser ?? chrome;
      const [tab] = await api.tabs.query({ url: `http://${host}/*` });
      await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/translator.js'] });
      return api.tabs.sendMessage(tab.id, { type }, { frameId: 0 });
    }, type, HOST);
    const read = () => page.evaluate(() => {
      const values = Object.fromEntries([...document.querySelectorAll('[id]')].map((e) => [e.id, e.textContent]));
      // Ruby text marked off with brackets, to see which node took the translation.
      values.ruby = [...document.querySelector('#ruby').childNodes]
        .map((n) => (n.nodeName === 'RUBY' ? `[${n.textContent}]` : n.textContent)).join('');
      values.alt = document.querySelector('#img').alt;
      delete values.img;
      return values;
    });

    const original = await read();
    await send('translate-page');
    for (let i = 0; (await send('get-state')).state !== 'translated'; i++) {
      if (i === 300) throw new Error('the page was not translated in 30 s');
      await sleep(100);
    }
    const translated = await read();
    if (process.env.E2E_OUT) {
      fs.mkdirSync(process.env.E2E_OUT, { recursive: true });
      await page.screenshot({ path: path.join(process.env.E2E_OUT, `${name}.png`) });
    }
    const { mark, ...rest } = translated;
    assert.deepEqual(rest, EXPECTED);
    // Page text holding the boundary mark is translated line by line and keeps the mark.
    assert.match(mark, /^[^぀-ヿ一-鿿]*‖[^぀-ヿ一-鿿]*$/u);
    assert.match(mark, /[가-힣]/);

    await send('restore-page');
    await sleep(300);
    assert.deepEqual(await read(), original, 'restore brings back the original text');

    // Saving the dictionary reports the row the engine could not read.
    const options = await openPage('options.html');
    watch(options, 'options');
    await until(options, () => {
      const save = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '저장');
      save?.click();
      return !!save;
    }, undefined, 'the save button');
    await until(options, () => document.body.innerText.includes('저장했습니다'), undefined, 'the dictionary to be saved');
    assert.match(await options.evaluate(() => document.body.innerText), /2번째 행: unknown POS "zzz"/);

    assert.deepEqual(errors, [], 'no errors in the page or extension pages');
  } finally {
    await browser.close();
  }
}

const names = process.argv.slice(2);
for (const name of names) if (!browsers[name]) throw new Error(`unknown browser: ${name} (chrome, firefox)`);
const html = fs.readFileSync(path.join(import.meta.dirname, 'page.html'));
const server = http.createServer((_req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://${HOST}:${server.address().port}/`;
let failed = false;
for (const name of names.length ? names : Object.keys(browsers)) {
  try {
    await run(name, url);
    console.log(`✓ ${name}`);
  } catch (e) {
    failed = true;
    console.error(`✗ ${name}\n${e.stack ?? e}`);
  }
}
server.close();
process.exitCode = failed ? 1 : 0;
