// Messages between the page, the background and the offscreen engine document.

export interface EngineInfo {
  version: string;
  dictionaryVersion: string;
}

/** content script → background */
export type BackgroundRequest = { type: 'translate-batch'; lines: string[] } | { type: 'page-state'; state: PageState };

export interface TranslateBatchResponse {
  lines?: string[];
  error?: string;
  /** Diagnostics for malformed user dictionary rows; the prior valid dictionary stays in use. */
  userDictWarning?: string;
}

/** offscreen → engine sandbox */
export type EngineRequest =
  | { type: 'translate'; lines: string[]; userDict: string; speech: 'strict' | 'soft' }
  | { type: 'check-userdict'; userDict: string }
  | { type: 'info' };

/** background → offscreen, relayed to the sandbox as an EngineRequest */
export type OffscreenRequest = EngineRequest & { target: 'offscreen' };

/** offscreen → engine sandbox, once, with the bytes the sandbox cannot fetch itself */
export interface SandboxInit {
  type: 'init';
  wasm: ArrayBuffer;
  snapshot: ArrayBuffer;
  /** Dictionary version line, read by the engine from next to the snapshot. */
  version: string;
}

export interface OffscreenResponse {
  lines?: string[];
  error?: string;
  userDictWarning?: string;
  info?: EngineInfo;
}

/** background/popup → content script */
export type ContentRequest = { type: 'translate-page' } | { type: 'restore-page' } | { type: 'toggle-page' } | { type: 'get-state' };

export type PageState = 'original' | 'translating' | 'translated';

export interface ContentStatus {
  state: PageState;
  done: number;
  total: number;
  error?: string;
  userDictWarning?: string;
}

/** popup/options → background */
export type UiRequest =
  | { type: 'ui-translate-tab'; tabId: number; action: 'translate-page' | 'restore-page' | 'toggle-page' }
  | { type: 'ui-check-userdict'; userDict: string }
  | { type: 'ui-engine-info' };
