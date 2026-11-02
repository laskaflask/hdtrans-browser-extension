#!/usr/bin/env node
// Checks that a store ships this source: downloads the package the Chrome Web Store or Firefox
// Add-ons (AMO) serves, builds the v<version> tag of this repository in a clean folder, and compares
// them file by file. The stores sign the package (Chrome adds _metadata/, AMO adds META-INF/) and
// rewrite manifest.json (AMO re-serializes it, Chrome adds update_url), so manifest.json is compared
// as JSON without those changes; every other file must match byte for byte.
//
//   node scripts/verify-store.mjs chrome|firefox [--version <version>] [--build <dir>]
//
// --version  the AMO version to check (default: the current one). The Chrome Web Store serves only
//            its current version.
// --build    compare with this build output (.output/chrome-mv3 or .output/firefox-mv3) instead of
//            building the tag. Building needs git, tar, Node.js 22+ and npm 11, and the tag
//            (git fetch --tags).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { inflateRawSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const CHROME_ID = 'bcdkkloifhaoahiekaahepkmkhfaafcd';
const GECKO_ID = 'hdtrans-ja-ko@hdtrans-browser-extension';

const stores = {
  chrome: {
    async download(version) {
      const query = encodeURIComponent(`id=${CHROME_ID}&uc`);
      const crx = await fetchBytes(
        `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=150.0.0.0&acceptformat=crx3&x=${query}`,
      );
      const served = JSON.parse(readZip(crx).get('manifest.json')).version;
      if (version && version !== served) fail(`the Chrome Web Store serves only its current version, ${served}`);
      return crx;
    },
    signature: '_metadata/',
    output: 'chrome-mv3',
    build: 'build',
    manifest: ({ update_url, ...manifest }) => manifest,
  },
  firefox: {
    async download(version) {
      const api = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(GECKO_ID)}/`;
      const { file } = version ? await fetchJson(`${api}versions/${version}/`) : (await fetchJson(api)).current_version;
      const xpi = await fetchBytes(file.url);
      const [algorithm, hash] = file.hash.split(':');
      if (createHash(algorithm).update(xpi).digest('hex') !== hash) fail(`${file.url} does not match its hash on AMO`);
      return xpi;
    },
    signature: 'META-INF/',
    output: 'firefox-mv3',
    build: 'build:firefox',
    manifest: (manifest) => manifest,
  },
};

function fail(message) {
  console.error(`verify-store: ${message}`);
  process.exit(2);
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) fail(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchJson(url) {
  return JSON.parse((await fetchBytes(url)).toString('utf8'));
}

/** The files of a zip (or of a CRX, a zip after a header), by path. */
function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) fail('the package is not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  // Offsets count from the start of the zip, which a CRX header pushes back.
  const base = eocd - cdSize - buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0, p = eocd - cdSize; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLength = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
    const local = base + buf.readUInt32LE(p + 42);
    p += 46 + nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (name.endsWith('/')) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method !== 0 && method !== 8) fail(`${name}: unsupported compression method ${method}`);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
  }
  return files;
}

/** The files of a folder, by path with / separators. */
function readFolder(dir) {
  const files = new Map();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    files.set(relative(dir, file).split(sep).join('/'), readFileSync(file));
  }
  return files;
}

/** Builds the v<version> tag in a new folder; returns the folder. */
function buildTag(version, store) {
  const dir = mkdtempSync(join(tmpdir(), 'hdtrans-verify-'));
  console.log(`building v${version} in ${dir}`);
  const tar = execFileSync('git', ['-C', root, 'archive', `v${version}`], { maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  // The build of the stores, without the E2E host permission.
  const { HDTRANS_E2E, ...env } = process.env;
  for (const args of [['ci'], ['run', store.build]]) {
    execFileSync('npm', args, { cwd: dir, env, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
  }
  return dir;
}

/** Differences between the store package and the build, as lines to print. */
function compare(store, pkg, built) {
  const problems = [];
  for (const [path, data] of pkg) {
    if (path.startsWith(store.signature)) continue;
    const ours = built.get(path);
    if (!ours) {
      problems.push(`only in the store package: ${path}`);
    } else if (path === 'manifest.json') {
      const theirs = store.manifest(JSON.parse(data.toString('utf8')));
      const mine = JSON.parse(ours.toString('utf8'));
      for (const key of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
        if (!isDeepStrictEqual(theirs[key], mine[key])) problems.push(`manifest.json: "${key}" differs`);
      }
    } else if (!data.equals(ours)) {
      problems.push(`differs: ${path}`);
    }
  }
  for (const path of built.keys()) if (!pkg.has(path)) problems.push(`only in the build: ${path}`);
  return problems;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { version: { type: 'string' }, build: { type: 'string' } },
});
const store = stores[positionals[0]];
if (!store || positionals.length !== 1) fail('usage: verify-store.mjs chrome|firefox [--version <version>] [--build <dir>]');

const pkg = readZip(await store.download(values.version));
const version = JSON.parse(pkg.get('manifest.json')).version;
console.log(`${positionals[0]} store package: ${version}`);
const tagDir = values.build ? undefined : buildTag(version, store);
const built = readFolder(values.build ?? join(tagDir, '.output', store.output));
const problems = compare(store, pkg, built);

if (problems.length) {
  for (const line of problems) console.log(line);
  console.log(`✗ the store package of ${version} does not match the build${tagDir ? ` (kept in ${tagDir})` : ''}`);
  process.exitCode = 1;
} else {
  if (tagDir) rmSync(tagDir, { recursive: true, force: true });
  const count = [...pkg.keys()].filter((path) => !path.startsWith(store.signature)).length;
  console.log(`✓ the store package of ${version} matches the build: ${count} files, apart from the store's ${store.signature} and manifest.json changes`);
}
