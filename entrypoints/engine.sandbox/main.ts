// Runs the hdTrans WebAssembly engine. Its embind glue builds functions with `new Function`,
// which the extension-page CSP forbids, so it lives in this sandboxed page (framed by the
// offscreen document). A sandboxed page has no extension APIs; it talks only to its parent.
import type { HdTrans, WasmModule } from 'hdtrans-runtime';
import type { EngineRequest, OffscreenResponse, SandboxInit } from '@/lib/messages';

interface EngineModule extends WasmModule {
  FS: { writeFile(path: string, data: Uint8Array): void };
}

let translatorPromise: Promise<HdTrans> | undefined;
let resolveInit: (init: SandboxInit) => void;
const initReceived = new Promise<SandboxInit>((resolve) => (resolveInit = resolve));
let loadedUserDict = '';

async function loadTranslator(): Promise<HdTrans> {
  const { wasm, snapshot, version } = await initReceived;
  const base = new URL('/hdtrans/', location.href).href;
  const [{ HdTrans }, { default: create }] = await Promise.all([
    import(/* @vite-ignore */ `${base}runtime.js`) as Promise<typeof import('hdtrans-runtime')>,
    import(/* @vite-ignore */ `${base}hdtrans_engine.js`),
  ]);
  const module: EngineModule = await create({ wasmBinary: new Uint8Array(wasm) });
  module.FS.writeFile('/dicts.hdsnap', new Uint8Array(snapshot));
  module.FS.writeFile('/dicts.txt', new TextEncoder().encode(version));
  return HdTrans.init({ module, directories: ['/dicts.hdsnap'] });
}

function translator(): Promise<HdTrans> {
  translatorPromise ??= loadTranslator();
  return translatorPromise;
}

function applyUserDict(t: HdTrans, userDict: string): string {
  if (userDict !== loadedUserDict) {
    t.setUserDictRaw(userDict);
    loadedUserDict = userDict;
  }
  return t.userDictError.replace(/^userdict\.tsv:/gm, '');
}

async function handle(msg: EngineRequest): Promise<OffscreenResponse> {
  const t = await translator();
  switch (msg.type) {
    case 'info':
      return { info: { version: t.version, dictionaryVersion: t.dictionaryVersion } };
    case 'check-userdict': {
      // Validate against the same engine, then put back the dictionary in use.
      const previous = loadedUserDict;
      const warning = applyUserDict(t, msg.userDict);
      applyUserDict(t, previous);
      return { userDictWarning: warning };
    }
    case 'translate': {
      const userDictWarning = applyUserDict(t, msg.userDict);
      t.setSpeech(msg.speech);
      // One batch is one session: names and context carry between its lines.
      t.reset();
      const out = t.translate(msg.lines.join('\n')).split('\n');
      if (out.length === msg.lines.length) return { lines: out, userDictWarning };
      // The engine keeps the line count in practice; fall back to line by line if not.
      return {
        lines: msg.lines.map((line) => {
          t.reset();
          return t.translate(line);
        }),
        userDictWarning,
      };
    }
  }
}

window.addEventListener('message', (ev: MessageEvent) => {
  if (ev.source !== window.parent) return;
  const data = ev.data;
  if (data?.type === 'init') {
    resolveInit(data as SandboxInit);
    return;
  }
  if (typeof data?.id !== 'number') return;
  handle(data.request as EngineRequest).then(
    (response) => window.parent.postMessage({ id: data.id, response }, '*'),
    (error) => window.parent.postMessage({ id: data.id, response: { error: String(error) } }, '*'),
  );
});

window.parent.postMessage({ type: 'sandbox-ready' }, '*');
