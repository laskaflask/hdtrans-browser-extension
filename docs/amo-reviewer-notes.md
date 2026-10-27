# AMO 검토자 메모

Firefox 애드온(AMO)에 제출할 때 "Notes to Reviewer" 칸에 붙여 넣는 글입니다. 검토자가 읽으므로 영어로 씁니다.
버전, linter 결과, 빌드 방법이 바뀌면 같이 고칩니다. 아래 경고 위치는 `npx web-ext lint -s .output/firefox-mv3`
결과입니다.

---

**What it does.** Translates Japanese web pages into Korean on request (page action popup or context
menu). Translation runs entirely inside the extension with the open-source hdTrans engine
(https://github.com/sokcuri/hdTrans, MPL-2.0) compiled to WebAssembly. No page text or other data
leaves the browser, and nothing is fetched from the network: the engine and its dictionary are
packaged in the extension (`hdtrans/`). The manifest declares `data_collection_permissions: none`.

**Permissions.** `activeTab` + `scripting`: the page script is injected only into the tab the user
asks to translate (no host permissions). `contextMenus`: "translate page" / "restore" menu items.
`storage`: settings and the user's own dictionaries, stored locally.

**Source code.** The uploaded source package builds the extension with `npm ci && npm run build:firefox`
(Node.js 22+, npm 11, any OS); the result in `.output/firefox-mv3/` matches the submitted file
byte for byte (checked with Node 24.22 / npm 11.21). See "Firefox 애드온(AMO) 제출용 소스" in README.md.

- `hdtrans/hdtrans_engine.js`, `hdtrans/hdtrans_engine.wasm` are built from the hdTrans release tag
  matching the `hdtrans` npm version (v0.4.4) by `scripts/build-engine.sh` with Emscripten 4.0.22 and
  `-sDYNAMIC_EXECUTION=0` (so the engine creates no code at run time, as extension CSPs require).
  The build is reproducible; `vendor/hdtrans/BUILD.txt` records the inputs.
- `hdtrans/runtime.js`, `hdtrans/dicts.hdsnap` (dictionary data, ~37 MB) and `hdtrans/dicts.txt` are
  copied unmodified from the `hdtrans` npm package (version and integrity in `package-lock.json`).

**Linter warnings (3 × UNSAFE_VAR_ASSIGNMENT, "Unsafe call to import").**

- `background.js` line 2 (two warnings): `lib/engine.ts` → `extensionFiles()` loads
  `hdtrans/runtime.js` and `hdtrans/hdtrans_engine.js` with `import()`. The specifier is the
  extension's own origin (`new URL('/hdtrans/', location.origin)`) plus a fixed file name, so only
  files packaged in the extension are imported.
- `hdtrans/runtime.js` line 20: unmodified hdTrans runtime. It imports the fixed path
  `./hdtrans_engine.js` only when no engine module is passed in; the extension always passes one
  (`lib/engine.ts` → `Engine.load`), so this path is not taken.
