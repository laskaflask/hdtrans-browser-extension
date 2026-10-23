// Chrome only: keeps the engine loaded between translations, since MV3 service workers are
// stopped when idle and have no DOM. Firefox runs the engine in its background page instead.
import { extensionFiles, lazyEngine } from '@/lib/engine';
import type { EngineResponse, OffscreenRequest } from '@/lib/messages';

const engine = lazyEngine(extensionFiles);

browser.runtime.onMessage.addListener((msg: OffscreenRequest, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return;
  const { target: _, ...request } = msg;
  engine(request).then(sendResponse, (error) => sendResponse({ error: String(error) } satisfies EngineResponse));
  return true;
});
