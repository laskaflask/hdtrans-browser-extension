import { resolve } from 'node:path';
import { defineConfig } from 'wxt';

// Copied into the extension's hdtrans/ folder as-is (not bundled). The engine is our build
// without run-time code generation (scripts/build-engine.sh); the runtime wrapper and the
// dictionary come from the hdtrans npm package of the same version.
const vendorDir = resolve(import.meta.dirname, 'vendor/hdtrans');
const hdtransDist = resolve(import.meta.dirname, 'node_modules/hdtrans/dist');
const ENGINE_FILES = [
  ...['hdtrans_engine.js', 'hdtrans_engine.wasm'].map((file) => resolve(vendorDir, file)),
  ...['runtime.js', 'dicts.hdsnap', 'dicts.txt'].map((file) => resolve(hdtransDist, file)),
];

export default defineConfig({
  // Firefox is a required target, built as MV3 like Chrome.
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'hdTrans 일본어 번역',
    description: 'hdTrans WebAssembly 엔진으로 일본어 웹 페이지를 한국어로 번역합니다. 번역은 모두 브라우저 안에서 합니다.',
    // Chrome hosts the engine in an offscreen document; Firefox in its background page.
    permissions: ['contextMenus', 'storage', 'activeTab', 'scripting', ...(browser === 'firefox' ? [] : ['offscreen'])],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    commands: {
      'toggle-translation': {
        suggested_key: { default: 'Alt+Shift+T' },
        description: '페이지 번역 / 원래대로',
      },
    },
    ...(browser === 'firefox' && {
      page_action: {
        show_matches: ['http://*/*', 'https://*/*', 'file://*/*'],
      },
      browser_specific_settings: {
        gecko: {
          id: 'hdtrans-ja-ko@hdtrans-browser-extension',
          strict_min_version: '128.0',
          // Nothing leaves the browser: translation and dictionaries are local.
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
  // Types only; the runtime is loaded from the copied files (bundling it would also bundle
  // the npm package's engine, which it imports). The package's main entry imports node:fs.
  alias: { 'hdtrans-runtime': resolve(hdtransDist, 'runtime') },
  hooks: {
    // WXT turns the runtime content script's matches into host_permissions. The script is
    // injected with activeTab on a menu, popup or shortcut action, so no site access is asked for.
    'build:manifestGenerated': (_wxt, manifest) => {
      delete manifest.host_permissions;
      // Browser automation cannot grant activeTab; end-to-end test builds get localhost instead.
      if (process.env.HDTRANS_E2E) manifest.host_permissions = ['http://localhost/*'];
    },
    'build:publicAssets': (_wxt, files) => {
      for (const file of ENGINE_FILES) {
        files.push({ absoluteSrc: file, relativeDest: `hdtrans/${file.split('/').pop()}` });
      }
    },
  },
});
