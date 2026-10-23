// Keeps the engine alive between translations (MV3 service workers stop when idle) and relays
// requests to the sandboxed engine page in its iframe. The sandbox cannot fetch extension files
// (its origin is opaque), so the wasm and dictionary bytes are read here and handed over.
import type { OffscreenRequest, OffscreenResponse, SandboxInit } from '@/lib/messages';

const frame = document.createElement('iframe');
frame.src = '/engine.html';
document.body.append(frame);

let nextId = 1;
const pending = new Map<number, (response: OffscreenResponse) => void>();

const sandboxReady = new Promise<void>((resolve) => {
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== frame.contentWindow) return;
    if (ev.data?.type === 'sandbox-ready') {
      resolve();
      return;
    }
    const done = pending.get(ev.data?.id);
    if (!done) return;
    pending.delete(ev.data.id);
    done(ev.data.response);
  });
});

const initialized = (async () => {
  // Files added in wxt.config.ts are not in WXT's typed public paths.
  const base = new URL('/hdtrans/', location.origin).href;
  const bytes = (file: string) => fetch(base + file).then((r) => r.arrayBuffer());
  const [wasm, snapshot, version] = await Promise.all([
    bytes('hdtrans_engine.wasm'),
    bytes('dicts.hdsnap'),
    fetch(`${base}dicts.txt`).then((r) => r.text()),
  ]);
  await sandboxReady;
  const init: SandboxInit = { type: 'init', wasm, snapshot, version };
  frame.contentWindow!.postMessage(init, '*', [init.wasm, init.snapshot]);
})();

async function relay(request: OffscreenRequest): Promise<OffscreenResponse> {
  await initialized;
  const id = nextId++;
  const { target: _, ...engineRequest } = request;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    frame.contentWindow!.postMessage({ id, request: engineRequest }, '*');
  });
}

browser.runtime.onMessage.addListener((msg: OffscreenRequest, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  relay(msg).then(sendResponse, (error) => sendResponse({ error: String(error) } satisfies OffscreenResponse));
  return true;
});
