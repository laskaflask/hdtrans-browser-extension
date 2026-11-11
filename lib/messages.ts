// Messages between the page, the background and the offscreen engine document.

export interface EngineInfo {
  version: string;
  dictionaryVersion: string;
}

/** content script → background */
export type BackgroundRequest =
  | { type: 'translate-batch'; lines: string[] }
  | { type: 'page-state'; state: PageState }
  /** Asks for the page's subframes to be translated. `skip` holds frame addresses the page
   *  opted out of translation (translate="no", .notranslate), which are not injected. */
  | { type: 'translate-frames'; skip?: string[] }
  /** The host patterns of the frame origins the extension may not read yet. */
  | { type: 'missing-frame-origins'; origins: string[] }
  /** Opens the extension popup (or a popup tab for this tab) so the user can allow embed origins. */
  | { type: 'open-embed-permissions' };

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
export type ContentRequest =
  | { type: 'translate-page'; wait?: boolean }
  | { type: 'restore-page' }
  | { type: 'toggle-page' }
  /** Asks the translated page to try its subframes again, now that their origins may be allowed. */
  | { type: 'translate-embeds' }
  | { type: 'get-state' };

export type PageState = 'original' | 'translating' | 'translated';

export interface ContentStatus {
  state: PageState;
  done: number;
  total: number;
  url?: string;
  error?: string;
  userDictWarning?: string;
  /** Origins of cross-origin frames this page includes, for asking for their access separately. */
  frameOrigins?: string[];
}

/** popup/options → background */
export type UiRequest =
  | { type: 'ui-translate-tab'; tabId: number; action: 'translate-page' | 'restore-page' | 'toggle-page' }
  | { type: 'ui-translate-frames'; tabId: number }
  | { type: 'ui-check-userdict'; userDict: string }
  | { type: 'ui-engine-info' };
