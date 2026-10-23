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

/** to the engine (lib/engine.ts) */
export type EngineRequest =
  | { type: 'translate'; lines: string[]; userDict: string; speech: 'strict' | 'soft' }
  | { type: 'check-userdict'; userDict: string }
  | { type: 'info' };

/** background → offscreen document (Chrome) */
export type OffscreenRequest = EngineRequest & { target: 'offscreen' };

export interface EngineResponse {
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
