import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

// The engine, its wasm and the compiled dictionary come from the hdtrans npm package
// and are copied into the extension as-is (not bundled).
const ENGINE_FILES = ['runtime.js', 'hdtrans_engine.js', 'hdtrans_engine.wasm', 'dicts.hdsnap', 'dicts.txt'];
const hdtransDist = resolve(import.meta.dirname, 'node_modules/hdtrans/dist');

export default defineConfig({
  manifest: {
    name: 'hdTrans 일본어 번역',
    description: 'hdTrans WebAssembly 엔진으로 일본어 웹 페이지를 한국어로 번역합니다. 번역은 모두 브라우저 안에서 합니다.',
    permissions: ['contextMenus', 'storage', 'offscreen', 'activeTab', 'scripting'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    commands: {
      'toggle-translation': {
        suggested_key: { default: 'Alt+Shift+T' },
        description: '페이지 번역 / 원래대로',
      },
    },
  },
  // Types only: the offscreen document loads runtime.js from the copied files, since bundling it
  // would also bundle the engine it imports. (The package's main entry imports node:fs.)
  alias: { 'hdtrans-runtime': resolve(hdtransDist, 'runtime') },
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      for (const file of ENGINE_FILES) {
        files.push({ absoluteSrc: resolve(hdtransDist, file), relativeDest: `hdtrans/${file}` });
      }
    },
  },
});
